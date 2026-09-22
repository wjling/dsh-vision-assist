# 更新日志

`dsh-vision-assist` 的版本变更记录。版本号与 `package.json` 一致，遵循[语义化版本](https://semver.org/lang/zh-CN/)；
每个版本对应的 tag 见 [Tags](https://github.com/wjling/dsh-vision-assist/tags)。

## 兼容性对照

| 插件版本 | DSH 版本 | 配置写在哪 |
|---|---|---|
| **1.1.0**（当前） | ≥ 0.1.7-alpha.1 | profile 的 `cordis.patch.yml` 里 `- id: vision-assist` 条目的 `config` |
| 1.0.0 | 0.1.0-rc.8 时代（仅 rc.8 实测；0.1.7 之前的版本线沿用同一套配置与插槽模型） | `~/.dsh/settings.yaml` 的 `vision-assist:` 段落 |

DSH 0.1.7 把插件配置从 `settings.yaml` 命名空间改成 Loader 条目 `config`，同时插件侧的宿主包解析改为
「总是用运行时安装的那一份」。两个大版本的配置互不通用，跨版本升级先看 [1.1.0 的迁移说明](#迁移)。

---

## [1.1.0] - 2026-09-22

适配 DSH 0.1.7-alpha.1。

### 变更

- **配置模型**：`settings.yaml` 命名空间 → Loader 条目 `config`（schemastery volatile 字段 +
  `loader/volatile-update` 热更新）。设置页点保存即生效，不再依赖 settings 命名空间服务。
- **请求改写**：不再 monkey-patch 私有的 `llm.streamWithRegistration`，改为包裹公开的
  `ctx.llm.prepareCall`（agent-loop 主路径）与 `ctx.llm.stream`（标题、压缩等直连调用方）。
- **判据来源**：改用宿主解析出的 `inputModalities`（`prepareCall` 的结果 / `resolveModelInfo` 的原始值），
  不再自己读 `llm-pi-ai` 配置；适配器未声明模态时交给 DSH 原生管线，不干预。
- **设置卡片**：改用 `ctx.configForms` + Plugins 面板的 `plugins.item` 插槽；卡片只在宿主确实提供
  `vision-assist` 命名空间时注册。弃用自建 HTTP 桥（`/api/dsh-vision-assist-settings`）与
  `settings.plugin.item` 插槽。
- **设置体验**：改为「暂存 + 保存」模型（改动后才可保存，每项可「恢复默认」），与 DSH 内置插件设置页一致。
- **依赖声明**：`@deepseek-ai/dsh-llm` / `dsh-tools` / `schemastery` 改为 peerDependencies——DSH 会把
  它们路由到运行时安装的那一份，不再需要担心插件目录里的旧副本遮蔽宿主版本；`engines.dsh >= 0.1.7-alpha.1`。
- **工具注册**：`vision_recognize` 继续跟随总开关热增删，关闭时完全不接管（不注入指引、不提供工具）。

### 修复

- 插件在 DSH ≥ 0.1.7 上整包加载失败（`The requested module '@deepseek-ai/dsh-settings' does not provide
  an export named 'settingsNamespace'`），现在可以正常激活。

### 迁移

旧 `settings.yaml` 里的 `vision-assist:` 段落作废。把值写到 profile 的 `cordis.patch.yml`：

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: vision-assist
  config:
    enabled: true
    provider: codemaker          # 视觉模型所在 provider（llm-pi-ai 里已配置）
    model: gemini-3.8-flash      # 视觉模型 id（需声明 input: [text, image]）
    timeoutMs: 300000            # 单次识别超时（毫秒）
```

改完重启 DSH；之后也可以直接在设置页改（两者写的是同一份配置）。
设置入口：**侧边栏「插件」面板 → 「官方」分组 → 「视觉助手 vision-assist」**。

---

## [1.0.0] - 2026-09-20

首个公开版本，面向 DSH 0.1.0-rc.8 时代（配置在 `settings.yaml` 的 `vision-assist:` 命名空间）。

### 功能

- **`vision_recognize` 工具**：用设置里选定的多模态模型识别本地图片，支持 `coarse` / `default` / `fine`
  三档精细度，可附加自定义 prompt。
- **模型调用边界图片降级**：主模型无视觉时，发往该模型的请求被克隆改写（图片块 → 附件仓路径 +
  `vision_recognize` 调用指引）；GUI 气泡与会话历史始终保留原图。
- **设置页卡片**：在 Web 设置页直接选识别模型，热更新生效。
- **provider / model 下拉**：选项来自 `llm-pi-ai` 的模型目录，优先列出声明了图片输入的模型；切换总开关时
  `vision_recognize` 会跟着注册 / 注销。

### 修复

- 接管 `resolveModelInfo`，解除 api-proxy 对无视觉模型的发送前拒收（`MODEL_DOES_NOT_SUPPORT_IMAGES`），
  图片得以正常进入会话。
- 图片改写从 inbox 层移到 LLM 调用边界，避免 GUI 气泡被替换成指引文字、会话历史丢图。
- 宿主共享包（`dsh-llm` / `dsh-settings` / `dsh-tools`）改为 peerDependencies，避免插件目录里的旧副本
  遮蔽宿主版本。
- 设置卡片每次打开都重取 provider / 模型列表，修「同步模型后下拉不刷新」。

---

[1.1.0]: https://github.com/wjling/dsh-vision-assist/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/wjling/dsh-vision-assist/releases/tag/v1.0.0
[Tags]: https://github.com/wjling/dsh-vision-assist/tags
