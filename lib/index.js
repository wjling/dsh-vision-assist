import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BlockAssembler, contentHasImage, isAgentLoopRequest, markAgentLoopRequest } from "@deepseek-ai/dsh-llm";
import { SettingsConflictError, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

const name = "dsh-vision-assist";
const NS = "vision-assist";
const inject = ["tools", "settings", "llm", "attachments"];

const Config = z.object({
	enabled: z.boolean().default(true),
	provider: z.string().default("codemaker"),
	model: z.string().default("gemini-3.7-flash"),
	timeoutMs: z.number().step(1).min(1000).max(600000).default(120000)
});

const DETAIL_PROMPTS = {
	coarse: "你是图片内容识别助手。请用一两句话概括这张图片的内容（页面类型、主要元素）。",
	default: "你是图片内容识别助手。按从上到下、从左到右识别图中各模块元素与可见文本（逐条抄录，中文/英文/数字尽量原文），并给出整体配色（主色、背景色，大致 HEX）。拿不准的写“无法判断”，不要臆测。",
	fine: "你是图片内容识别助手。按最高精细度输出：逐项列出模块与布局（间距、对齐）、颜色（精确 HEX）、图标/形状、文本（逐字抄录）；拿不准的写“无法判断”，不要臆测。"
};

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), ".dsh");

/** 附件引用 → 本地文件绝对路径（内容寻址：~/.dsh/attachments/v1/objects/<前2位>/<sha256>）。 */
function attachmentPath(ref) {
	const id = typeof ref?.attachmentId === "string" ? ref.attachmentId : "";
	if (!id.startsWith("sha256:")) return "";
	const hex = id.slice(7);
	if (!/^[0-9a-f]{64}$/.test(hex)) return "";
	return join(DSH_HOME, "attachments", "v1", "objects", hex.slice(0, 2), hex);
}

/** 文件头嗅探 MIME。 */
function sniffMediaType(bytes) {
	if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
	if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
	return "";
}

/** 模型侧的图片改写文本：图片块 → 本地路径 + vision_recognize 调用指引。 */
function fallbackText(images) {
	const lines = images.map((image, index) => `  ${index + 1}. ${image.path || "（本地路径未知）"}${image.mediaType ? `（${image.mediaType}）` : ""}`);
	return [
		`【vision-assist 接管】本条消息附带了 ${images.length} 张图片。当前模型没有视觉输入，图片已保存为本地文件：`,
		...lines,
		`请对每张图调用 vision_recognize 工具（path=文件路径，mediaType 按括号里的类型填写），把识别结果用于后续任务；不要假设图片内容。`
	].join("\n");
}

/** 递归摘除图片块（含 tool-result 嵌套内容），并把摘出的图片记入 images。 */
function stripImageBlocks(content, images) {
	if (!Array.isArray(content)) return content;
	const next = [];
	let changed = false;
	for (const block of content) {
		if (block.type === "image") {
			changed = true;
			images.push({
				path: attachmentPath(block.attachment),
				mediaType: block.attachment?.mediaType
			});
			continue;
		}
		if (block.type === "tool-result" && Array.isArray(block.content)) {
			const rewritten = stripImageBlocks(block.content, images);
			if (rewritten !== block.content) {
				changed = true;
				next.push({ ...block, content: rewritten });
				continue;
			}
		}
		next.push(block);
	}
	return changed ? next : content;
}

// ── 设置桥：设置页卡片（client 段）读写 vision-assist 命名空间的 HTTP 路由 ──
// 客户端上下文没有 settingsScope 服务（它只存在于设置页内部作用域），所以照
// free-search 的成熟模式在 host 侧开一个仅限回环地址的设置桥。
const BRIDGE_PREFIX = "/api/dsh-vision-assist-settings";
const MAX_JSON_BODY_BYTES = 64 * 1024;

function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL("http://" + host);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === undefined) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

function writeJson(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "referrer-policy": "no-referrer" });
	res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > MAX_JSON_BODY_BYTES) return undefined;
		chunks.push(buffer);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return undefined;
	}
}

function toView(descriptor) {
	return {
		ns: String(descriptor.ns),
		value: descriptor.value,
		revision: descriptor.revision
	};
}

function makeBridgeRoutes(settings) {
	const allowlisted = () =>
		settings
			.describe({ redactSecrets: true })
			.filter((descriptor) => String(descriptor.ns) === NS)
			.map((descriptor) => String(descriptor.ns));

	const handlers = {
		async describe() {
			const descriptors = settings.describe({ redactSecrets: true });
			return {
				ok: true,
				value: {
					namespaces: allowlisted()
						.map((ns) => descriptors.find((descriptor) => String(descriptor.ns) === ns))
						.filter((descriptor) => descriptor !== undefined)
						.map(toView),
					writable: settings.writable !== false
				}
			};
		},
		async mutate(request) {
			if (request === null || typeof request !== "object" || typeof request.ns !== "string" || !Array.isArray(request.ops)) {
				return { ok: false, code: "settings-rejected", message: "malformed bridge settings request" };
			}
			const { ns } = request;
			if (!allowlisted().includes(ns)) {
				return { ok: false, code: "settings-not-exposed", message: `settings namespace "${ns}" is not exposed` };
			}
			const expectedRevision = typeof request.expectedRevision === "number" ? request.expectedRevision : undefined;
			try {
				await settings.mutate(settingsNamespace(ns), request.ops, expectedRevision);
			} catch (error) {
				if (error instanceof SettingsConflictError) {
					return { ok: false, code: "settings-conflict", message: error.message };
				}
				return { ok: false, code: "internal", message: error instanceof Error ? error.message : String(error) };
			}
			const descriptor = settings.describe({ redactSecrets: true }).find((candidate) => String(candidate.ns) === ns);
			if (descriptor === undefined) {
				return { ok: false, code: "internal", message: `settings namespace "${ns}" was disposed after the mutate` };
			}
			return { ok: true, value: toView(descriptor) };
		},
		async options() {
			// 返回 pi-ai 设置的可用 provider 及其模型列表，供设置卡下拉框使用。
			const pi = settings.get("llm-pi-ai");
			const providers = pi?.providers && typeof pi.providers === "object"
				? Object.entries(pi.providers).map(([id, info]) => ({
					id,
					models: Array.isArray(info?.models)
						? info.models.map((m) => ({ id: m.id, input: Array.isArray(m.input) ? m.input : [] }))
						: []
				}))
				: [];
			return { ok: true, value: { providers } };
		}
	};

	const guard = (req, res) => {
		if (!isLoopbackRequest(req)) {
			writeJson(res, 403, { error: "loopback requests only" });
			return false;
		}
		if (req.method !== "POST") {
			writeJson(res, 405, { error: "method not allowed: " + (req.method ?? "") });
			return false;
		}
		return true;
	};

	return [
		{
			kind: "exact",
			path: `${BRIDGE_PREFIX}/describe`,
			handler: async (req, res) => {
				if (!guard(req, res)) return;
				writeJson(res, 200, await handlers.describe());
			}
		},
		{
			kind: "exact",
			path: `${BRIDGE_PREFIX}/mutate`,
			handler: async (req, res) => {
				if (!guard(req, res)) return;
				const body = await readJsonBody(req);
				if (body === undefined) {
					writeJson(res, 400, { ok: false, code: "settings-rejected", message: "malformed JSON body" });
					return;
				}
				writeJson(res, 200, await handlers.mutate(body));
			}
		},
		{
			kind: "exact",
			path: `${BRIDGE_PREFIX}/options`,
			handler: async (req, res) => {
				if (!guard(req, res)) return;
				writeJson(res, 200, await handlers.options());
			}
		}
	];
}

function apply(ctx) {
	// 命名空间注册 + vision_recognize 工具的按需注册/注销，见下方「0. 命名空间与工具」。

	// 设置桥（供设置页卡片读写）：仅回环地址可访问，走 settings 官方 mutate。
	ctx.inject(["webServer", "settings"], (sctx) => {
		sctx.effect(() => {
			const disposers = makeBridgeRoutes(sctx.settings).map((route) => sctx.webServer.register(route));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "vision-assist: settings bridge");
	});

	// ── 0. 管线级图片能力声明：解除 api-proxy 发送前的模态拒收 ────────────────
	// dsh-host-apiproxy 的 prompt 端点在消息进入 inbox 之前就调用
	// ctx.llm.resolveModelInfo 检查当前模型是否支持图片，无视觉模型会被直接拒收
	// （MODEL_DOES_NOT_SUPPORT_IMAGES），消息根本进不了会话。这里把"图片已由本
	// 插件接管"反映到 resolveModelInfo 上：向 API/客户端声明整条流水线可接收
	// 图片；图片的实际处理发生在模型调用边界（见下方 llm.streamWithRegistration）。
	const baseResolveModelInfo = ctx.llm.resolveModelInfo.bind(ctx.llm);
	ctx.llm.resolveModelInfo = async function(provider, model, signal) {
		const info = await baseResolveModelInfo(provider, model, signal);
		if (ctx.settings.get(NS)?.enabled === false) return info;
		const modalities = info.inputModalities ?? ["text"];
		return modalities.includes("image") ? info : { ...info, inputModalities: [...modalities, "image"] };
	};
	ctx.logger?.info(`[${name}] 已启用：图片输入由 vision_recognize 接管，无视觉模型不再被拒收`);

	// ── 0. 命名空间注册 + vision_recognize 工具按 enabled 动态注册/注销 ──────
	// 禁用时「完全不接管」：不暴露 vision_recognize（模型无工具可调，不会去调用识别），
	// 同时消息不改写、模型按原样收图（见下方 llm.streamWithRegistration）。
	const toolDefinition = defineTool({
		name: "vision_recognize",
		description: "识别本地图片内容，由 vision-assist 设置里选定的多模态模型执行。主模型无视觉、需要看图（识别/描述/提取信息/对比设计稿）时调用本工具：传入图片本地绝对路径，可选 mediaType 与精细度 detail（coarse=一两句概括 / default=模块+文本+配色 / fine=最高精细度）。",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "图片本地绝对路径"
			},
			mediaType: {
				type: "string",
				description: "图片 MIME 类型（如 image/png），缺省按文件头自动识别"
			},
			detail: {
				type: "string",
				enum: ["coarse", "default", "fine"],
				description: "识别精细程度，缺省 default"
			},
			prompt: {
				type: "string",
				description: "附加识别要求（拼接在默认提示词后）"
			}
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{ type: "text", text: value }]
		},
		async execute(args, exec) {
			const cfg = ctx.settings.get(NS);
			if (cfg.enabled === false) throw new Error("vision-assist 已禁用：settings 里 vision-assist.enabled=false");
			const bytes = readFileSync(args.path);
			const mediaType = args.mediaType ?? sniffMediaType(bytes) ?? "image/png";
			const prompt = (args.detail ? DETAIL_PROMPTS[args.detail] : DETAIL_PROMPTS.default)
				+ (args.prompt ? `\n附加要求：${args.prompt}` : "");
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(new Error(`vision-assist 识别超时（${cfg.timeoutMs}ms）`)), cfg.timeoutMs);
			const onAbort = () => controller.abort(exec.signal.reason);
			exec.signal.addEventListener("abort", onAbort, { once: true });
			const assembler = new BlockAssembler();
			try {
				// pi-ai 管线只接受带附件引用的图片块（block.attachment），不支持内联
				// base64：先经 attachments 服务落库，拿到内容寻址引用再组消息。
				const refs = await ctx.attachments.saveImages([{ data: bytes, mediaType }]);
				const stream = ctx.llm.stream({
					provider: cfg.provider,
					model: cfg.model,
					messages: [{
						role: "user",
						content: [
							{ type: "text", text: prompt },
							{ type: "image", attachment: refs[0] }
						]
					}],
					signal: controller.signal
				});
				for await (const chunk of stream) assembler.push(chunk);
			} finally {
				clearTimeout(timer);
				exec.signal.removeEventListener("abort", onAbort);
			}
			// 显式抛出流终止错误（鉴权失败、模型不在册、超时等），不再吞错。
			const finish = assembler.finish;
			if (finish.kind === "error" || finish.kind === "aborted") throw finish.failure ?? new Error(`vision-assist 视觉调用失败（${finish.kind}）`);
			const text = assembler.blocks().filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
			return text || "（视觉模型未返回文本内容）";
		}
	});

	// 注册设置命名空间，并按 enabled 开关识别工具：禁用时不暴露给模型。
	ctx.inject(["settings"], (sctx) => {
		const scope = sctx.settings.register(NS, Config, { base: {} });
		let disposeTool = null;
		const syncTool = () => {
			const enabled = scope.get()?.enabled !== false;
			if (enabled && disposeTool === null) {
				disposeTool = ctx.tools.register(toolDefinition);
			} else if (!enabled && disposeTool !== null) {
				disposeTool();
				disposeTool = null;
			}
		};
		syncTool();
		scope.watch(syncTool);
		sctx.effect(() => () => {
			if (disposeTool !== null) disposeTool();
		});
	});

	// ── 2. 模型调用边界改写：无视觉模型 → 图片块换成路径 + 工具指引 ──────────
	// 不在 inbox 层改消息：改 inbox 会让 GUI 气泡里也变成那段文字（用户看到
	// 的就是"莫名其妙的文本"），且会话历史里永久丢了图片。改为包裹
	// ctx.llm.streamWithRegistration：仅当本次请求路由到未声明 image 的 pi-ai
	// 模型时，克隆请求、摘掉图片块并追加 vision_recognize 指引文本。
	// 消息本体不变 → GUI 正常显示图片、会话历史保留原图；模型收到干净请求。
	// 不能用 llm/stream waterfall 改：agent-loop 的请求对象被 deepFreeze 冻结。
	const baseStreamWithRegistration = ctx.llm.streamWithRegistration.bind(ctx.llm);
	ctx.llm.streamWithRegistration = function(options, prepared) {
		if (ctx.settings.get(NS)?.enabled !== false && options?.provider && options?.model && Array.isArray(options.messages)) {
			const pi = ctx.settings.get("llm-pi-ai");
			const entry = pi?.providers?.[options.provider]?.models?.find((model) => model.id === options.model);
			// 与 llm-pi-ai 一致：未声明 input 的模型按纯文本处理；能看图的模型
			// 和不在 pi 设置里的 provider 都不干预（交还原生管线处理）。
			if (entry !== void 0 && !entry.input?.includes("image")) {
				let changed = false;
				const messages = options.messages.map((message) => {
					if (!Array.isArray(message.content) || !contentHasImage(message.content)) return message;
					changed = true;
					const images = [];
					const content = stripImageBlocks(message.content, images);
					content.push({ type: "text", text: fallbackText(images) });
					return { ...message, content };
				});
				if (changed) {
					const clone = { ...options, messages };
					// 保留 agent-loop 请求标记，否则 dsh-session-title 会跳过自动命名。
					options = isAgentLoopRequest(options) ? markAgentLoopRequest(clone) : clone;
				}
			}
		}
		return baseStreamWithRegistration(options, prepared);
	};
}

export { Config, apply, inject, name };
