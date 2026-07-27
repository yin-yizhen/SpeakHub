# SpeakSub Code Map

本文件按“要修改什么”索引主文件、调用链、测试和真实验收方式。

最近完整验收提交：`uncommitted working tree (2026-07-27)`

## 先看这里

| 目标 | 主要文件 | 配套测试 | 验证命令 |
| --- | --- | --- | --- |
| 改 API 本地语音、抢话或流式回复 | `src/main/index.ts`、`src/main/local-speech-service.ts` | `local-speech-service.test.ts`、`streaming-asr-session.test.ts`、`App.voice.test.tsx` | `pnpm lint && pnpm test && pnpm build` |
| 改 ASR/VAD/TTS Worker | `src/main/speech-asr-worker.ts`、`src/main/speech-tts-worker.ts` | `audio-pre-roll.test.ts`、`streaming-asr-session.test.ts` | `pnpm test -- audio-pre-roll streaming-asr-session && pnpm build` |
| 改模型下载或安装目录 | `src/main/speech-model-manager.ts` | `speech-model-manager.test.ts` | `pnpm test -- speech-model-manager` |
| 改字幕或音频采集/播放 | `src/renderer/App.tsx`、`src/renderer/local-speech-audio.ts`、`src/renderer/subtitle-overlay.tsx` | `App.voice.test.tsx`、`local-speech-audio.test.ts`、`subtitle-overlay.test.tsx` | `pnpm test -- App.voice local-speech-audio subtitle-overlay` |
| 改归档、历史或复盘 | `src/main/store.ts`、`src/main/learning-service.ts` | `store.test.ts`、`learning-service.test.ts` | `pnpm test -- store learning-service` |
| 改 ChatGPT 网页自动化 | `src/main/chatgpt-automation.ts`、`src/main/chatgpt-adapter.ts` | 对应 `chatgpt-*.test.ts` | `pnpm lint && pnpm test && pnpm build` |

## End-To-End Flow

```text
API 语音练习
-> App.tsx 持续采集 16 kHz Float32（AI 思考/朗读时不停采）
-> voice:audio IPC
-> LocalSpeechService
-> 独立 ASR Worker：Silero VAD -> 400 ms pre-roll -> Zipformer 临时字幕 -> Whisper 最终校正
-> 用户有效抢话
-> main/index.ts 递增 generation，中止旧 SSE、废弃旧 TTS、清空播放器
-> 用户最终字幕入库
-> LearningService /chat/completions SSE
-> SpeechSegmenter
-> 独立 TTS Worker（Kokoro）
-> generation 校验
-> LocalSpeechAudioPlayer 顺序播放
-> 最终 TranscriptEvent 写入 Markdown
```

ChatGPT 网页模式仍使用：

```text
startNewChat -> create session -> start observer -> send prompt -> capture conversation URL
```

## Code Map

### 本地语音与抢话

- `src/main/index.ts`：语音阶段、SSE、generation、抢话取消、播放队列和 IPC 的总编排。
- `src/main/local-speech-service.ts`：分别启动 ASR/TTS Worker；ASR 不因 Kokoro 推理阻塞。
- `src/main/speech-asr-worker.ts`：Silero VAD、400 ms 音频预留、Zipformer 和 Whisper。
- `src/main/streaming-asr-session.ts`：稳定字幕 ID、异步最终校正和多轮重置。
- `src/main/speech-tts-worker.ts`：Kokoro 队列与过期 generation 丢弃。
- `src/renderer/local-speech-audio.ts`：Chromium 回声消除请求、采集重采样、过期音频拒绝和播放中止。

风险点：

- 不得再用 `VoiceTurnPhase` 决定是否采集；它只描述 AI 阶段。
- TTS 和 ASR 必须保持两个 Worker，否则原生合成会阻塞识别。
- 被打断后，SSE delta、TTS 返回值和 playback-ended 都必须经过 generation 校验。
- VAD 模型归入 ASR 资产；缺失时语音入口应引导用户到设置下载。
- 无回声消除的扬声器模式可能误触发，应提示耳机并使用更高抢话门槛。

### 模型资产

- `src/main/speech-model-manager.ts`：固定文件清单、大小/SHA 校验、`.part`、原子改名和离线复用。
- 打包应用目录：`<安装目录>/speech-models`。
- 开发目录：Electron `userData/speech-models`。
- ASR 目录包含 Zipformer、Whisper 和 `silero_vad.onnx`；TTS 目录包含 Kokoro。

### 字幕与归档

- `src/shared/types.ts`：`TranscriptEvent`、语音音频块和公共 IPC 类型。
- `src/shared/transcript.ts`：按稳定 `sourceMessageId` 合并流式字幕。
- `src/main/store.ts`：仅完整事件写 Markdown；被抢话的 AI 回复保留 `interrupted` 标记。
- `src/renderer/subtitle-overlay.tsx`：主页面与悬浮字幕共用同一事件流。

## Test Index

| Test file | Covers |
| --- | --- |
| `src/main/audio-pre-roll.test.ts` | 400 ms 开口预留 |
| `src/main/streaming-asr-session.test.ts` | 中英临时字幕、静音定稿、异步 Whisper、多轮 |
| `src/main/local-speech-service.test.ts` | 双 Worker、合成期间持续 ASR、generation 取消 |
| `src/main/speech-model-manager.test.ts` | 下载、进度、校验、重试、离线复用 |
| `src/main/store.test.ts` | 最终字幕与被打断回复归档 |
| `src/renderer/App.voice.test.tsx` | 持续采集、设置引导、麦克风 UI |
| `src/renderer/local-speech-audio.test.ts` | Float32 重采样和采集块 |
| `src/renderer/subtitle-overlay.test.tsx` | 共用字幕和已打断标记 |

## Local Verification Commands

```powershell
pnpm lint
pnpm test
pnpm build
pnpm dev
```

按用户当前要求不运行 `pnpm package:win`。

## 真实验收

1. 设置中确认 ASR/TTS 已就绪；ASR 目录必须包含 `silero_vad.onnx`。
2. 使用真实 OpenAI-compatible 文本 API 开始语音练习。
3. 中英混说，确认临时字幕持续更新，停顿约 700 ms 后只提交一次。
4. 分别在 AI 思考、生成字幕和朗读时开口；旧声音应在约 300–500 ms 内停止，新字幕不得丢首字。
5. 被打断的 AI 回复应显示“已打断”，归档只保存最终用户文本和最终/被打断 AI 文本。
6. 分别使用耳机和扬声器；扬声器内容不能成为下一轮用户输入。
7. 断网重启，确认本地模型仍可加载。
