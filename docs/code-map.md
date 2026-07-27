# SpeakHub Code Map

本文件按“要改什么”定位主文件、数据链路、测试与验收方式。最近完整验收：`uncommitted working tree (2026-07-27)`。

ChatGPT 网页语音练习必须先向普通聊天输入框发送提示词，确认首条回复完成后，再点击语音按钮；不要在语音界面发送开场提示词。

ChatGPT 发送后经常会替换输入框节点；发送确认必须重新定位当前可见输入框。首条回复检测要同时兼容 `article[data-testid^="conversation-turn-"]` 与旧版 `data-message-author-role` 结构。

新建聊天后输入框可能先可见、后完成文本接收绑定；`fillAndSendPrompt()` 必须重新聚焦并自动重试最多 3 次，不能让用户手动再点一次开始。

## 先看这里

| 目标 | 主文件 | 配套测试 | 验证命令 |
| --- | --- | --- | --- |
| 改 ChatGPT 网页练习、提示词或网页语音 | `src/main/index.ts`、`src/main/chatgpt-automation.ts`、`src/main/chatgpt-adapter.ts` | `chatgpt-automation.test.ts`、`chatgpt-adapter.test.ts` | `pnpm lint && pnpm test && pnpm build` |
| 改 ChatGPT 历史清理 | `src/main/index.ts`、`src/main/chatgpt-marker.ts`、`src/main/background-cleanup.ts`、`src/main/chatgpt-automation.ts` | `chatgpt-marker.test.ts`、`background-cleanup.test.ts`、`chatgpt-automation.test.ts` | `pnpm lint && pnpm test && pnpm build`，再做登录态验收 |
| 改 API 语音、抢话或流式回复 | `src/main/index.ts`、`src/main/local-speech-service.ts`、`src/main/barge-in-policy.ts` | `local-speech-service.test.ts`、`barge-in-policy.test.ts`、`App.voice.test.tsx` | `pnpm test` |
| 改归档、学习中心、收藏词或复习 | `src/main/store.ts`、`src/main/index.ts`、`src/main/learning-service.ts`、`src/renderer/LearningCenter.tsx` | `store.test.ts`、`learning-service.test.ts`、`LearningCenter.test.tsx` | `pnpm lint && pnpm test && pnpm build` |
| 改设置、密钥或用量 | `src/main/secure-settings.ts`、`src/main/app-settings.ts`、`src/renderer/App.tsx` | `secure-settings.test.ts`、`app-settings.test.ts`、`App.voice.test.tsx` | `pnpm lint && pnpm test` |
| 改顶部品牌图标或玻璃顶栏素材 | `src/renderer/assets/app-icon-transparent.png`、`src/renderer/App.tsx`、`src/renderer/styles.css` | `App.voice.test.tsx` | `pnpm lint && pnpm build`；在浅色玻璃顶栏检查图标无白色方底 |

## 核心链路

```text
应用启动
-> 读取 userData/last-speaksub-chat.json
-> 隐藏的同登录态 ChatGPT 页面逐条删除 marker 中的会话
-> 新会话优先按 ChatGPT 自动生成的侧边栏标题删除；旧 URL marker 兼容移除 WEB: 前缀
-> 仅在网页确认会话消失后移除该 marker；失败保留供下次启动重试
```

启动清理与点击“确认并开始”的清理共用同一单飞任务，避免两个隐藏页面重复删除。清理只处理 SpeakHub 自己记录的会话 URL，不删除用户普通 ChatGPT 聊天。

```text
ChatGPT 网页语音练习
-> `App.tsx` 组合场景、难度、纠错提示词并调用 `practice:start`
-> `index.ts:prepareWebPractice()` 新建 ChatGPT 聊天
-> `fillAndSendPrompt()` 在普通聊天输入框填入提示词、点击发送、确认文本已离开输入框
-> `waitForReplyAndStartVoice()` 等待首条回复完成并稳定约 0.9 秒，再点击“启动语音功能”
-> 记录会话 URL，`ChatGPTAdapter` 监听对话字幕
```

风险：不能把“按钮 click 已调用”当作发送成功；必须确认输入框中的提示词已消失。网页结构或登录态变化时应显示可恢复的失败提示，不应继续进入练习。

真实验收：在已登录 ChatGPT 的连接页选择“ChatGPT 网页 + 语音交流”，点击“确认并开始”。确认后台依次出现新聊天、已发送的提示词、ChatGPT 的首条完整回复，最后才点击语音按钮；若发送或语音启动失败，界面必须提示失败而不是显示“Prompt sent”。

```text
练习文本 / 字幕收藏词
-> current-practice.md
-> review + store.finalizeSession()
-> learning-index.json 中的 VocabularyItem
-> learning:vocabulary:list IPC
-> 学习中心「所有收藏」列表或待复习卡片
-> 评分写回 familiarity / nextReviewAt
```

## ChatGPT 历史清理

- `index.ts`：应用初始化完成并读取 marker 后立即启动隐藏清理；开始新练习时若清理仍在运行则复用该任务。
- `chatgpt-marker.ts`：保存会话 URL，并在 ChatGPT 自动生成侧边栏摘要标题后补写该标题。
- `chatgpt-automation.ts`：新 marker 按精确摘要标题定位会话；旧 marker 按 URL 定位并兼容移除 `WEB:` 前缀。两种方式均限定到该会话行“…”、当前菜单的删除和当前确认框的删除，且确认目标会话已消失。
- `background-cleanup.ts`：按 marker 顺序逐条处理。任何失败都不移除本地记录。
- 风险：ChatGPT 页面结构改变或登录失效时必须保留 marker，不能猜测点击。

真实验收：完成一轮 ChatGPT 练习后检查 marker 已包含 ChatGPT 自动生成的侧边栏摘要标题。重启应用且不点击“确认并开始”，确认隐藏清理页按顺序删除这条标题对应会话；旧 marker 仍可按 URL 删除。若网络或菜单异常，关闭再打开应用应继续重试。

## 学习中心与词汇

- `LearningCenter.tsx`：词汇页默认可查看所有收藏词；“所有收藏”会清除待复习、熟悉度和搜索筛选。“待复习”只筛选到期词，“开始复习”进入卡片流程。
- `store.ts`：学习索引与复习日期的唯一写入点。四档卡片评分 `again/hard/good/easy` 的间隔为 0/1/3/14 天。
- `index.ts` + `learning-service.ts`：词汇列表返回前只使用离线词典补全缺失释义；列表刷新不得触发 LLM 网络回退。
- 风险：不要只检查 UI。需验证 `listVocabulary` 的筛选参数、卡片评分后的 `nextReviewAt`，以及 `learning-index.json` 的持久化结果。

## 本地验证与真实验收

```powershell
pnpm lint
pnpm test
pnpm build
pnpm dev
```

在学习中心收藏至少两个单词，先打开“待复习”筛选，再点击“所有收藏”，确认筛选被清除并展示全部收藏词；完成一张卡片的“英文 → 评分 → 中文释义 → 下一词”流程后，重启应用确认日期和释义仍保留。
