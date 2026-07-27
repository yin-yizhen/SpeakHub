# SpeakSub Code Map

本文件用于快速定位 SpeakSub 的修改入口、数据流和验证方式。

最近完整验收：`uncommitted working tree (2026-07-23; pnpm test, pnpm lint, pnpm build)`

## 先看这里

| 目标 | 主要文件 | 配套测试 | 验证命令 |
| --- | --- | --- | --- |
| 改练习状态、来源或模式 | `src/main/practice-controller.ts`, `src/main/practice-profile.ts`, `src/main/index.ts` | `practice-controller.test.ts`, `practice-profile.test.ts`, `practice-pipeline.integration.test.ts` | `pnpm lint && pnpm test` |
| 改 ChatGPT 网页采集或清理 | `src/main/chatgpt-adapter.ts`, `src/main/chatgpt-automation.ts`, `src/main/chatgpt-marker.ts`, `src/main/background-cleanup.ts` | 对应 ChatGPT adapter/automation/marker 测试 | `pnpm test` 加网页手工验收 |
| 改主窗口、内嵌连接页或菜单栏 | `src/main/index.ts`, `src/main/window-layout.ts`, `src/renderer/styles.css` | `window-layout.test.ts`、ChatGPT adapter/automation 测试 | `pnpm lint && pnpm test && pnpm build` |
| 改 API/ChatGPT 语音、麦克风闸门或复盘 | `src/main/index.ts`, `src/main/chatgpt-microphone-preload.ts`, `src/main/microphone-shortcut.ts`, `src/renderer/App.tsx` | `microphone-shortcut.test.ts`, `chatgpt-automation.test.ts`, `App.voice.test.tsx`, `realtime-audio.test.ts` | `pnpm lint && pnpm test && pnpm build` |
| 改字幕、悬浮词汇卡或悬浮窗结束对话 | `src/renderer/subtitle-overlay.tsx`, `src/main/index.ts`, `src/main/preload.ts`, `src/renderer/App.tsx` | `subtitle-words.test.ts`, `subtitle-overlay.test.tsx`, `App.voice.test.tsx` | `pnpm lint && pnpm test && pnpm build` |
| 改历史、词汇复习或趋势 | `src/main/store.ts`, `src/renderer/LearningCenter.tsx`, `src/shared/types.ts` | `store.test.ts`, `LearningCenter.test.tsx`, `practice-pipeline.integration.test.ts` | `pnpm lint && pnpm test && pnpm build` |

## End-to-End Flow

```text
App.tsx
-> practice:start IPC -> PracticeController
-> ChatGPT automation/adapter, or LearningService/RealtimeVoiceService
-> microphone global shortcut -> main-process gate -> API capture or ChatGPT track.enabled mute
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

练习来源只有 `chatgpt-web` 与 `api-direct`：ChatGPT 模式通过后台网页采集文本；API 直连的文字和 Realtime 语音都直接转成 `TranscriptEvent`。

### ChatGPT 网页模式

`chatgpt-adapter.ts` 观察页面对话文本，`chatgpt-automation.ts` 只发送提示词、发送用户文字和启动/结束网页语音。`chatgpt-microphone-preload.ts` 在 ChatGPT 网页脚本之前接管 `getUserMedia`，保留原始音轨并由 SpeakSub 主进程广播切换 `MediaStreamTrack.enabled`；网页刷新后会主动回报就绪并接收当前闸门状态。`chatgpt-marker.ts` 只记录 SpeakSub 创建的会话 URL。`background-cleanup.ts` 在下一次练习前尝试删除已记录的 ChatGPT 会话，失败会保留记录供重试。

### 统一麦克风闸门

`index.ts` 通过 Electron `globalShortcut` 注册保存在 `AppSettingsStore` 的快捷键（默认 `F8`）；`microphone-shortcut.ts` 负责验证、按键录入格式化和冲突回滚。主进程是闸门状态的唯一来源，并向主窗口广播 `microphone:state`。API 直连收到开启状态后才启动 `RealtimeAudioCapture`，经 `voice:audio` IPC 交给 `RealtimeVoiceService`；ChatGPT 网页则切换已接管的 `MediaStreamTrack.enabled`。开关提示音为 C-E-G（1-3-5）和 G-E-C（5-3-1）。主窗口显示并可点击该开关；悬浮字幕不提供麦克风入口。

### 主窗口与内嵌连接页

`index.ts` 在同一个 `BrowserWindow` 内用 `WebContentsView` 显示右侧 ChatGPT 页面；`connection.pageVisible` 通过 `applyWindowMode` 决定是否显示该视图。左侧 `connection-shell` 固定为 420px，`embeddedConnectionBounds` 让右侧视图紧贴其右边。连接页隐藏后只能隐藏视图，不能销毁其 `webContents`，否则后台采集会中断。主窗口以 `removeMenu()` 移除默认 `File/Edit/View` 菜单；调整窗口大小时必须重新计算嵌入视图的边界。

### 持久化与复盘

`store.ts` 把当前练习原子写入 `current-practice.md`，`session-checkpoint.ts` 每 5 秒刷新。结束后 `learning-service.ts` 基于相同 Markdown 生成复盘，随后事务性改名为 `speaksub-practice-*.md` 并更新 `learning-index.json`；索引失败会把归档恢复为活动文件供重试。异常退出遗留的临时文件会在下次开始时保留为中断记录。

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
| `src/main/store.test.ts` | Markdown 写入、收藏和归档 |
| `src/main/session-checkpoint.test.ts` | 定时检查点与停止 |
| `src/main/window-layout.test.ts` | 字幕窗口边界及内嵌连接页与左侧面板的拼接边界 |
| `src/renderer/LearningCenter.test.tsx` | 学习中心加载、完整复盘和词汇状态交互 |
| `src/renderer/subtitle-overlay.test.tsx` | 锁定字幕后仅保留低干扰解锁入口；活动会话的结束对话与横向关闭字幕操作 |
| `src/renderer/App.voice.test.tsx` | API 语音会话中 F8 控制麦克风与状态提示 |
| `src/renderer/realtime-audio.test.ts` | 麦克风开关的 1-3-5 / 5-3-1 提示音顺序 |
| `src/main/microphone-shortcut.test.ts` | 快捷键格式、按键录入与全局注册冲突回滚 |
| `src/main/practice-pipeline.integration.test.ts` | parser、字幕、Markdown、JSON 索引和搜索边界 |

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
4. 配置 API Base URL、model 和 key 后，启动 API 直连，确认用户与 AI 双方事件进入字幕和 Markdown；使用主窗口按钮和全局快捷键开启/暂停麦克风，确认提示音和输入闸门正常；结束后确认复盘生成。
5. 启动 ChatGPT 网页语音后，用主窗口按钮和全局快捷键切换麦克风；确认网页语音未结束、暂停时 ChatGPT 只收到静音、恢复后能继续说话。到设置页录入新快捷键并重启，确认新按键仍可用；若系统占用组合键，确认保留原快捷键并显示错误。
6. 从未锁定的悬浮字幕工具栏点击“结束对话”，确认主窗口退出练习、复盘出现且 `speaksub-practice-*.md` 已归档；确认“关闭字幕”保持横向且只隐藏字幕，不结束对话。
7. 验证 parser 输出、subtitle event 和 Markdown 入库至少一个关键边界，不能只看 UI。
8. 打开学习中心，验证历史全文搜索和组合筛选；展开完整复盘，再用“准备下一次练习”确认来源、模式、等级、纠错强度和薄弱点已预填但未自动启动。
9. 从字幕收藏同一单词的大小写变体，结束练习后确认词汇中心只出现一项；依次标记学习中和已掌握，确认下次复习日期为 3 天和 14 天后。
10. 切换最近 7/30 天，核对练习次数、Markdown 时长、复盘评分、错误类别与 `learning-index.json` 聚合结果；删除历史后确认 Markdown 和索引同时消失。
