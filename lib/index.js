import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BlockAssembler, contentHasImage, isAgentLoopRequest, markAgentLoopRequest } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

const name = "dsh-vision-assist";
/**
 * 默认命名空间：Loader 条目 id（cordis.patch.yml 里的 `id: vision-assist`），
 * 也就是 DSH 设置里这个插件的可配置命名空间。实际条目 id 从
 * `ctx.fiber.entry.options.id` 读，条目标题被改写时仍然对得上。
 */
const NS = "vision-assist";
const inject = ["tools", "llm", "attachments"];

/**
 * 插件配置。字段必须 `.volatile()`：DSH 只把 volatile 字段投影成设置页可编辑的表单，
 * 且 volatile 变更在原 fiber 上热更新（不重挂插件），`config.<field>.get()` 永远读到最新值。
 */
const Config = z.object({
	enabled: z.boolean().default(true).description("总开关：关闭后完全不接管，主模型按原样接收图片").volatile(),
	provider: z.string().default("codemaker").description("识别模型所在 provider（llm-pi-ai 里已配置的 provider）").volatile(),
	model: z.string().default("gemini-3.7-flash").description("识别模型 id（需声明 input: [text, image]）").volatile(),
	timeoutMs: z.number().step(1).min(1000).max(600000).default(120000).description("单次识别超时（毫秒）").volatile()
});

const DETAIL_PROMPTS = {
	coarse: "你是图片内容识别助手。请用一两句话概括这张图片的内容（页面类型、主要元素）。",
	default: "你是图片内容识别助手。按从上到下、从左到右识别图中各模块元素与可见文本（逐条抄录，中文/英文/数字尽量原文），并给出整体配色（主色、背景色，大致 HEX）。拿不准的写“无法判断”，不要臆测。",
	fine: "你是图片内容识别助手。按最高精细度输出：逐项列出模块与布局（间距、对齐）、颜色（精确 HEX）、图标/形状、文本（逐字抄录）；拿不准的写“无法判断”，不要臆测。"
};

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), ".dsh");

/** 本插件自身发起的视觉调用标记：绕过图片改写，避免自噬。 */
const INTERNAL_CALL = Symbol("dsh-vision-assist/internal-call");

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

/**
 * 摘除图片块并把摘出的图片记入 images；没有图片时原样返回。
 * DSH 的内容块联合只有 text/reasoning/image/file/tool-call 等（工具结果已经是独立的
 * role:"tool" 消息，不再是嵌套块），所以这里只平铺处理一层，工具结果消息由调用方
 * 按消息逐条覆盖。
 */
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
		next.push(block);
	}
	return changed ? next : content;
}

/** 请求里是否真的带了图片块（快速判据，避免无图请求走异步路径）。 */
function hasImageBlocks(options) {
	return Array.isArray(options?.messages)
		&& options.messages.some((message) => Array.isArray(message.content) && contentHasImage(message.content));
}

/** 克隆请求，把图片块换成「本地路径 + vision_recognize 指引」；没有图片时原样返回。 */
function rewriteRequest(options) {
	let changed = false;
	const messages = options.messages.map((message) => {
		if (!Array.isArray(message.content) || !contentHasImage(message.content)) return message;
		changed = true;
		const images = [];
		const content = stripImageBlocks(message.content, images);
		content.push({ type: "text", text: fallbackText(images) });
		return { ...message, content };
	});
	if (!changed) return options;
	const clone = { ...options, messages };
	// 保留 agent-loop 请求标记，否则 dsh-session-title 会跳过自动命名。
	return isAgentLoopRequest(options) ? markAgentLoopRequest(clone) : clone;
}

function apply(ctx, config) {
	/** 条目 id：DSH 里它就是设置命名空间（settings.describe 的 ns）。 */
	const settingsNs = ctx.fiber?.entry?.options?.id ?? NS;

	// ── 配置读取 ──────────────────────────────────────────────────────────
	// volatile 字段用 `.get()` 读当前值；设置页写入后原 fiber 热更新，无需重挂插件。
	const isEnabled = () => config.enabled.get() !== false;
	const visionRoute = () => ({ provider: config.provider.get(), model: config.model.get(), timeoutMs: config.timeoutMs.get() });

	// 本插件自己也有自定义设置卡片，关掉 DSH 的自动生成表单，避免同一命名空间出现两份表单。
	ctx.inject(["settings"], (sctx) => {
		sctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber), "vision-assist: settings presentation");
	});

	// ── 0. 管线级图片能力声明：解除入站预检的模态拒收 ──────────────────────
	// dsh-api-session-controller 在消息进入会话之前调用 ctx.llm.resolveModelInfo 检查
	// 当前模型是否支持图片，无视觉模型会被直接拒收（reason: MODEL_DOES_NOT_SUPPORT_IMAGES），
	// 消息根本进不了会话。这里把「图片已由本插件接管」反映到 resolveModelInfo 上：向
	// API/客户端声明整条流水线可接收图片；图片的实际处理发生在模型调用边界（见下方包装）。
	// 禁用时保持原样，让 DSH 按原生规则拒收（"完全不接管"）。
	const baseResolveModelInfo = ctx.llm.resolveModelInfo.bind(ctx.llm);
	ctx.llm.resolveModelInfo = async function (provider, model, signal) {
		const info = await baseResolveModelInfo(provider, model, signal);
		if (!isEnabled()) return info;
		const modalities = info.inputModalities ?? ["text"];
		return modalities.includes("image") ? info : { ...info, inputModalities: [...modalities, "image"] };
	};

	// ── 1. 模型调用边界：无视觉模型 → 图片块换成路径 + 工具指引 ──────────────
	// 不在会话层改消息：改会话会让 GUI 气泡里也变成那段文字（用户看到的就是"莫名其妙的
	// 文本"），且会话历史里永久丢了图片。改为在调用边界克隆请求：仅当本次调用路由到未声明
	// image 的模型时，摘掉图片块并追加 vision_recognize 指引。消息本体不变 → GUI 正常显示
	// 图片、会话历史保留原图；模型收到干净请求。
	//
	// 判据用宿主解析出来的模态（prepareCall 的 inputModalities / resolveModelInfo 的原始
	// 结果），而不是自己读 llm-pi-ai 配置：未知模态（undefined）交给宿主原生管线处理。
	// `llm/stream` waterfall 改不了请求——它的终点闭包引用的是原始 options，所以这里包裹
	// 公开的 prepareCall / stream。
	const shouldRewrite = (options, modalities) =>
		modalities !== void 0
		&& !modalities.includes("image")
		&& options?.[INTERNAL_CALL] !== true
		&& isEnabled()
		&& typeof options?.provider === "string"
		&& typeof options?.model === "string"
		&& hasImageBlocks(options);

	const rewriteWith = (options, modalities) => (shouldRewrite(options, modalities) ? rewriteRequest(options) : options);

	// 主路径：agent-loop 调 ctx.llm.prepareCall(...) 后用 preparedCall.stream(request)。
	const basePrepareCall = ctx.llm.prepareCall.bind(ctx.llm);
	ctx.llm.prepareCall = async function (callConfig, signal) {
		const prepared = await basePrepareCall(callConfig, signal);
		if (prepared === void 0 || typeof prepared.stream !== "function") return prepared;
		const modalities = prepared.inputModalities;
		return {
			...prepared,
			stream: (request) => prepared.stream(rewriteWith(request, modalities))
		};
	};

	// 兜底路径：直接调 ctx.llm.stream 的调用方（标题、压缩、子代理等）。stream 是同步入口，
	// 只有确实带图时才需要异步解析模态，所以无图请求保持同步直通。
	const baseStream = ctx.llm.stream.bind(ctx.llm);
	ctx.llm.stream = function (options) {
		if (options?.[INTERNAL_CALL] === true || !hasImageBlocks(options)) return baseStream(options);
		return (async function* () {
			let modalities;
			try {
				const info = await baseResolveModelInfo(options.provider, options.model, options.signal);
				modalities = info?.inputModalities;
			} catch {
				modalities = void 0;
			}
			yield* baseStream(rewriteWith(options, modalities));
		})();
	};

	ctx.logger?.info(`[${name}] 已启用：图片输入由 vision_recognize 接管，无视觉模型不再被拒收（命名空间 ${settingsNs}）`);

	// ── 2. vision_recognize 工具：按 enabled 动态注册/注销 ──────────────────
	// 禁用时「完全不接管」：不暴露 vision_recognize（模型无工具可调，不会去调用识别）。
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
			const route = visionRoute();
			if (!isEnabled()) throw new Error("vision-assist 已禁用：设置里关闭了「启用识别接管」");
			const bytes = readFileSync(args.path);
			const mediaType = args.mediaType ?? sniffMediaType(bytes) ?? "image/png";
			const prompt = (args.detail ? DETAIL_PROMPTS[args.detail] : DETAIL_PROMPTS.default)
				+ (args.prompt ? `\n附加要求：${args.prompt}` : "");
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(new Error(`vision-assist 识别超时（${route.timeoutMs}ms）`)), route.timeoutMs);
			const onAbort = () => controller.abort(exec.signal.reason);
			exec.signal.addEventListener("abort", onAbort, { once: true });
			const assembler = new BlockAssembler();
			try {
				// pi-ai 管线只接受带附件引用的图片块（block.attachment），不支持内联
				// base64：先经 attachments 服务落库，拿到内容寻址引用再组消息。
				const refs = await ctx.attachments.saveImages([{ data: bytes, mediaType }]);
				const stream = ctx.llm.stream({
					[INTERNAL_CALL]: true,
					provider: route.provider,
					model: route.model,
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

	// 注册/注销跟随 enabled：设置页改开关后由 loader/volatile-update 通知。
	let disposeTool = null;
	const syncTool = () => {
		const enabled = isEnabled();
		if (enabled && disposeTool === null) disposeTool = ctx.tools.register(toolDefinition);
		else if (!enabled && disposeTool !== null) {
			disposeTool();
			disposeTool = null;
		}
	};
	syncTool();
	ctx.on("loader/volatile-update", syncTool);
	ctx.effect(() => () => {
		if (disposeTool !== null) {
			disposeTool();
			disposeTool = null;
		}
	}, "vision-assist: vision_recognize tool");
}

export { Config, apply, inject, name };
