# dsh-vision-assist

DeepSeek Harness 视觉助手插件：给**没有视觉能力的主模型**配一个**可随时切换的多模态识别模型**，让输入框图片开箱即用。

主模型（如 `deepseek-v4-pro`）不支持图片输入时，在输入框贴图发送会整轮报错
（`pi-ai model "..." does not support image input`）。本插件在**模型调用边界**拦截图片，
把发往无视觉模型的请求里的图片块换成"本地路径 + 工具调用指引"（消息本体与界面显示不动），
主模型调用 `vision_recognize` 即可完成看图——识别工作由你在 settings 里选定的多模态模型完成。

## 功能

1. **`vision_recognize` 工具**（host 级注册，任意会话可用）：用选定多模态模型识别本地图片，
   支持三档精细度 `coarse` / `default` / `fine`，可附加自定义 prompt。
2. **模型调用边界图片降级**：当会话路由模型无视觉输入时，发往该模型的请求在
   `llm.streamWithRegistration` 边界被克隆改写（图片块 → 附件仓路径 + `vision_recognize`
   指引）；能看图的模型不受任何干预。GUI 气泡与会话历史始终保留原图。
3. **热更新配置 + 设置页 UI**：识别模型可在 DSH 设置 → 插件（可配置标签页）的
   "视觉助手 vision-assist" 卡片里直接改，或改 settings 的 `vision-assist` 命名空间，均即时生效。

## 安装

```bash
dsh plugin --profile web add dsh-vision-assist
# 重启 DSH 生效
```

> 宿主共享包 `@deepseek-ai/dsh-llm` / `dsh-settings` / `dsh-tools` 按
> **peerDependencies** 声明（运行时由 DSH 宿主提供，不遮蔽宿主版本）；
> 开发环境通过 devDependencies 安装同名版本用于本地解析。`schemastery`
> 是唯一常规依赖。client 段构建产物为 `lib/client.js`（esbuild CJS 工厂，
> `react` 由宿主模块系统外部提供）。

## 配置

**方式一：DSH 设置页**（推荐）——设置 → 插件 → 可配置标签页 → "视觉助手 vision-assist" 卡片：

- 启用识别接管（总开关）
- 识别模型 provider（如 `codemaker`）
- 识别模型 model（如 `gemini-3.7-flash`）
- 识别超时（毫秒，1000–600000）

**方式二：settings.yaml**（热更新，两种方式写的是同一份配置）：

```yaml
vision-assist:
  enabled: true          # 总开关，false 时工具与图片改写都停用
  provider: codemaker    # 识别模型所在 provider（需在 llm-pi-ai 中配置）
  model: gemini-3.7-flash  # 识别模型 id
  timeoutMs: 120000      # 单次识别超时（毫秒）
```

要求：选定的模型在 `llm-pi-ai.providers.<provider>.models` 中声明了
`input: [text, image]`（未声明的模型会被 DSH 视为纯文本而拒绝图片）。

## 工作原理

```
输入框贴图发送
   │  api-proxy 模态预检（resolveModelInfo 声明图片能力）→ 消息正常进入会话
   ▼
GUI 气泡显示原图，会话历史保留图片
   │  主模型回合发起 llm 调用（llm.stream / preparedCall.stream）
   ▼
包裹 streamWithRegistration：路由到无视觉 pi-ai 模型？
   ├─ 否 → 原样放行
   └─ 是 → 克隆请求，图片块（含 tool-result 嵌套）替换为
          "附件仓路径 + 调用 vision_recognize" 的文本指引
                      ▼
               主模型正常接单 → 调用 vision_recognize(path=..., mediaType=...)
                      ▼
          ctx.llm.stream 直连选定多模态模型 → 返回识别文本 → 继续任务
```

## 兼容性

- 开发/测试环境：DSH `0.1.0-rc.8`，Node ≥ 20
- 插件全部逻辑在用户空间（`~/.dsh` + 插件包本体），**更新 DSH 后无需任何重装或补丁**
- host + client 双段：client 段仅注册设置卡片（`settings.plugin.item` 插槽），
  改动 `src/client.js` 后需执行 `npm run build:client` 重建

## FAQ

- **图片会不会丢？** 不会。原图始终保存在 `~/.dsh/attachments/v1/objects/`（内容寻址），
  界面与会话历史保留图片，只有"发往无视觉模型的那次请求"里被替换为识别指引。
- **怎么换识别模型？** 设置 → 插件 → "视觉助手 vision-assist" 卡片里改 provider/model，
  或改 settings 的 `vision-assist.provider/model`，立即生效。
- **识别模型报 "does not support image input"？** 该模型在 `llm-pi-ai` 里没声明
  `input: [text, image]`，补上声明后重试。
- **会话切成视觉模型后图片没有改写，正常吗？** 正常——插件只干预无视觉的模型。

## Roadmap

- [x] client 设置 UI（在 Web 设置页直接选识别模型）
- [ ] 多图并行识别
- [ ] 识别结果缓存（同 attachmentId 不重复调模型）

## License

MIT
