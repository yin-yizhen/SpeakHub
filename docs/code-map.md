# SpeakSub Code Map

本文件用于快速定位 SpeakSub 的修改入口、数据流和验证方式。

最近完整验收：`uncommitted working tree (2026-07-27; pnpm lint, pnpm test, pnpm build, pnpm package:win)`

## 先看这里

| 目标 | 主要文件 | 配套测试 | 验证命令 |
| --- | --- | --- | --- |
| 改练习状态、来源或模式 | `src/main/practice-controller.ts`, `src/main/practice-profile.ts`, `src/main/index.ts` | `practice-controller.test.ts`, `practice-profile.test.ts`, `practice-pipeline.integration.test.ts` | `pnpm lint && pnpm test` |
| 改 ChatGPT 网页采集或清理 | `src/main/chatgpt-adapter.ts`, `src/main/chatgpt-automation.ts`, `src/main/chatgpt-marker.ts`, `src/main/background-cleanup.ts` | 对应 ChatGPT adapter/automation/marker 测试 | `pnpm test` 加网页手工验收 |
| 改主窗口、内嵌连接页或菜单栏 | `src/main/index.ts`, `src/main/window-layout.ts`, `src/renderer/styles.css` | `window-layout.test.ts`、ChatGPT adapter/automation 测试 | `pnpm lint && pnpm test && pnpm build` |
| 改全局配色、字体、控件状态或按钮动效 | `src/renderer/styles.css`, `src/renderer/overlay.css` | `App.voice.test.tsx`, `LearningCenter.test.tsx`, `subtitle-overlay.test.tsx` | `pnpm lint && pnpm test && pnpm build` |
| 改本地 ASR/TTS、模型下载或半双工 | `src/main/speech-model-manager.ts`, `src/main/speech-worker.ts`, `src/main/local-speech-service.ts`, `src/main/index.ts`, `src/renderer/local-speech-audio.ts` | `speech-model-manager.test.ts`, `streaming-asr-session.test.ts`, `speech-segments.test.ts`, `App.voice.test.tsx`, `local-speech-audio.test.ts` | `pnpm lint && pnpm test && pnpm build && pnpm package:win` |
| 改 DeepSeek/OpenAI-compatible 流式回复 | `src/main/learning-service.ts`, `src/main/index.ts`, `src/main/speech-segments.ts` | `learning-service.test.ts`, `speech-segments.test.ts`, `sequential-task-queue.test.ts`, `store.test.ts` | `pnpm lint && pnpm test` |
| 改 ChatGPT 语音或统一麦克风闸门 | `src/main/index.ts`, `src/main/chatgpt-microphone-preload.ts`, `src/main/microphone-shortcut.ts`, `src/renderer/App.tsx` | `microphone-shortcut.test.ts`, `chatgpt-automation.test.ts`, `App.voice.test.tsx` | `pnpm lint && pnpm test && pnpm build` |
| 改字幕、悬浮词汇卡或悬浮窗结束对话 | `src/renderer/subtitle-overlay.tsx`, `src/renderer/overlay.css`, `src/main/index.ts`, `src/main/preload.ts`, `src/renderer/App.tsx` | `subtitle-words.test.ts`, `subtitle-overlay.test.tsx`, `App.voice.test.tsx` | `pnpm lint && pnpm test && pnpm build` |
| 改历史、词汇复习或趋势 | `src/main/store.ts`, `src/renderer/LearningCenter.tsx`, `src/shared/types.ts` | `store.test.ts`, `LearningCenter.test.tsx`, `practice-pipeline.integration.test.ts` | `pnpm lint && pnpm test && pnpm build` |
| 改匿名使用埋点或 SLS 上报 | `src/main/analytics.ts`, `src/main/index.ts` | `analytics.test.ts` | `pnpm lint && pnpm test && pnpm build && pnpm package:win` |

## End-to-End Flow

```text
App.tsx
-> practice:start IPC -> PracticeController
-> ChatGPT automation/adapter, or local ASR Worker
-> 16 kHz Float32 chunks -> bilingual Zipformer partial/final transcript
-> 1.2 s endpoint -> LearningService /chat/completions SSE
-> delta -> shared TranscriptEvent + SpeechSegmenter
-> Kokoro Worker -> 24 kHz Float32 chunks -> ordered renderer playback
-> playback acknowledgements -> resume local listening (half duplex)
-> microphone global shortcut -> main-process gate -> local capture or ChatGPT track.enabled mute
-> mergeTranscriptEvent -> subtitle broadcast + SpeakSubStore current-practice.md
-> practice:end -> LearningService.review
-> store.finalizeSession -> speaksub-practice-*.md + learning-index.json
-> practice:ended broadcast -> App.tsx and subtitle-overlay.tsx clear active-session UI
-> LearningCenter -> history search / vocabulary queue / dashboard / next-practice draft
```

网页模式的顺序不可反转：`startNewChat -> createSession -> start observer -> send prompt -> capture URL`。发送失败必须停止 observer、写入最终检查点并 abort session。

## 关键模块

### 练习控制与 IPC

`src/main/index.ts` 负责 Electron 窗口、IPC、连接页、活动会话、检查点和归档目录。`practice-controller.ts` 保证开始与结束操作单飞。`practice-profile.ts` 校验场景、难度、来源和模式。

练习来源只有 `chatgpt-web` 与 `api-direct`：ChatGPT 模式通过后台网页采集文本；API 直连文字与本地语音都直接转成同一组 `TranscriptEvent`。

### API 本地双语语音

`speech-model-manager.ts` 把固定版本模型下载到 Electron `userData/speech-models`。ASR 是 `zipformer-small-bilingual-zh-en-32-int8` 的四个独立文件；TTS 是 `kokoro-int8-multi-lang-v1_1`。下载必须写 `.part`，验证固定字节数与 SHA-256 后原子改名；Kokoro 在已验证压缩包解压完成后原子移动。模型齐全后不能联网。

`speech-worker.ts` 是 electron-vite 的独立 main entry；`local-speech-service.ts` 管理 Worker 请求。`streaming-asr-session.ts` 保持同一轮临时/最终字幕 ID，endpoint rule 2 为 1.2 秒，空定稿不发送。`learning-service.ts` 解析任意网络分块的标准 SSE；只有尚未收到 delta 时允许一次非流式回退。`speech-segments.ts` 按中英文句末标点切分，超过 120 字时回退到最近逗号或空格。`sequential-task-queue.ts` 保证 TTS 与播放器入队顺序。

Electron 禁止原生 external ArrayBuffer；Kokoro `generate` 必须传 `enableExternalBuffer: false`，否则打包后会报 `External buffers are not allowed`。Windows 包还必须把 `sherpa-onnx-node` 与 `sherpa-onnx-win-x64` 放入 `asarUnpack`。

`VoiceTurnPhase` 的真实链路是 `listening -> thinking -> synthesizing -> speaking -> listening`。只在 `listening` 且用户麦克风偏好开启时采集；AI 生成和播放期间停止实际采集，但不修改用户偏好。结束练习必须先中止流式请求，再停止 Worker 和播放器。

### ChatGPT 网页模式

`chatgpt-adapter.ts` 观察页面对话文本，`chatgpt-automation.ts` 只发送提示词、发送用户文字和启动/结束网页语音。`chatgpt-microphone-preload.ts` 在 ChatGPT 网页脚本之前接管 `getUserMedia`，保留原始音轨并由 SpeakSub 主进程广播切换 `MediaStreamTrack.enabled`；网页刷新后会主动回报就绪并接收当前闸门状态。`chatgpt-marker.ts` 只记录 SpeakSub 创建的会话 URL。`background-cleanup.ts` 在下一次练习前尝试删除已记录的 ChatGPT 会话，失败会保留记录供重试。

### 统一麦克风闸门

`index.ts` 通过 Electron `globalShortcut` 注册保存在 `AppSettingsStore` 的快捷键（默认 `F8`）；`microphone-shortcut.ts` 负责验证、按键录入格式化和冲突回滚。主进程是闸门状态的唯一来源，并向主窗口广播 `microphone:state`。API 直连默认不采集，收到开启状态且阶段为 `listening` 后才启动 `LocalSpeechAudioCapture`；ChatGPT 网页默认保持可输入，只有用户切换 SpeakSub 闸门后才切换已接管的 `MediaStreamTrack.enabled`。开关提示音为 C-E-G（1-3-5）和 G-E-C（5-3-1）。

### 主窗口与内嵌连接页

`index.ts` 在同一个 `BrowserWindow` 内用 `WebContentsView` 显示右侧 ChatGPT 页面；`connection.pageVisible` 通过 `applyWindowMode` 决定是否显示该视图。左侧 `connection-shell` 固定为 420px，`embeddedConnectionBounds` 让右侧视图紧贴其右边。连接页隐藏后只能隐藏视图，不能销毁其 `webContents`，否则后台采集会中断。主窗口以 `removeMenu()` 移除默认 `File/Edit/View` 菜单；调整窗口大小时必须重新计算嵌入视图的边界。

### 匿名使用埋点

`analytics.ts` 只在 Electron 主进程运行，持久化匿名安装 ID 到 `userData/anonymous-analytics.json`，并向 SLS `speaksub-event` 发送 `app_open`、每 60 秒 `app_heartbeat` 与退出时的 `app_close`。`index.ts` 必须在主窗口完成首次加载后才调用 `start()`，并在 `before-quit` 中调用 `close()`。允许字段严格限定为应用标识、匿名 ID、会话 ID、版本、OS、架构、首次启动标识和关闭时长；不得向模块传入练习内容、设置或密钥。SLS 端还必须关联字段白名单写入处理器，以删除来源/IP 元字段。

### 持久化与复盘

`store.ts` 把当前练习原子写入 `current-practice.md`，`session-checkpoint.ts` 每 5 秒刷新。临时字幕只在内存和 UI 更新；Markdown 只包含 `complete` 事件，避免 token 级重写或把半截回复归档。结束后 `learning-service.ts` 基于相同 Markdown 生成复盘，随后事务性改名为 `speaksub-practice-*.md` 并更新 `learning-index.json`。

### 学习中心

`src/renderer/LearningCenter.tsx` 提供总览、历史和词汇三个子页。历史支持全文与来源/模式/CEFR/日期筛选、完整复盘、永久删除；词汇按 NFKC 标准化去重，使用陌生/学习中/已掌握三级状态安排当天、3 天、14 天复习；总览聚合滚动 7/30 天练习时长、CEFR 估算、能力分数与常见错误。

`store.ts` 的 `learning-index.json` 是版本化、带备份的本地查询索引。启动时扫描最终与中断 Markdown，索引损坏时从备份或 Markdown 重建。老归档缺失的来源、模式、CEFR 和评分保持为空，不伪造趋势数据。

### 字幕与词汇卡

`subtitle-overlay.tsx` 管理悬浮、固定、收藏与关闭。未锁定时工具栏分成设置行与操作行：活动会话可在左侧“结束对话”，右侧“关闭字幕”始终横排；结束对话调用同一条 `practice:end` IPC。主进程归档完成后广播 `practice:ended`，主窗口和悬浮窗共同清除活动状态。锁定字幕后禁止拖拽和缩放，但仍可查词与收藏。`LocalDictionary` 提供离线查词，API 只做补充。

## Test Index

| Test file | Covers |
| --- | --- |
| `src/main/practice-controller.test.ts` | 开始/结束单飞和状态迁移 |
| `src/main/practice-profile.test.ts` | 来源、模式、场景和 CEFR 校验 |
| `src/main/chatgpt-adapter.test.ts` | ChatGPT DOM 解析 |
| `src/main/chatgpt-automation.test.ts` | ChatGPT 控件选择和发送 |
| `src/main/chatgpt-marker.test.ts` | 已记录 ChatGPT 会话校验 |
| `src/main/learning-service.test.ts` | API 直连、复盘与查词边界 |
| `src/main/speech-model-manager.test.ts` | 模型进度、大小/SHA 校验、失败重试、原子文件和离线复用 |
| `src/main/streaming-asr-session.test.ts` | 中英临时结果、稳定 ID、静音定稿、空结果和多轮重置 |
| `src/main/speech-segments.test.ts` | 混合标点、跨 delta 与 120 字无标点切段 |
| `src/main/sequential-task-queue.test.ts` | TTS 生成和播放入队顺序 |
| `src/main/store.test.ts` | Markdown 只归档最终事件、收藏和归档 |
| `src/main/session-checkpoint.test.ts` | 定时检查点与停止 |
| `src/main/window-layout.test.ts` | 字幕窗口边界及内嵌连接页与左侧面板的拼接边界 |
| `src/renderer/LearningCenter.test.tsx` | 学习中心加载、完整复盘和词汇状态交互 |
| `src/renderer/subtitle-overlay.test.tsx` | 锁定字幕后仅保留低干扰解锁入口；活动会话的结束对话与横向关闭字幕操作 |
| `src/renderer/App.voice.test.tsx` | API/ChatGPT 麦克风闸门及 API 半双工停采/恢复 |
| `src/renderer/local-speech-audio.test.ts` | 16 kHz Float32 重采样和麦克风提示音 |
| `src/main/microphone-shortcut.test.ts` | 快捷键格式、按键录入与全局注册冲突回滚 |
| `src/main/practice-pipeline.integration.test.ts` | parser、字幕、Markdown、JSON 索引和搜索边界 |
| `src/main/analytics.test.ts` | 匿名 ID 持久化、会话更新、字段白名单、心跳、关闭时长和网络失败隔离 |

## 验证命令

```powershell
pnpm lint
pnpm test
pnpm build
pnpm package:win
pnpm dev
```

## 真实验收

1. 打开连接页，确认只有一个 SpeakSub 窗口、没有 `File/Edit/View` 菜单，左侧连接说明与右侧 ChatGPT 网页紧贴；最小化和恢复后网页仍在同一窗口，返回练习台后后台网页仍可继续采集。
2. 登录 ChatGPT，选择场景、难度和文字或语音模式；确认网页文本进入字幕和 `current-practice.md`。
3. 结束练习，确认复盘写回并归档为 `speaksub-practice-*.md`；重启后确认只清理记录的 SpeakSub ChatGPT 会话。
4. 配置 DeepSeek-compatible Base URL、model 和 key 后启动 API 语音；首次确认 ASR/TTS 各自进度、错误可重试，模型目录位于 `userData/speech-models`。
5. 中英混说时确认“我”字幕持续原位更新，停顿约 1.2 秒只提交一次；DeepSeek 回复逐步显示，第一句结束后即可发声，不等待全文完成。
6. 确认中文、英文和混合短句均按顺序播放；AI 生成和播放时实际采集停止，全部文字及声音完成后自动恢复监听，扬声器内容不会成为下一轮输入。
7. 退出重启并断网，确认两组本地模型仍能加载；结束练习后确认 Markdown 只含每轮最终用户/AI 文本，没有临时 ASR 或流式半句。
8. 启动 ChatGPT 网页语音后，用主窗口按钮和全局快捷键切换麦克风；确认网页语音行为保持不变。
9. 从悬浮字幕结束对话，确认主窗口退出练习、复盘出现且 Markdown 已归档；同时核对 SSE parser 输出、chunk 切分和最终入库，不能只看 UI。
10. 打开学习中心，验证历史、词汇和趋势仍能读取新归档。
11. 打包版启动后，在 SLS 查询 `event: app_open`；运行超过一分钟确认 `app_heartbeat`，正常退出确认 `app_close` 与 `duration_seconds`。重启后匿名 ID 应不变、会话 ID 应改变；最终入库记录不得出现 IP、来源元字段或任何练习内容。
