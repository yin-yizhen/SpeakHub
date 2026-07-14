# SpeakSub Code Map

本文件用于快速定位 SpeakSub 的修改入口、数据流和验证方式。

最近完整验收：`uncommitted working tree (2026-07-14)`

## 先看这里

| 目标 | 主要文件 | 配套测试 | 验证命令 |
| --- | --- | --- | --- |
| 改练习状态、来源或模式 | `src/main/practice-controller.ts`, `src/main/practice-profile.ts`, `src/main/index.ts` | `practice-controller.test.ts`, `practice-profile.test.ts`, `practice-pipeline.integration.test.ts` | `pnpm lint && pnpm test` |
| 改 ChatGPT 网页采集或清理 | `src/main/chatgpt-adapter.ts`, `src/main/chatgpt-automation.ts`, `src/main/chatgpt-marker.ts`, `src/main/background-cleanup.ts` | 对应 ChatGPT adapter/automation/marker 测试 | `pnpm test` 加网页手工验收 |
| 改 API 文本、语音或复盘 | `src/main/learning-service.ts`, `src/main/realtime-voice-service.ts`, `src/renderer/realtime-audio.ts` | `learning-service.test.ts`, `realtime-voice-service.test.ts` | `pnpm test` |
| 改字幕、词汇卡或归档目录 | `src/renderer/App.tsx`, `src/renderer/subtitle-overlay.tsx`, `src/main/index.ts`, `src/main/store.ts` | `store.test.ts`, `session-checkpoint.test.ts`, `app-settings.test.ts` | `pnpm lint && pnpm test && pnpm build` |

## End-to-End Flow

```text
App.tsx
-> practice:start IPC -> PracticeController
-> ChatGPT automation/adapter, or LearningService/RealtimeVoiceService
-> mergeTranscriptEvent -> subtitle broadcast + SpeakSubStore current-practice.md
-> practice:end -> LearningService.review
-> store.finalizeSession -> speaksub-practice-*.md
```

网页模式的顺序不可反转：`startNewChat -> createSession -> start observer -> send prompt -> capture URL`。发送失败必须停止 observer、写入最终检查点并 abort session。

## 关键模块

### 练习控制与 IPC

`src/main/index.ts` 负责 Electron 窗口、IPC、连接页、活动会话、检查点和归档目录。`practice-controller.ts` 保证开始与结束操作单飞。`practice-profile.ts` 校验场景、难度、来源和模式。

练习来源只有 `chatgpt-web` 与 `api-direct`：ChatGPT 模式通过后台网页采集文本；API 直连的文字和 Realtime 语音都直接转成 `TranscriptEvent`。

### ChatGPT 网页模式

`chatgpt-adapter.ts` 观察页面对话文本，`chatgpt-automation.ts` 发送提示词、发送用户文字、可选语音启动/结束；`chatgpt-marker.ts` 只记录 SpeakSub 创建的会话 URL。`background-cleanup.ts` 在下一次练习前尝试删除已记录的 ChatGPT 会话，失败会保留记录供重试。

### 持久化与复盘

`store.ts` 把当前练习原子写入 `current-practice.md`，`session-checkpoint.ts` 每 5 秒刷新。结束后 `learning-service.ts` 基于相同 Markdown 生成复盘，随后文件改名为 `speaksub-practice-*.md`。异常退出遗留的临时文件会在下次开始时保留为中断记录。

### 字幕与词汇卡

`subtitle-overlay.tsx` 管理悬浮、固定、收藏与关闭。锁定字幕后禁止拖拽和缩放，但仍可查词与收藏。`LocalDictionary` 提供离线查词，API 只做补充。

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

## 验证命令

```powershell
pnpm lint
pnpm test
pnpm build
pnpm package:win
pnpm dev
```

## 真实验收

1. 登录 ChatGPT，选择场景、难度和文字或语音模式；确认网页文本进入字幕和 `current-practice.md`。
2. 结束练习，确认复盘写回并归档为 `speaksub-practice-*.md`；重启后确认只清理记录的 SpeakSub ChatGPT 会话。
3. 配置 API Base URL、model 和 key 后，启动 API 直连，确认用户与 AI 双方事件进入字幕和 Markdown；结束后确认复盘生成。
4. 验证 parser 输出、subtitle event 和 Markdown 入库至少一个关键边界，不能只看 UI。
