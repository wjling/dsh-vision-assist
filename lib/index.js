import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BlockAssembler, contentHasImage, isAgentLoopRequest, markAgentLoopRequest } from "@deepseek-ai/dsh-llm";
import { installSettingsSection } from "@deepseek-ai/dsh-settings";
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

function apply(ctx) {
	// hooks 提供可用的 setSource/onChange 桩：installSettingsSection 会向
	// hooks.setSource 赋值并调用 hooks.onChange()，传空对象会在 inject 回调里抛
	// TypeError，导致命名空间半注册（register 已执行、watch 未挂）。
	installSettingsSection(ctx, NS, Config, {}, {
		setSource: () => {},
		onChange: () => {}
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

	// ── 1. vision_recognize：用 settings 选定的多模态模型识别图片 ──────────
	ctx.tools.register(defineTool({
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
	}));

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
