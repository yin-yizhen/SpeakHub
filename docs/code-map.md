# SpeakHub Code Map

## Subtitle Overlay Interaction

- Entry: `src/renderer/subtitle-overlay.tsx`; window control: `src/main/index.ts`; renderer IPC bridge: `src/main/preload.ts`.
- Flow: word/control hover -> `subtitle:interactive` -> `BrowserWindow.setIgnoreMouseEvents`; three-bar drag -> `subtitle:move` -> persisted overlay bounds.
- Tests: `src/renderer/subtitle-overlay.test.tsx`.
- Verify: `pnpm exec vitest run src/renderer/subtitle-overlay.test.tsx`; then start the app and drag the three bars only while unlocked. Confirm locking prevents movement and transparent subtitle areas still click through.

本文件按“要改什么”定位入口、数据流、测试和验收方式。最近完整验收提交：`unknown (v0.1.0 release validation, 2026-07-28)`。

## 先看这里

| 目标 | 主要文件 | 配套测试 | 验证命令 |
| --- | --- | --- | --- |
| 改练习入口、界面状态或 IPC | `src/renderer/App.tsx`、`src/renderer/app-state.ts`、`src/main/preload.ts`、`src/main/index.ts` | `App.voice.test.tsx`、`app-state.test.ts`、`practice-pipeline.integration.test.ts` | `pnpm lint && pnpm test && pnpm build` |
| 改 ChatGPT 网页自动化 | `src/main/chatgpt-automation.ts`、`src/main/chatgpt-adapter.ts`、`src/main/index.ts` | `chatgpt-automation.test.ts`、`chatgpt-adapter.test.ts` | `pnpm test && pnpm build`，再做登录态验收 |
| 改 API 对话、语音或抢话 | `src/main/index.ts`、`src/main/local-speech-service.ts`、`src/main/speech-segments.ts`、`src/main/barge-in-policy.ts` | 同名测试、`practice-pipeline.integration.test.ts`、`App.voice.test.tsx` | `pnpm test && pnpm build` |
| 改字幕、查词或窗口布局 | `src/renderer/subtitle-overlay.tsx`、`src/shared/transcript.ts`、`src/shared/subtitle-words.ts`、`src/main/window-layout.ts` | 同名测试 | `pnpm lint && pnpm test && pnpm build` |
| 改归档、复盘、词汇或学习中心 | `src/main/store.ts`、`src/main/learning-service.ts`、`src/renderer/LearningCenter.tsx` | `store.test.ts`、`learning-service.test.ts`、`LearningCenter.test.tsx`、`practice-pipeline.integration.test.ts` | `pnpm lint && pnpm test && pnpm build` |
| 改设置、默认值或密钥 | `src/shared/defaults.ts`、`src/main/app-settings.ts`、`src/main/secure-settings.ts`、`src/renderer/App.tsx` | `app-settings.test.ts`、`secure-settings.test.ts`、`App.voice.test.tsx` | `pnpm lint && pnpm test` |
| 改自动更新或 Windows 发布 | `src/main/update-service.ts`、`src/main/index.ts`、`src/main/preload.ts`、`src/renderer/use-app-updates.ts` | `update-service.test.ts`、`update-prompt.test.ts`、`App.voice.test.tsx` | `pnpm lint && pnpm test && pnpm package:win` |

## End-To-End Flow

```text
App.tsx
-> preload.ts（window.speaksub）
-> index.ts（IPC 与运行状态）
-> PracticeController
-> ChatGPTAutomation / LearningService / LocalSpeechService
-> transcript 合并与 SpeechSegmenter 分段
-> SpeakSubStore checkpoint、归档、复盘和 learning-index.json
-> IPC 事件返回 App / SubtitleOverlay / LearningCenter
```

学习中心“准备下一次练习”链路：

```text
LearningCenter.createNextPracticeDraft()
-> store.createNextPracticeDraft()
-> App.useNextPracticeDraft()
-> app-state.templateSelectionForDraft()
-> savePracticePreferences()
-> 下一次 practice:start 使用对应模板
```

ChatGPT 网页语音链路：

```text
practice:start
-> prepareWebPractice()
-> 新建聊天并 fillAndSendPrompt()
-> 确认输入框内容已离开
-> 等待首条完整回复稳定
-> 启动语音按钮
-> ChatGPTAdapter 解析字幕并写入归档
```

API 直连消息链路：

```text
App 选择的场景/难度/纠错提示词与本次重点
-> shared/direct-chat-prompt.ts 叠加固定英语优先规则
-> LearningService 把完整内容放入 messages[0].system
-> 最终字幕依次作为 user / assistant 历史
-> OpenAI-compatible /chat/completions（SSE 优先）
```

应用更新链路：

```text
App 启动 5 秒 / 设置页手动检查
-> preload IPC
-> UpdateService 读取 yin-yizhen/SpeakHub 最新 GitHub Release
-> App 显示版本和 Release 正文
-> 主进程下载到 userData/updates/downloads
-> 校验大小、SHA-256（存在时）和 Windows MZ 文件头
-> shell.openPath 打开 NSIS 安装器
```

## Code Map

### 主进程与 IPC

- `src/main/index.ts`：Electron 生命周期、窗口、IPC、练习状态与各服务编排。文件较大；修改时应沿具体 IPC 链路定位，不要只看 UI。
- `src/main/preload.ts`：渲染进程 API 白名单；所有持续事件统一经 `onIpc()` 注册并返回解绑函数。
- `src/main/practice-controller.ts`：开始/结束去重和生命周期状态。
- `src/main/update-service.ts`：GitHub Release 解析、版本比较、安装包下载、镜像安全门控、进度、校验和安装器启动。

### 练习与语音

- `src/main/practice-profile.ts`：练习参数解析与提示词组合。
- `src/main/chatgpt-automation.ts`：ChatGPT DOM 定位、发送、等待回复、语音启动和历史删除。
- `src/main/chatgpt-adapter.ts`：ChatGPT 页面消息解析及观察。
- `src/main/local-speech-service.ts`：VAD、云端识别与本地 TTS worker 编排。
- `src/main/speech-segments.ts`：流式文本分段，是 TTS chunk 边界的唯一实现。
- `src/shared/direct-chat-prompt.ts`：生成 API 直连的完整 `system`；固定英语占比和残缺/错误输入处理规则，再叠加所选提示词与本次练习重点。

### 数据与学习

- `src/main/store.ts`：`current-practice.md`、最终 Markdown 和 `learning-index.json` 的唯一写入入口。
- `src/main/session-checkpoint.ts`：练习中的增量落盘。
- `src/main/learning-service.ts`：LLM 消息角色组装、SSE 解析和复盘结构化；对话历史必须保持 `system -> user / assistant` 顺序。
- `src/renderer/LearningCenter.tsx`：历史、完整复盘、词汇和复习 UI。

### 渲染与共享配置

- `src/renderer/App.tsx`：主界面组合与客户端交互状态。
- `src/renderer/use-app-updates.ts`：启动延迟检查、手动检查、下载进度及更新弹窗状态。
- `src/renderer/update-prompt.ts`：仅保存“跳过此版本”的本地偏好；手动检查不受它限制。
- `src/renderer/app-state.ts`：可独立测试的界面状态派生和模板映射。
- `src/renderer/subtitle-overlay.tsx`：字幕展示、选词、收藏、文本发送与缩放。
- `src/shared/defaults.ts`：跨主进程和渲染进程共用的纯数据默认值；不得依赖 Electron 或 Node API。
- `src/shared/types.ts`：IPC 和跨进程数据契约。

## Test Index

| Test file | Covers |
| --- | --- |
| `src/main/practice-pipeline.integration.test.ts` | 参数解析、对话事件、checkpoint 与归档入库真实链路 |
| `src/main/store.test.ts` | chunk 合并、Markdown、复盘、搜索、词汇和索引持久化 |
| `src/main/speech-segments.test.ts` | TTS 分段边界 |
| `src/main/chatgpt-automation.test.ts` | 网页 DOM、发送确认、回复稳定和清理 |
| `src/main/learning-service.test.ts` | 完整 system 组合、user/assistant 历史顺序、SSE 与非流式回退 |
| `src/renderer/App.voice.test.tsx` | 来源、模式、语音门控、设置和客户端事件 |
| `src/renderer/app-state.test.ts` | 生命周期忙碌状态、下一次练习模板映射 |
| `src/renderer/subtitle-overlay.test.tsx` | 字幕、查词、收藏和交互状态 |
| `src/renderer/LearningCenter.test.tsx` | 历史详情、词汇列表和复习卡 |
| `src/main/update-service.test.ts` | Release 解析、版本比较、下载通道、大小/SHA-256/MZ 校验与残留清理 |
| `src/renderer/update-prompt.test.ts` | 跳过版本的持久化与新版本重新提示 |
| `src/renderer/App.voice.test.tsx` | 启动检查、更新正文、手动检查、下载进度和失败回退 |

## Common Change Recipes

### 修改练习参数

1. 修改 `shared/types.ts` 或 `practice-profile.ts`。
2. 同步 `preload.ts`、`index.ts` 与 `App.tsx`。
3. 更新 `practice-profile.test.ts`、`app-state.test.ts` 或 `App.voice.test.tsx`。
4. 运行全量验证。
5. 至少检查一次 `practice-pipeline.integration.test.ts` 的解析、事件和入库边界。

### 修改字幕或流式语音

1. 字幕筛选改 `shared/transcript.ts`，语音 chunk 改 `speech-segments.ts`。
2. 不要在 UI 内复制解析或分段规则。
3. 运行对应单元测试和集成测试。
4. 本地启动后检查连续流式文本没有丢字、重复或提前入库。

### 发布 Windows 新版本

1. 按 `X.Y.Z` 提升 `package.json` 版本号。
2. 更新代码和 Release 正文；正文会原样显示在更新弹窗中。
3. 运行 `pnpm lint`、`pnpm test`、`pnpm build` 和 `pnpm package:win`。
4. 推送源码后创建 `vX.Y.Z` 正式 Release，上传 `SpeakHub-X.Y.Z-Setup.exe`。
5. 通过 GitHub API 确认 tag、正文、exe 资产及 `sha256` digest，再用旧版应用验收提示、下载和安装器启动。

## Subtitle Layout Rule

- `SubtitlePreferences` no longer stores a layout choice: AI and user subtitles always render on the same side.
- Legacy saved `layout` values are ignored while reading settings; verify this migration in `app-settings.test.ts`.

## API Voice Shutdown Safety

- Entry: `src/main/index.ts` 的 `practice:end`；worker 编排在 `src/main/local-speech-service.ts`，原生任务分别在 `speech-vad-worker.ts` 与 `speech-tts-worker.ts`。
- Flow: 取消当前回复 -> 停止接收新语音任务 -> 等待正在运行的 sherpa/ONNX 调用完成 -> worker 关闭消息端口并自然退出 -> 生成复盘 -> 归档入库。
- Risk: 不得在 `OfflineTts.generateAsync()` 或 VAD 原生调用仍运行时直接调用 `Worker.terminate()`；这会导致 Electron 以 `0xc0000409` 原生退出。正常关闭也不得通过全局 error listener 上报为失败。
- Tests: `src/main/local-speech-service.test.ts` 必须覆盖 stop 已发送但 worker 尚未退出时，`LocalSpeechService.stop()` 仍保持等待，并确认正常退出不产生错误事件。
- Verify: `pnpm exec vitest run src/main/local-speech-service.test.ts src/main/practice-pipeline.integration.test.ts && pnpm build`；真实验收时在 AI 正在合成或播放语音时点击“结束并生成复盘”，确认应用不退出、复盘完成且归档可打开。

## Local Verification Commands

```powershell
pnpm lint
pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters
pnpm test
pnpm build
pnpm package:win
pnpm dev
```

## Known Runtime Notes

- ChatGPT DOM 会变化；发送成功必须以输入内容离开输入框为准，不能只判断按钮已点击。
- ChatGPT 的发送键可能不在输入框的近层父容器中；定位时须优先全页的具名发送键，随后按输入框右下角位置兜底，并排除麦克风和语音按钮。
- ChatGPT 新建聊天后输入框可能先显示、后才接受文本；`fillAndSendPrompt()` 可等待 45 秒取得焦点，但成功聚焦后只输入一次并立即点击发送，失败时保留草稿并返回错误，绝不重复输入提示词。
- ChatGPT 清理失败时必须保留 marker，供下次启动重试；不能删除普通用户对话。
- 不要只看 UI 截图猜修复点；至少验证解析输出、chunk 输出和入库结果中的一个或多个边界。
- `store.ts` 是学习索引和复习日期的唯一写入点；列表刷新不得触发 LLM 网络回退。
- `main.tsx` 与 `overlay-main.tsx` 由两个 HTML 入口引用，静态未使用扫描可能误报，不能删除。
- `.playwright-cli/` 与 `artifacts/` 是本地验收产物，除非明确纳入版本控制，否则视为用户工作区内容。
- 正式版直接加载打包后的本地 HTML，不启动 localhost 服务，也不占用固定端口。
- 自动更新只接受 `yin-yizhen/SpeakHub` 的正式 GitHub Release；第三方镜像仅在资产带 GitHub SHA-256 digest 时启用。
