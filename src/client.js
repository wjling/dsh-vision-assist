import { createElement, useEffect, useSyncExternalStore } from "react";

/** vision-assist 设置命名空间（与宿主侧 installSettingsSection 一致）。 */
const NS = "vision-assist";
const BRIDGE_PREFIX = "/api/dsh-vision-assist-settings";

// 激活时序关键：settings.plugin.item 是设置 UI 挂载后才**迟声明**的。
// 本插件若只依赖 slots，会在 boot 即激活、早于该插槽声明，导致卡片注册路径在此运行时不可靠。
// 必须像 free-search 一样在 module 级 inject 里带上 commandUi，把激活推迟到 UI 就绪之后。
const inject = ["slots", "commandUi"];

const CSS = `
.dshva-card{min-width:0;margin-bottom:8px;border:1px solid var(--dsw-alias-border-l2, #ddd);background:var(--dsw-alias-bg-layer-3, #fff);border-radius:8px;padding:12px 14px}
.dshva-title{font-weight:600;margin-bottom:4px;color:var(--dsw-alias-label-primary, #eee)}
.dshva-hint{color:var(--dsw-alias-label-secondary, #b0b0b0);font-size:12px;line-height:1.5;margin:0 0 8px}
.dshva-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--dsw-alias-border-l2, #eee)}
.dshva-row:first-of-type{border-top:0}
.dshva-meta{display:flex;flex-direction:column;min-width:0}
.dshva-label{font-size:13px;color:var(--dsw-alias-label-primary, #eee)}
.dshva-fieldhint{color:var(--dsw-alias-label-secondary, #b0b0b0);font-size:11px;margin-top:2px}
.dshva-input{min-width:180px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2, #ccc);border-radius:6px;background:var(--dsw-alias-bg-layer-3, #fff);color:inherit;font-size:13px}
.dshva-check{width:16px;height:16px;accent-color:var(--dsw-alias-accent, #4c8cff)}
.dshva-input:disabled,.dshva-check:disabled{opacity:.5;cursor:not-allowed}
`;

/** 卡片内部设置 store（桥接 /describe、/mutate）。 */
const listeners = new Set();
let state = { status: "loading", optionsStatus: "loading", value: null, writable: false, revision: 0, busy: false, providers: [] };

function setState(next) {
	state = { ...state, ...next };
	for (const listener of [...listeners]) listener();
}

async function bridgeFetch(path, payload) {
	const response = await fetch(`${BRIDGE_PREFIX}/${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		...(payload === undefined ? {} : { body: JSON.stringify(payload) })
	});
	return response.json();
}

async function refresh() {
	try {
		const data = await bridgeFetch("describe");
		const view = data?.ok && Array.isArray(data.value?.namespaces) ? data.value.namespaces[0] : undefined;
		if (view === undefined) {
			setState({ status: "unavailable", value: null, writable: false, busy: false });
			return;
		}
		setState({
			status: "ready",
			value: view.value ?? {},
			writable: data.value.writable !== false,
			revision: view.revision ?? 0,
			busy: false
		});
	} catch {
		setState({ status: "unavailable", value: null, writable: false, busy: false });
	}
}

async function loadOptions() {
	try {
		const data = await bridgeFetch("options");
		const providers = data?.ok && Array.isArray(data.value?.providers) ? data.value.providers : [];
		setState({ providers, optionsStatus: "ready" });
	} catch {
		setState({ providers: [], optionsStatus: "unavailable" });
	}
}

async function commit(field, value) {
	if (state.status !== "ready" || state.busy) return;
	setState({ busy: true });
	try {
		const data = await bridgeFetch("mutate", {
			ns: NS,
			ops: [{ op: "set", path: [field], value }],
			...(typeof state.revision === "number" ? { expectedRevision: state.revision } : {})
		});
		if (data?.ok && data.value) {
			setState({
				value: data.value.value ?? {},
				revision: data.value.revision ?? state.revision,
				busy: false
			});
		} else {
			// 写入失败（冲突/拒绝）→ 回读服务端最新值
			await refresh();
		}
	} catch {
		await refresh();
	}
}

/** 一行配置项：左标签 + 右侧控件。 */
function Row(label, hint, control) {
	return createElement("div", { className: "dshva-row" },
		createElement("div", { className: "dshva-meta" },
			createElement("span", { className: "dshva-label" }, label),
			hint ? createElement("span", { className: "dshva-fieldhint" }, hint) : null),
		control);
}

/** 插件设置卡片：Settings → 插件（可配置标签页）里的 vision-assist 配置。 */
function VisionAssistCard() {
	const snapshot = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => state
	);
	useEffect(() => {
		if (state.status === "loading") refresh();
		if (state.optionsStatus === "loading") loadOptions();
	}, []);

	if (snapshot.status !== "ready") {
		return createElement("div", { className: "dshva-card" },
			createElement("p", { className: "dshva-hint" },
				snapshot.status === "unavailable"
					? "vision-assist 设置命名空间未注册（插件可能未挂载），请重启 DSH 后查看。"
					: "正在读取 vision-assist 配置…"));
	}
	const value = snapshot.value ?? {};
	const writable = snapshot.writable;
	const revision = String(snapshot.revision ?? 0);
	const commitTimeout = (current) => (event) => {
		const parsed = Number(event.target.value);
		if (!Number.isFinite(parsed)) {
			event.target.value = String(current);
			return;
		}
		const next = Math.min(600000, Math.max(1000, Math.round(parsed)));
		if (next !== current) commit("timeoutMs", next);
		event.target.value = String(next);
	};
	const disabled = !writable || snapshot.busy;
	const enabled = value.enabled !== false;
	// 下拉数据：当前 provider + 其带识图能力的模型（无则回退全部，并保证当前值在列）。
	const providers = snapshot.providers ?? [];
	const currentProvider = value.provider ?? "codemaker";
	const providerInfo = providers.find((p) => p.id === currentProvider);
	let modelOptions = (providerInfo?.models ?? []).filter((m) => (m.input ?? []).includes("image"));
	if (modelOptions.length === 0) modelOptions = providerInfo?.models ?? [];
	const currentModel = value.model ?? "gemini-3.7-flash";
	if (!modelOptions.some((m) => m.id === currentModel)) modelOptions = [{ id: currentModel, input: [] }, ...modelOptions];
	const renderOption = (m) => createElement("option", { key: m.id, value: m.id }, m.id);
	return createElement("div", { className: "dshva-card", key: revision },
		createElement("div", { className: "dshva-title" }, "dsh-vision-assist（视觉助手）"),
		createElement("p", { className: "dshva-hint" },
			"无视觉主模型收到图片时，由下面的多模态模型代为识别（vision_recognize 工具）。改动即时生效，无需重启。"),
		Row("启用识别接管", "关闭后完全不接管：主模型按原样收到图片，不注入识别指引，也不提供 vision_recognize 工具",
			createElement("input", {
				className: "dshva-check",
				type: "checkbox",
				checked: enabled,
				disabled,
				onChange: (event) => commit("enabled", event.target.checked)
			})),
		Row("识别模型 provider", "可选自 pi-ai 设置的 provider",
			createElement("select", {
				className: "dshva-input",
				value: currentProvider,
				disabled,
				onChange: (event) => commit("provider", event.target.value)
			}, ...providers.map((p) => createElement("option", { key: p.id, value: p.id }, p.id)))),
		Row("识别模型 model", "带识图能力的多模态模型",
			createElement("select", {
				className: "dshva-input",
				value: currentModel,
				disabled,
				onChange: (event) => commit("model", event.target.value)
			}, ...modelOptions.map(renderOption))),
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
	// 挂官方插槽 settings.plugin.item（设置 → 插件 → 可配置标签页）。
	// 用 free-search 的直连 root 注册方式（其卡片在本部署已验证显示）。
	// 数据读写仍走自建 bridge（/api/dsh-vision-assist-settings），不依赖 settingsScope 的配置 API。
	ctx.slots.inject("settings.plugin.item", () =>
		ctx.slots.register({
			name: "settings.plugin.item",
			key: NS,
			id: "dsh-vision-assist",
			order: 130,
			inject: () => ({})
		}, VisionAssistCard));
}

export { apply, inject };
