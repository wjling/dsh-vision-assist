import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BlockAssembler, contentHasImage } from "@deepseek-ai/dsh-llm";
import { installSettingsSection } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

const name = "vision-bridge";
const NS = "vision-bridge";
const inject = ["tools", "settings", "llm"];

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

/** 输入框图片改写文本：图片块 → 本地路径 + vision_recognize 调用指引。 */
function fallbackText(images) {
	const lines = images.map((image) => `- ${image.path}${image.mediaType ? `（${image.mediaType}）` : ""}`);
	return [
		`[本条消息附带了 ${images.length} 张图片。当前模型没有视觉输入，图片已保存为本地文件：`,
		...lines,
		`请调用 vision_recognize 工具识别（path=对应文件路径, mediaType 可填上面括号里的类型），把识别结果用于后续任务；不要假设图片内容。]`
	].join("\n");
}

function apply(ctx) {
	installSettingsSection(ctx, NS, Config, {}, {});

	// ── 1. vision_recognize：用 settings 选定的多模态模型识别图片 ──────────
	ctx.tools.register(defineTool({
		name: "vision_recognize",
		description: "识别本地图片内容，由 vision-bridge 设置里选定的多模态模型执行。主模型无视觉、需要看图（识别/描述/提取信息/对比设计稿）时调用本工具：传入图片本地绝对路径，可选 mediaType 与精细度 detail（coarse=一两句概括 / default=模块+文本+配色 / fine=最高精细度）。",
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
			if (cfg.enabled === false) throw new Error("vision-bridge 已禁用：settings 里 vision-bridge.enabled=false");
			const bytes = readFileSync(args.path);
			const mediaType = args.mediaType ?? sniffMediaType(bytes) ?? "image/png";
			const prompt = (args.detail ? DETAIL_PROMPTS[args.detail] : DETAIL_PROMPTS.default)
				+ (args.prompt ? `\n附加要求：${args.prompt}` : "");
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(new Error(`vision-bridge 识别超时（${cfg.timeoutMs}ms）`)), cfg.timeoutMs);
			const onAbort = () => controller.abort(exec.signal.reason);
			exec.signal.addEventListener("abort", onAbort, { once: true });
			const assembler = new BlockAssembler();
			try {
				const stream = ctx.llm.stream({
					provider: cfg.provider,
					model: cfg.model,
					messages: [{
						role: "user",
						content: [
							{ type: "text", text: prompt },
							{ type: "image", data: bytes.toString("base64"), mimeType: mediaType }
						]
					}],
					signal: controller.signal
				});
				for await (const chunk of stream) assembler.push(chunk);
			} finally {
				clearTimeout(timer);
				exec.signal.removeEventListener("abort", onAbort);
			}
			const text = assembler.blocks().filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
			return text || "（视觉模型未返回文本内容）";
		}
	}));

	// ── 2. 输入框图片拦截：无视觉模型 → 图片块改写成路径 + 工具指引 ─────────
	ctx.on("emit", (carrier, eventName, payload) => {
		if (eventName !== "agent/inbox/inserted") return;
		const { message, agent } = payload ?? {};
		if (!message || typeof message.content === "string" || !contentHasImage(message.content)) return;
		if (ctx.settings.get(NS)?.enabled === false) return;
		const header = agent?.session?.requestHeader?.();
		const route = {
			provider: header?.config?.provider ?? agent?.options?.provider,
			model: header?.config?.model ?? agent?.options?.model
		};
		if (!route.provider || !route.model) return;
		const pi = ctx.settings.get("llm-pi-ai");
		const entry = pi?.providers?.[route.provider]?.models?.find((model) => model.id === route.model);
		// 与 llm-pi-ai 一致：未声明 input 的模型按纯文本处理；能看图的模型不干预。
		if (entry?.input?.includes("image")) return;
		const content = [];
		const images = [];
		for (const block of message.content) {
			if (block.type !== "image") {
				content.push(block);
				continue;
			}
			images.push({
				path: attachmentPath(block.attachment),
				mediaType: block.attachment?.mediaType
			});
		}
		content.push({ type: "text", text: fallbackText(images) });
		const replacement = { ...message, content };
		for (const target of ["next-turn", "next-step"]) {
			const pending = agent?.inbox?.state?.[target];
			if (!Array.isArray(pending)) continue;
			const index = pending.findIndex((m) => m === message);
			if (index >= 0) pending[index] = replacement;
		}
	});
}

export { Config, apply, inject, name };
