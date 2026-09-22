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
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var NS = "vision-assist";
var PI_NS = "llm-pi-ai";
var inject = ["slots", "configForms"];
var CSS = `
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
var LABELS = {
  unavailable: "\u8BE5\u63D2\u4EF6\u5F53\u524D\u672A\u52A0\u8F7D\uFF0C\u6682\u65F6\u65E0\u6CD5\u914D\u7F6E\u3002",
  readOnly: "\u672C\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002",
  saveFailed: "\u5BBF\u4E3B\u6CA1\u6709\u63A5\u53D7\u8FD9\u4E9B\u503C\uFF0C\u5DF2\u4FDD\u7559\u4F9B\u4F60\u4FEE\u6539\u3002",
  save: "\u4FDD\u5B58",
  saving: "\u4FDD\u5B58\u4E2D\u2026"
};
function booleanField(field) {
  return {
    field,
    format: (value) => value === false ? "false" : "true",
    parse: (text) => ({ kind: "set", value: text === "true" })
  };
}
function providersOf(section) {
  const providers = section?.providers;
  if (providers === null || typeof providers !== "object") return [];
  return Object.entries(providers).map(([id, info]) => ({
    id,
    models: Array.isArray(info?.models) ? info.models.map((model) => ({ id: model.id, input: Array.isArray(model.input) ? model.input : [] })) : []
  }));
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
function withReset(fieldState, onReset, control, disabled) {
  return (0, import_react.createElement)(
    "div",
    { className: "dshva-control" },
    control,
    fieldState?.overridden === true ? (0, import_react.createElement)("button", {
      type: "button",
      className: "dshva-reset",
      disabled,
      onClick: onReset
    }, "\u6062\u590D\u9ED8\u8BA4") : null
  );
}
function VisionAssistCard(props) {
  if (props.view === "summary") {
    return "\u65E0\u89C6\u89C9\u4E3B\u6A21\u578B\u6536\u5230\u56FE\u7247\u65F6\uFF0C\u4EA4\u7ED9\u4E0B\u9762\u9009\u5B9A\u7684\u591A\u6A21\u6001\u6A21\u578B\u8BC6\u522B\uFF08vision_recognize \u5DE5\u5177\uFF09\u3002";
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
  return (0, import_react.createElement)(
    import_dsh_client_ui_primitives.SettingsForm,
    {
      labels: LABELS,
      state,
      onSave: props.save,
      onDiscard: props.discard
    },
    (0, import_react.createElement)(
      "p",
      { className: "dshva-hint" },
      "\u65E0\u89C6\u89C9\u4E3B\u6A21\u578B\u6536\u5230\u56FE\u7247\u65F6\uFF0C\u7531\u4E0B\u9762\u7684\u591A\u6A21\u6001\u6A21\u578B\u4EE3\u4E3A\u8BC6\u522B\uFF08vision_recognize \u5DE5\u5177\uFF09\u3002\u6539\u52A8\u70B9\u300C\u4FDD\u5B58\u300D\u540E\u5373\u65F6\u751F\u6548\uFF0C\u65E0\u9700\u91CD\u542F\u3002"
    ),
    Row(
      "\u542F\u7528\u8BC6\u522B\u63A5\u7BA1",
      "\u5173\u95ED\u540E\u5B8C\u5168\u4E0D\u63A5\u7BA1\uFF1A\u4E3B\u6A21\u578B\u6309\u539F\u6837\u6536\u5230\u56FE\u7247\uFF0C\u4E0D\u6CE8\u5165\u8BC6\u522B\u6307\u5F15\uFF0C\u4E5F\u4E0D\u63D0\u4F9B vision_recognize \u5DE5\u5177",
      (0, import_react.createElement)("input", {
        className: "dshva-check",
        type: "checkbox",
        checked: state.enabled?.text === "true",
        disabled,
        onChange: (event) => props.edit("enabled", event.target.checked ? "true" : "false")
      })
    ),
    Row(
      "\u8BC6\u522B\u6A21\u578B provider",
      "\u6765\u81EA llm-pi-ai \u914D\u7F6E\u7684 provider",
      withReset(
        state.provider,
        () => props.resetField("provider"),
        (0, import_react.createElement)(
          "select",
          {
            className: "dshva-input",
            value: currentProvider,
            disabled: disabled || providers.length === 0,
            onChange: (event) => props.edit("provider", event.target.value)
          },
          providers.length === 0 ? (0, import_react.createElement)("option", { value: currentProvider }, currentProvider || "\uFF08llm-pi-ai \u672A\u914D\u7F6E provider\uFF09") : providers.map((provider) => (0, import_react.createElement)("option", { key: provider.id, value: provider.id }, provider.id)),
          providers.length > 0 && !providers.some((provider) => provider.id === currentProvider) && currentProvider !== "" ? (0, import_react.createElement)("option", { value: currentProvider }, currentProvider) : null
        ),
        disabled
      )
    ),
    Row(
      "\u8BC6\u522B\u6A21\u578B model",
      "\u4F18\u5148\u5217\u51FA\u58F0\u660E\u4E86\u56FE\u7247\u8F93\u5165\u7684\u591A\u6A21\u6001\u6A21\u578B",
      withReset(
        state.model,
        () => props.resetField("model"),
        (0, import_react.createElement)(
          "select",
          {
            className: "dshva-input",
            value: currentModel,
            disabled: disabled || models.length === 0,
            onChange: (event) => props.edit("model", event.target.value)
          },
          models.length === 0 ? (0, import_react.createElement)("option", { value: currentModel }, currentModel) : models.map((model) => (0, import_react.createElement)("option", { key: model.id, value: model.id }, model.id))
        ),
        disabled
      )
    ),
    Row(
      "\u8BC6\u522B\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
      "1000\u2013600000\uFF0C\u9ED8\u8BA4 120000",
      withReset(
        state.timeoutMs,
        () => props.resetField("timeoutMs"),
        (0, import_react.createElement)("input", {
          className: "dshva-input",
          type: "text",
          inputMode: "numeric",
          value: state.timeoutMs?.text ?? "",
          disabled,
          onChange: (event) => props.edit("timeoutMs", event.target.value)
        }),
        disabled
      )
    ),
    state.invalid ? (0, import_react.createElement)("p", { className: "dshva-hint" }, "\u6709\u5B57\u6BB5\u586B\u5F97\u4E0D\u5408\u6CD5\uFF0C\u8BF7\u4FEE\u6B63\u540E\u518D\u4FDD\u5B58\u3002") : null
  );
}
var CardController = class {
  constructor(ctx) {
    const scope = ctx.configForms.get(NS);
    this.form = new import_dsh_client_ui_primitives.SettingsFormModel(scope, [
      booleanField("enabled"),
      (0, import_dsh_client_ui_primitives.settingsTextField)("provider"),
      (0, import_dsh_client_ui_primitives.settingsTextField)("model"),
      (0, import_dsh_client_ui_primitives.settingsNumberField)("timeoutMs")
    ]);
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      enabled: this.form.field("enabled"),
      provider: this.form.field("provider"),
      model: this.form.field("model"),
      timeoutMs: this.form.field("timeoutMs")
    }));
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
};
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
  ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject("plugins.item", () => ctx.slots.register({
    name: "plugins.item",
    id: NS,
    order: 130,
    label: () => "\u89C6\u89C9\u52A9\u624B vision-assist",
    inject: () => card.inject()
  }, VisionAssistCard))), "dsh-vision-assist: settings card");
}
exports.apply=apply;exports.inject=inject;return module.exports;}});
