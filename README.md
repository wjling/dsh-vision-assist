# dsh-vision-assist

> **Vision for text-only models in DeepSeek Harness (DSH).** Give a model that cannot
> see images a pluggable multimodal "vision sidecar": paste an image and recognition is
> handed to a configurable VLM, so the conversation never trips the
> `model does not support image input` rejection.
>
> **🇨🇳 中文**：给没有视觉能力的主模型配一个可随时切换的多模态识别模型，输入框图片开箱即用。

![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![node](https://img.shields.io/badge/node-%3E%3D20-blue)

When the routed model cannot accept images, this plugin intercepts the request at the
LLM call boundary and rewrites the image blocks into a "local attachment path + a call
to `vision_recognize`" text hint. The message body and the UI history keep the original
image; only the request sent to the vision-less model is rewritten. The actual
recognition is done by the multimodal model you pick in settings.

```bash
# install from this repo
dsh plugin --profile web add github:wjling/dsh-vision-assist
# restart DSH to activate
```

```bash
# local development
git clone https://github.com/wjling/dsh-vision-assist
cd dsh-vision-assist
pnpm install
pnpm run build:client   # rebuild lib/client.js after editing src/client.js
```

---

## 功能

1. **`vision_recognize` 工具**（host 级注册，任意会话可用）：用选定多模态模型识别本地图片，
   支持三档精细度 `coarse` / `default` / `fine`，可附加自定义 prompt。
2. **模型调用边界图片降级**：当会话路由模型无视觉输入时，发往该模型的请求在
   `ctx.llm.prepareCall` / `ctx.llm.stream` 边界被克隆改写（图片块 → 附件仓路径 +
   `vision_recognize` 指引）；能看图的模型不受任何干预。GUI 气泡与会话历史始终保留原图。
3. **热更新配置 + 设置页 UI**：识别模型在 DSH 设置 → 插件 → 「视觉助手 vision-assist」
   卡片里直接改，改完点保存即时生效（无需重启），也可以改 profile patch 里的条目 config。

## 安装

```bash
dsh plugin --profile web add github:wjling/dsh-vision-assist
# 重启 DSH 生效
```

> 宿主共享包 `@deepseek-ai/dsh-llm` / `dsh-tools` / `schemastery` 按
> **peerDependencies** 声明：DSH 在加载链上的插件时会把它们路由到**运行时安装的
> 那一份**（不会被插件目录里的旧副本遮蔽），`schemastery` 的 `.volatile()` 等新 API
> 也因此始终可用。client 段构建产物为 `lib/client.js`（esbuild CJS 工厂，
> `react` 与 `@deepseek-ai/dsh-client-ui-primitives` 由客户端模块系统的种子表提供）。

要求 **DSH ≥ 0.1.7-alpha.1**（插件配置模型在 0.1.7 从 `settings.yaml` 命名空间改为
Loader 条目 config；旧版本 DSH 请用 v1.0.0）。

## 配置

**方式一：DSH 设置页**（推荐）——设置 → 插件 → 「视觉助手 vision-assist」卡片：

- 启用识别接管（总开关）
- 识别模型 provider（下拉：来自 `llm-pi-ai` 已配置的 provider）
- 识别模型 model（下拉：优先列出声明了图片输入的模型）
- 识别超时（毫秒，1000–600000）

**方式二：profile patch**（与设置页写的是同一份配置，改完重启或热更新）：

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: vision-assist
  config:
    enabled: true            # 总开关，false 时工具与图片改写都停用
    provider: codemaker      # 识别模型所在 provider（需在 llm-pi-ai 中配置）
    model: gemini-3.8-flash  # 识别模型 id
    timeoutMs: 300000        # 单次识别超时（毫秒）
```

> 从旧版升级：原来写在 `~/.dsh/settings.yaml` 里的 `vision-assist:` 段落已随 DSH
> 的迁移机制作废，请把它挪成上面 profile patch 里的一段（或直接在设置页重填一次）。

要求：选定的模型在 `llm-pi-ai.providers.<provider>.models` 中声明了
`input: [text, image]`（未声明的模型会被 DSH 视为纯文本而拒绝图片）。

## 工作原理

```
输入框贴图发送
   │  api-session-controller 入站模态预检（resolveModelInfo 声明图片能力）→ 消息正常进入会话
   ▼
GUI 气泡显示原图，会话历史保留图片
   │  主模型回合发起 llm 调用
   ▼
包裹 prepareCall（agent-loop 主路径）/ stream（标题、压缩等直连调用方）：
路由到无视觉模型（宿主解析出的 inputModalities 不含 image）？
   ├─ 否 → 原样放行（同一个请求对象，不改写）
   └─ 是 → 克隆请求，图片块（含 tool-role 消息）替换为
          "附件仓路径 + 调用 vision_recognize" 的文本指引
                      ▼
               主模型正常接单 → 调用 vision_recognize(path=..., mediaType=...)
                      ▼
          ctx.llm.stream 直连选定多模态模型 → 返回识别文本 → 继续任务
```

判据用**宿主自己解析出的模态**（`prepareCall` 的 `inputModalities` /
`resolveModelInfo` 的原始结果），不再自己读 `llm-pi-ai` 配置：适配器没声明模态
（`undefined`）时交给 DSH 原生管线，不干预。`vision_recognize` 内部发起的视觉调用带
internal 标记，不会被自己改写。

## 兼容性

- 目标环境：DSH `0.1.7-alpha.1`，Node ≥ 20
- 插件全部逻辑在用户空间（`~/.dsh` + 插件包本体），**更新 DSH 后无需任何重装或补丁**
- host + client 双段：
  - host 段用 `@deepseek-ai/dsh-llm` 的 `prepareCall` / `stream` / `resolveModelInfo`、
    `@deepseek-ai/dsh-tools` 的 `defineTool`，配置用 `schemastery` 的 volatile 字段 +
    `loader/volatile-update` 事件热更新；
  - client 段用 `ctx.configForms`（设置域基础服务）读写自己的命名空间，注册进
    Plugins 面板的 `plugins.item` 插槽，改动 `src/client.js` 后需执行
    `pnpm run build:client` 重建。

## FAQ

- **图片会不会丢？** 不会。原图始终保存在 `~/.dsh/attachments/v1/objects/`（内容寻址），
  界面与会话历史保留图片，只有"发往无视觉模型的那次请求"里被替换为识别指引。
- **怎么换识别模型？** 设置 → 插件 → 「视觉助手 vision-assist」卡片里改 provider/model，
  保存即生效。
- **识别模型报 "does not support image input"？** 该模型在 `llm-pi-ai` 里没声明
  `input: [text, image]`，补上声明后重试。
- **会话切成视觉模型后图片没有改写，正常吗？** 正常——插件只干预无视觉的模型。
- **关掉总开关会怎样？** 完全不接管：不暴露 `vision_recognize`，也不改写请求；此时
  把图片发给无视觉模型会收到 DSH 原生的模态拒收提示。

## Roadmap

- [x] client 设置 UI（在 Web 设置页直接选识别模型）
- [ ] 多图并行识别
- [ ] 识别结果缓存（同 attachmentId 不重复调模型）

## License

MIT
