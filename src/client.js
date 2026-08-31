import { createElement, useSyncExternalStore } from "react";

/** vision-assist 设置命名空间（与宿主侧 installSettingsSection 的命名空间一致）。 */
const NS = "vision-assist";

const inject = ["slots", "settingsScope"];

const CSS = `
.dshva-card{min-width:0;margin-bottom:8px;border:1px solid var(--dsw-alias-border-l2, #ddd);background:var(--dsw-alias-bg-layer-3, #fff);border-radius:8px;padding:12px 14px}
.dshva-title{font-weight:600;margin-bottom:4px}
.dshva-hint{color:var(--dsw-alias-label-dimmed, #888);font-size:12px;line-height:1.5;margin:0 0 8px}
.dshva-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--dsw-alias-border-l2, #eee)}
.dshva-row:first-of-type{border-top:0}
.dshva-meta{display:flex;flex-direction:column;min-width:0}
.dshva-label{font-size:13px}
.dshva-fieldhint{color:var(--dsw-alias-label-dimmed, #888);font-size:11px;margin-top:2px}
.dshva-input{min-width:180px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2, #ccc);border-radius:6px;background:var(--dsw-alias-bg-layer-3, #fff);color:inherit;font-size:13px}
.dshva-check{width:16px;height:16px;accent-color:var(--dsw-alias-accent, #4c8cff)}
.dshva-input:disabled,.dshva-check:disabled{opacity:.5;cursor:not-allowed}
`;

/** 一行配置项：左标签 + 右侧控件。 */
function Row(label, hint, control) {
	return createElement("div", { className: "dshva-row" },
		createElement("div", { className: "dshva-meta" },
			createElement("span", { className: "dshva-label" }, label),
			hint ? createElement("span", { className: "dshva-fieldhint" }, hint) : null),
		control);
}

/** 插件设置卡片：Settings → 插件（可配置标签页）里的 vision-assist 配置。 */
function VisionBridgeCard(props) {
	const scope = props.scope;
	// 绑定快照订阅：scope.subscribe(listener) 返回退订函数，getSnapshot 返回稳定快照。
	const snapshot = useSyncExternalStore(
		(listener) => scope.subscribe(listener),
		() => scope.getSnapshot()
	);
	if (snapshot === void 0 || snapshot.status !== "ready") {
		return createElement("div", { className: "dshva-card" },
			createElement("p", { className: "dshva-hint" },
				snapshot?.status === "unavailable"
					? "vision-assist 设置命名空间未注册（插件可能未挂载），请重启 DSH 后查看。"
					: "正在读取 vision-assist 配置…"));
	}
	const value = snapshot.value ?? {};
	const writable = snapshot.writable !== false;
	const revision = String(snapshot.revision ?? 0);
	// 每次写入成功后 revision 变化，重挂载非受控输入框以同步最新值。
	const commitText = (field, current) => (event) => {
		const next = String(event.target.value).trim();
		if (next.length > 0 && next !== current) scope.set(field, next);
		else event.target.value = current ?? "";
	};
	const commitTimeout = (current) => (event) => {
		const parsed = Number(event.target.value);
		if (!Number.isFinite(parsed)) {
			event.target.value = String(current);
			return;
		}
		const next = Math.min(600000, Math.max(1000, Math.round(parsed)));
		if (next !== current) scope.set("timeoutMs", next);
		event.target.value = String(next);
	};
	const disabled = !writable;
	const enabled = value.enabled !== false;
	return createElement("div", { className: "dshva-card", key: revision },
		createElement("div", { className: "dshva-title" }, "dsh-vision-assist（视觉助手）"),
		createElement("p", { className: "dshva-hint" },
			"无视觉主模型收到图片时，由下面的多模态模型代为识别（vision_recognize 工具）。改动即时生效，无需重启。"),
		Row("启用识别接管", "关闭后主模型调用 vision_recognize 会报错提示",
			createElement("input", {
				className: "dshva-check",
				type: "checkbox",
				checked: enabled,
				disabled,
				onChange: (event) => scope.set("enabled", event.target.checked)
			})),
		Row("识别模型 provider", "pi-ai 设置里的 provider id，如 codemaker",
			createElement("input", {
				className: "dshva-input",
				type: "text",
				defaultValue: value.provider ?? "codemaker",
				placeholder: "codemaker",
				disabled,
				onBlur: commitText("provider", value.provider)
			})),
		Row("识别模型 model", "多模态模型 id，如 gemini-3.7-flash",
			createElement("input", {
				className: "dshva-input",
				type: "text",
				defaultValue: value.model ?? "gemini-3.7-flash",
				placeholder: "gemini-3.7-flash",
				disabled,
				onBlur: commitText("model", value.model)
			})),
		Row("识别超时（毫秒）", "1000–600000，默认 120000",
			createElement("input", {
				className: "dshva-input",
				type: "number",
				min: 1000,
				max: 600000,
				step: 1000,
				defaultValue: String(value.timeoutMs ?? 120000),
				disabled,
				onBlur: commitTimeout(value.timeoutMs ?? 120000)
			})),
		writable ? null : createElement("p", { className: "dshva-hint" }, "当前配置不可写（只读模式）。"));
}

function apply(ctx) {
	ctx.effect(() => {
		const tagId = "dsh-vision-assist/card.css";
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => tag.remove();
		}
	}, "dsh-vision-assist: settings card styles");
	const scope = ctx.settingsScope.bind({ namespace: NS });
	// 挂官方插槽 settings.plugin.item（设置 → 插件 → 可配置标签页），
	// key = 命名空间，与宿主注册的 vision-assist 命名空间自动配对。
	ctx.slots.inject("settings.plugin.item", () =>
		ctx.slots.register({
			name: "settings.plugin.item",
			key: NS,
			id: "dsh-vision-assist",
			order: 130,
			inject: () => ({ scope })
		}, VisionBridgeCard));
}

export { apply, inject };
