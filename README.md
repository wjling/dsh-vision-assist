# dsh-vision-assist

DeepSeek Harness 视觉助手插件：给**没有视觉能力的主模型**配一个**可随时切换的多模态识别模型**，让输入框图片开箱即用。

主模型（如 `deepseek-v4-pro`）不支持图片输入时，在输入框贴图发送会整轮报错
（`pi-ai model "..." does not support image input`）。本插件在消息进入模型**之前**拦截图片，
改写成"本地路径 + 工具调用指引"，主模型调用 `vision_recognize` 即可完成看图——识别工作
由你在 settings 里选定的多模态模型完成。

## 功能

1. **`vision_recognize` 工具**（host 级注册，任意会话可用）：用选定多模态模型识别本地图片，
   支持三档精细度 `coarse` / `default` / `fine`，可附加自定义 prompt。
2. **输入框图片自动降级**：当会话路由模型无视觉输入时，图片块在 inbox 阶段被原位替换为
   "图片已保存到 `<附件仓路径>` + 请调用 `vision_recognize`"的文本；能看图的模型不受任何干预。
3. **热更新配置**：识别模型在 settings 的 `vision-bridge` 命名空间里随时换，无需重启。

## 安装

```bash
dsh plugin --profile web add dsh-vision-assist
# 重启 DSH 生效
```

> 插件依赖 `@deepseek-ai/dsh-llm` / `dsh-settings` / `dsh-tools`（锁定
> `0.1.0-rc.8`，与开发时使用的 DSH 版本一致）与 `schemastery`，全部为常规
> dependencies，由包管理器随插件一起安装，无需任何额外配置。

## 配置

settings.yaml（热更新）：

```yaml
vision-bridge:
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
   │  agent/inbox/inserted 事件
   ▼
判断会话路由模型是否支持图片（读 requestHeader + llm-pi-ai 配置）
   ├─ 支持 → 不干预，图片原样进入模型
   └─ 不支持 → 图片块改写为文本（本地附件仓路径 + vision_recognize 调用指引）
                     ▼
              主模型正常接单 → 调用 vision_recognize(path=..., mediaType=...)
                     ▼
          ctx.llm.stream 直连选定多模态模型 → 返回识别文本 → 继续任务
```

## 兼容性

- 开发/测试环境：DSH `0.1.0-rc.8`，Node ≥ 20
- 插件全部逻辑在用户空间（`~/.dsh` + 插件包本体），**更新 DSH 后无需任何重装或补丁**
- 纯 host 插件，无 client 段；配置 UI 在路线图上

## FAQ

- **为什么图片变成了文字？** 这是本插件对"无视觉模型"的降级策略：图片原图仍保存在
  `~/.dsh/attachments/v1/objects/`（内容寻址），识别由 `vision_recognize` 完成。
- **怎么换识别模型？** 改 settings 的 `vision-bridge.provider/model` 即可，立即生效。
- **识别模型报 "does not support image input"？** 该模型在 `llm-pi-ai` 里没声明
  `input: [text, image]`，补上声明后重试。
- **会话切成视觉模型后图片没有改写，正常吗？** 正常——插件只干预无视觉的模型。

## Roadmap

- [ ] client 设置 UI（在 Web 设置页直接选识别模型）
- [ ] 多图并行识别
- [ ] 识别结果缓存（同 attachmentId 不重复调模型）

## License

MIT
