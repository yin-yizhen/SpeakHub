# SpeakSub Code Map

本文件是 SpeakSub 后续查找、修改、测试和审查代码的项目索引，按“我要改什么”组织。

最近完整验收提交：`uncommitted working tree (2026-07-14)`

## 先看这里

| 目标 | 主要文件 | 配套测试 | 验证命令 |
| --- | --- | --- | --- |
| 改练习状态、来源或模式 | `src/main/practice-controller.ts`, `src/main/practice-profile.ts`, `src/main/index.ts` | `practice-controller.test.ts`, `practice-profile.test.ts`, `practice-pipeline.integration.test.ts` | `pnpm lint && pnpm test` |
| 改 ChatGPT/Gemini 网页采集与清理 | `src/main/*-adapter.ts`, `src/main/*-automation.ts`, `src/main/background-cleanup.ts` | `src/main/chatgpt-*.test.ts`, `src/main/gemini-*.test.ts`, `background-cleanup.test.ts` | `pnpm test` 加对应网页真实验收 |
| 改 API 文本、Realtime 语音或音频 | `src/main/learning-service.ts`, `src/main/realtime-voice-service.ts`, `src/renderer/realtime-audio.ts` | `learning-service.test.ts`, `realtime-voice-service.test.ts` | `pnpm test` 加 API/麦克风真实验收 |
| 改字幕、连接页或学习本 | `src/renderer/App.tsx`, `src/renderer/subtitle-overlay.tsx`, `src/main/app-settings.ts` | `renderer/app-state.test.ts`, `app-settings.test.ts`, Electron 手工验收 | `pnpm lint && pnpm build` |
| 改 Markdown 入库、历史或收藏 | `src/main/store.ts` | `store.test.ts`, `practice-pipeline.integration.test.ts` | `pnpm test` |

## End-To-End Flow

```text
App.tsx 选择 PracticeProfile
-> practice:start IPC（Zod 边界）
-> PracticeController 单飞状态：idle -> starting -> active
-> Web adapter / LearningService / RealtimeVoiceService
-> mergeTranscriptEvent
-> 字幕广播 + SpeakSubStore 原子写入 Markdown/JSON
-> practice:end：active -> ending -> idle
-> LearningService.review -> 历史复盘与下一次建议
```

网页模式的关键顺序不可反转：`startNewChat -> createSession -> start observer -> send prompt -> capture URL`。这样首轮用户提示和模型回复才能进入 parser、字幕和归档；发送失败必须停止 observer 并 `abortSession`。

## Code Map

### 练习控制与 IPC

`src/main/practice-controller.ts` 管理开始/结束单飞和生命周期；`src/main/practice-profile.ts` 统一场景、CEFR、纠错强度、来源、模式和提示词。`src/main/index.ts` 只负责 Electron 窗口、IPC 绑定和各服务编排。不要重新引入第二套会话状态。

连接 readiness 按 ChatGPT/Gemini 分开持久化，用户确认登录时还会检查当前域名和输入框。API direct 可跳过网页登录。IPC 的 profile、消息、字幕、resize、学习本和 provider 设置都需要运行时校验。

### 网页采集与安全清理

ChatGPT 与 Gemini 保持独立 selector。observer 在发送提示词前安装；ChatGPT parser 只选择外层 turn，避免与内层 role 节点重复。streaming/complete 变化使用同一个 `sourceMessageId` 更新。

清理仅处理 marker 中记录的精确 URL。删除脚本必须找到目标链接所属行、完成二次确认并验证目标消失；任何一步不确定都返回失败并保留 marker，不能点击页面第一个通用 More/Delete。

### API 与 Realtime

`LearningService` 使用保留 Base URL 路径的 `chat/completions` 地址并设置 30 秒总超时。`RealtimeVoiceService` 默认当前 OpenAI session/audio 结构，也提供显式 `legacy` profile；连接超时或 open 前关闭必须拒绝启动。

`realtime-audio.ts` 使用 AudioWorklet 采集、线性重采样到 24 kHz，并在服务端 speech-started 事件到达时中断尚未播放的模型音频。API Key 只保存在主进程 safeStorage，不得出现在日志、URL 或归档。

### 持久化与学习闭环

`app-settings.ts` 保存每个网页提供商 readiness 和字幕偏好/位置；损坏文件回退默认值。锁定字幕时窗口鼠标穿透，需要从主设置页取消锁定。

`store.ts` 每次 transcript upsert 都原子更新人类可读 Markdown，并写 JSON 索引供历史页读取；旧的纯 Markdown 会话仍可列出。学习本按 kind/text 去重，支持删除。诊断日志只记录会话 ID、阶段、字符数和条数等脱敏字段并自动轮换。

## Test Index

| Test | Covers |
| --- | --- |
| `practice-controller.test.ts` | 重复开始/结束、失败状态与重置 |
| `practice-profile.test.ts` | 场景、CEFR、纠错与非法 IPC 值 |
| `practice-pipeline.integration.test.ts` | parser -> transcript -> subtitle -> Markdown 边界 |
| `chatgpt-adapter.test.ts`, `gemini-adapter.test.ts` | DOM fixture、嵌套去重、说话人解析 |
| `background-cleanup.test.ts`, marker tests | 顺序删除、失败保留和并发写保护 |
| `realtime-voice-service.test.ts` | current/legacy profile、音频/转录、打断、提前关闭 |
| `learning-service.test.ts` | 本地词典、API URL、请求与 JSON 边界 |
| `store.test.ts` | 增量归档、历史、收藏去重与删除 |
| `app-settings.test.ts`, `secure-settings.test.ts` | 分提供商状态、损坏恢复和 Key 清除 |
| `renderer/app-state.test.ts` | 收藏即时出现和按钮忙碌态 |

## Local Verification Commands

```powershell
pnpm lint
pnpm test
pnpm build
pnpm package:win
pnpm dev
```

## 真实验收

1. ChatGPT/Gemini：用一次性对话登录，开始后确认首轮 user/assistant 都出现在字幕与会话 Markdown；结束并重启，再开始时确认只删除 marker 记录的旧对话。
2. API text：Base URL 保留 `/v1` 等路径，发送一轮后核对 parser 等价事件、字幕、Markdown 和历史复盘；测试 30 秒超时。
3. API voice：分别验证 current 与 legacy profile；测试麦克风拒绝、错误 endpoint、说话打断播放、双方 completed transcript、结束后的连接/麦克风清理。
4. 字幕：移动、缩放、样式、锁定后重启；锁定时鼠标应穿透，主设置页取消锁定后恢复操作。
5. 学习本：收藏重复词句只保留一条，新增即时出现，可删除；旧 Markdown 和新 JSON 会话都能出现在历史中。

## Known Runtime Notes

- 网页 DOM 会随 ChatGPT/Gemini 更新而变化；不能只看 UI 截图判断成功，至少核对 parser 输出、subtitle event 和 Markdown 入库中的一个或多个边界。
- 自动清理宁可保留 marker 重试，也不能在目标链接不唯一时猜测删除。
- `resources/dictionaries/ecdict-en-zh/<letter>.json.br` 必须随安装包发布；`word` 查询依赖 `w.json.br`。
- `speaksub-diagnostics.jsonl` 位于 Electron userData，仅允许脱敏字段，不记录 API Key、完整认证 URL 或转录正文。
