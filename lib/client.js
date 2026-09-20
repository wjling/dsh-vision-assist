window.__ModuleLoader__.load({id:"dsh-vision-assist",factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");
var NS = "vision-assist";
var BRIDGE_PREFIX = "/api/dsh-vision-assist-settings";
var inject = ["slots", "commandUi"];
var CSS = `
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
var listeners = /* @__PURE__ */ new Set();
var state = { status: "loading", optionsStatus: "loading", value: null, writable: false, revision: 0, busy: false, providers: [] };
function setState(next) {
  state = { ...state, ...next };
  for (const listener of [...listeners]) listener();
}
async function bridgeFetch(path, payload) {
  const response = await fetch(`${BRIDGE_PREFIX}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...payload === void 0 ? {} : { body: JSON.stringify(payload) }
  });
  return response.json();
}
async function refresh() {
  try {
    const data = await bridgeFetch("describe");
    const view = data?.ok && Array.isArray(data.value?.namespaces) ? data.value.namespaces[0] : void 0;
    if (view === void 0) {
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
      ...typeof state.revision === "number" ? { expectedRevision: state.revision } : {}
    });
    if (data?.ok && data.value) {
      setState({
        value: data.value.value ?? {},
        revision: data.value.revision ?? state.revision,
        busy: false
      });
    } else {
      await refresh();
    }
  } catch {
    await refresh();
  }
}
function Row(label, hint, control) {
  return (0, import_react.createElement)(
    "div",
    { className: "dshva-row" },
    (0, import_react.createElement)(
      "div",
      { className: "dshva-meta" },
      (0, import_react.createElement)("span", { className: "dshva-label" }, label),
      hint ? (0, import_react.createElement)("span", { className: "dshva-fieldhint" }, hint) : null
    ),
    control
  );
}
function VisionAssistCard() {
  const snapshot = (0, import_react.useSyncExternalStore)(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state
  );
  (0, import_react.useEffect)(() => {
    if (state.status === "loading") refresh();
    loadOptions();
  }, []);
  if (snapshot.status !== "ready") {
    return (0, import_react.createElement)(
      "div",
      { className: "dshva-card" },
      (0, import_react.createElement)(
        "p",
        { className: "dshva-hint" },
        snapshot.status === "unavailable" ? "vision-assist \u8BBE\u7F6E\u547D\u540D\u7A7A\u95F4\u672A\u6CE8\u518C\uFF08\u63D2\u4EF6\u53EF\u80FD\u672A\u6302\u8F7D\uFF09\uFF0C\u8BF7\u91CD\u542F DSH \u540E\u67E5\u770B\u3002" : "\u6B63\u5728\u8BFB\u53D6 vision-assist \u914D\u7F6E\u2026"
      )
    );
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
    const next = Math.min(6e5, Math.max(1e3, Math.round(parsed)));
    if (next !== current) commit("timeoutMs", next);
    event.target.value = String(next);
  };
  const disabled = !writable || snapshot.busy;
  const enabled = value.enabled !== false;
  const providers = snapshot.providers ?? [];
  const currentProvider = value.provider ?? "codemaker";
  const providerInfo = providers.find((p) => p.id === currentProvider);
  let modelOptions = (providerInfo?.models ?? []).filter((m) => (m.input ?? []).includes("image"));
  if (modelOptions.length === 0) modelOptions = providerInfo?.models ?? [];
  const currentModel = value.model ?? "gemini-3.7-flash";
  if (!modelOptions.some((m) => m.id === currentModel)) modelOptions = [{ id: currentModel, input: [] }, ...modelOptions];
  const renderOption = (m) => (0, import_react.createElement)("option", { key: m.id, value: m.id }, m.id);
  return (0, import_react.createElement)(
    "div",
    { className: "dshva-card", key: revision },
    (0, import_react.createElement)("div", { className: "dshva-title" }, "dsh-vision-assist\uFF08\u89C6\u89C9\u52A9\u624B\uFF09"),
    (0, import_react.createElement)(
      "p",
      { className: "dshva-hint" },
      "\u65E0\u89C6\u89C9\u4E3B\u6A21\u578B\u6536\u5230\u56FE\u7247\u65F6\uFF0C\u7531\u4E0B\u9762\u7684\u591A\u6A21\u6001\u6A21\u578B\u4EE3\u4E3A\u8BC6\u522B\uFF08vision_recognize \u5DE5\u5177\uFF09\u3002\u6539\u52A8\u5373\u65F6\u751F\u6548\uFF0C\u65E0\u9700\u91CD\u542F\u3002"
    ),
    Row(
      "\u542F\u7528\u8BC6\u522B\u63A5\u7BA1",
      "\u5173\u95ED\u540E\u5B8C\u5168\u4E0D\u63A5\u7BA1\uFF1A\u4E3B\u6A21\u578B\u6309\u539F\u6837\u6536\u5230\u56FE\u7247\uFF0C\u4E0D\u6CE8\u5165\u8BC6\u522B\u6307\u5F15\uFF0C\u4E5F\u4E0D\u63D0\u4F9B vision_recognize \u5DE5\u5177",
      (0, import_react.createElement)("input", {
        className: "dshva-check",
        type: "checkbox",
        checked: enabled,
        disabled,
        onChange: (event) => commit("enabled", event.target.checked)
      })
    ),
    Row(
      "\u8BC6\u522B\u6A21\u578B provider",
      "\u53EF\u9009\u81EA pi-ai \u8BBE\u7F6E\u7684 provider",
      (0, import_react.createElement)("select", {
        className: "dshva-input",
        value: currentProvider,
        disabled,
        onChange: (event) => commit("provider", event.target.value)
      }, ...providers.map((p) => (0, import_react.createElement)("option", { key: p.id, value: p.id }, p.id)))
    ),
    Row(
      "\u8BC6\u522B\u6A21\u578B model",
      "\u5E26\u8BC6\u56FE\u80FD\u529B\u7684\u591A\u6A21\u6001\u6A21\u578B",
      (0, import_react.createElement)("select", {
        className: "dshva-input",
        value: currentModel,
        disabled,
        onChange: (event) => commit("model", event.target.value)
      }, ...modelOptions.map(renderOption))
    ),
    Row(
      "\u8BC6\u522B\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
      "1000\u2013600000\uFF0C\u9ED8\u8BA4 120000",
      (0, import_react.createElement)("input", {
        className: "dshva-input",
        type: "number",
        min: 1e3,
        max: 6e5,
        step: 1e3,
        defaultValue: String(value.timeoutMs ?? 12e4),
        disabled,
        onBlur: commitTimeout(value.timeoutMs ?? 12e4)
      })
    ),
    writable ? null : (0, import_react.createElement)("p", { className: "dshva-hint" }, "\u5F53\u524D\u914D\u7F6E\u4E0D\u53EF\u5199\uFF08\u53EA\u8BFB\u6A21\u5F0F\uFF09\u3002")
  );
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
  ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
    name: "settings.plugin.item",
    key: NS,
    id: "dsh-vision-assist",
    order: 130,
    inject: () => ({})
  }, VisionAssistCard));
}
exports.apply=apply;exports.inject=inject;return module.exports;}});
