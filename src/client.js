import { createElement } from "react";
import { SettingsForm, SettingsFormModel, settingsNumberField, settingsTextField } from "@deepseek-ai/dsh-client-ui-primitives";

/** 宿主 Loader 条目 id，同时也是设置命名空间（与 host 段 ctx.fiber.entry.options.id 一致）。 */
const NS = "vision-assist";
/** provider/model 下拉的数据来源：llm-pi-ai 的模型目录（只在镜像里读，不写）。 */
const PI_NS = "llm-pi-ai";

// DSH 0.1.7 的客户端设置页把可配置卡片挂在 Plugins 面板的 `plugins.item` 列表插槽上；
// 卡片的读写不再走自建 HTTP 桥，而是 configForms（设置域的基础服务）：
//   ctx.configForms.get(NS)         → 本插件命名空间的表单作用域（读快照 + mutate 写入）
//   ctx.configForms.whileServed([NS]) → 只在宿主确实提供该命名空间时注册卡片
//   ctx.configForms.describe()      → 共享的 describe 镜像（读 llm-pi-ai 的模型目录）
const inject = ["slots", "configForms"];

const CSS = `
.dshva-card{min-width:0}
.dshva-hint{color:var(--dsw-alias-label-secondary, #b0b0b0);font-size:12px;line-height:1.5;margin:0 0 10px}
.dshva-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l2, #eee)}
.dshva-row:first-of-type{border-top:0}
.dshva-meta{display:flex;flex-direction:column;min-width:0}
.dshva-label{font-size:13px;color:var(--dsw-alias-label-primary, #eee)}
.dshva-fieldhint{color:var(--dsw-alias-label-secondary, #b0b0b0);font-size:11px;margin-top:2px}
.dshva-control{display:flex;align-items:center;gap:8px}
.dshva-input{min-width:190px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2, #ccc);border-radius:6px;background:var(--dsw-alias-bg-layer-3, #fff);color:inherit;font-size:13px}
.dshva-input:disabled{opacity:.5;cursor:not-allowed}
.dshva-check{width:16px;height:16px;accent-color:var(--dsw-alias-accent, #4c8cff)}
.dshva-reset{border:0;background:none;color:var(--dsw-alias-label-secondary, #b0b0b0);font-size:12px;cursor:pointer;padding:2px 4px}
.dshva-reset:disabled{opacity:.5;cursor:not-allowed}
.dshva-tag{color:var(--dsw-alias-label-tertiary, #999);font-size:11px}
`;

const LABELS = {
	unavailable: "该插件当前未加载，暂时无法配置。",
	readOnly: "本部署的设置为只读。",
	saveFailed: "宿主没有接受这些值，已保留供你修改。",
	save: "保存",
	saving: "保存中…"
};

/** 布尔字段：SettingsFormModel 的字段转换只认文本，这里补一个 true/false 规格。 */
function booleanField(field) {
	return {
		field,
		format: (value) => (value === false ? "false" : "true"),
		parse: (text) => ({ kind: "set", value: text === "true" })
	};
}

/** 从 describe 镜像里取出 llm-pi-ai 的 provider 目录，转成下拉用的结构。 */
function providersOf(section) {
	const providers = section?.providers;
	if (providers === null || typeof providers !== "object") return [];
	return Object.entries(providers).map(([id, info]) => ({
		id,
		models: Array.isArray(info?.models)
			? info.models.map((model) => ({ id: model.id, input: Array.isArray(model.input) ? model.input : [] }))
			: []
	}));
}

/** 一行：左侧标签 + 说明，右侧控件。 */
function Row(label, hint, control) {
	return createElement("div", { className: "dshva-row" },
		createElement("div", { className: "dshva-meta" },
			createElement("span", { className: "dshva-label" }, label),
			hint ? createElement("span", { className: "dshva-fieldhint" }, hint) : null),
		control);
}

/** 已覆盖时给自定义控件补一个「恢复默认」，与官方 SettingsValueField 的语义保持一致。 */
function withReset(fieldState, onReset, control, disabled) {
	return createElement("div", { className: "dshva-control" },
		control,
		fieldState?.overridden === true
			? createElement("button", {
				type: "button",
				className: "dshva-reset",
				disabled,
				onClick: onReset
			}, "恢复默认")
			: null);
}

/**
 * 插件设置卡片：Plugins 面板里的一项，列表视图渲染一句话，详情视图渲染表单。
 * props 由插槽系统注入（inject 面 + 视图），见 dsh-client-ui-renderer。
 */
function VisionAssistCard(props) {
	if (props.view === "summary") {
		return "无视觉主模型收到图片时，交给下面选定的多模态模型识别（vision_recognize 工具）。";
	}
	const state = props.useVisionAssistCard((snapshot) => snapshot);
	const pi = props.useVisionAssistOptions((snapshot) => snapshot?.view?.namespaces?.find((row) => row.ns === PI_NS));
	const disabled = !state.writable;
	const providers = providersOf(pi?.value);

	const currentProvider = state.provider?.text ?? "";
	const providerInfo = providers.find((provider) => provider.id === currentProvider);
	let models = (providerInfo?.models ?? []).filter((model) => model.input.includes("image"));
	if (models.length === 0) models = providerInfo?.models ?? [];
	const currentModel = state.model?.text ?? "";
	if (currentModel !== "" && !models.some((model) => model.id === currentModel)) {
		models = [{ id: currentModel, input: [] }, ...models];
	}

	return createElement(SettingsForm, {
		labels: LABELS,
		state,
		onSave: props.save,
		onDiscard: props.discard
	},
		createElement("p", { className: "dshva-hint" },
			"无视觉主模型收到图片时，由下面的多模态模型代为识别（vision_recognize 工具）。改动点「保存」后即时生效，无需重启。"),
		Row("启用识别接管", "关闭后完全不接管：主模型按原样收到图片，不注入识别指引，也不提供 vision_recognize 工具",
			createElement("input", {
				className: "dshva-check",
				type: "checkbox",
				checked: state.enabled?.text === "true",
				disabled,
				onChange: (event) => props.edit("enabled", event.target.checked ? "true" : "false")
			})),
		Row("识别模型 provider", "来自 llm-pi-ai 配置的 provider",
			withReset(state.provider, () => props.resetField("provider"),
				createElement("select", {
					className: "dshva-input",
					value: currentProvider,
					disabled: disabled || providers.length === 0,
					onChange: (event) => props.edit("provider", event.target.value)
				},
				providers.length === 0
					? createElement("option", { value: currentProvider }, currentProvider || "（llm-pi-ai 未配置 provider）")
					: providers.map((provider) => createElement("option", { key: provider.id, value: provider.id }, provider.id)),
				providers.length > 0 && !providers.some((provider) => provider.id === currentProvider) && currentProvider !== ""
					? createElement("option", { value: currentProvider }, currentProvider)
					: null),
				disabled)),
		Row("识别模型 model", "优先列出声明了图片输入的多模态模型",
			withReset(state.model, () => props.resetField("model"),
				createElement("select", {
					className: "dshva-input",
					value: currentModel,
					disabled: disabled || models.length === 0,
					onChange: (event) => props.edit("model", event.target.value)
				},
				models.length === 0
					? createElement("option", { value: currentModel }, currentModel)
					: models.map((model) => createElement("option", { key: model.id, value: model.id }, model.id))),
				disabled)),
		Row("识别超时（毫秒）", "1000–600000，默认 120000",
			withReset(state.timeoutMs, () => props.resetField("timeoutMs"),
				createElement("input", {
					className: "dshva-input",
					type: "text",
					inputMode: "numeric",
					value: state.timeoutMs?.text ?? "",
					disabled,
					onChange: (event) => props.edit("timeoutMs", event.target.value)
				}),
				disabled)),
		state.invalid ? createElement("p", { className: "dshva-hint" }, "有字段填得不合法，请修正后再保存。") : null);
}

/** 卡片控制器：把设置域的表单作用域包成一个快照 store，供插槽注入。 */
class CardController {
	constructor(ctx) {
		const scope = ctx.configForms.get(NS);
		this.form = new SettingsFormModel(scope, [
			booleanField("enabled"),
			settingsTextField("provider"),
			settingsTextField("model"),
			settingsNumberField("timeoutMs")
		]);
		this.store = this.form.bind(() => ({
			...this.form.shell(),
			enabled: this.form.field("enabled"),
			provider: this.form.field("provider"),
			model: this.form.field("model"),
			timeoutMs: this.form.field("timeoutMs")
		}));
		// 共享 describe 镜像：read-only 数据源（llm-pi-ai 的 provider/模型目录）。
		this.options = ctx.configForms.describe();
	}
	/** 插槽注入面：hooks 里的 store 会被渲染器绑成 useXxx 选择器 prop，其余是表单动作。 */
	inject() {
		return {
			hooks: {
				visionAssistCard: this.store,
				visionAssistOptions: this.options
			},
			...this.form.actions()
		};
	}
	dispose() {
		this.form.dispose();
	}
}

function apply(ctx) {
	ctx.effect(() => {
		const tagId = "dsh-vision-assist/card.css";
		if (typeof document === "undefined") return;
		if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return;
		const tag = document.createElement("style");
		tag.dataset.pluginCss = tagId;
		tag.textContent = CSS;
		document.head.appendChild(tag);
		return () => {
			tag.remove();
		};
	}, "dsh-vision-assist: settings card styles");

	const card = new CardController(ctx);
	ctx.effect(() => () => {
		card.dispose();
	}, "dsh-vision-assist: card form subscription");

	// 只在宿主确实提供 vision-assist 命名空间时注册卡片：插件没挂上就不显示空壳。
	ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject("plugins.item", () => ctx.slots.register({
		name: "plugins.item",
		id: NS,
		order: 130,
		label: () => "视觉助手 vision-assist",
		inject: () => card.inject()
	}, VisionAssistCard))), "dsh-vision-assist: settings card");
}

export { apply, inject };
