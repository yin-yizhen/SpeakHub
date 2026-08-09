# SpeakHub Code Map

## Automatic Subtitle Lifecycle

- Entry: practice IPC orchestration in `src/main/index.ts`; ordering helper in `src/main/practice-subtitle-lifecycle.ts`; manual subtitle controls still use `subtitle:update` and `subtitle:toggle` through `src/main/preload.ts`.
- Flow: successful `practice:start` -> `startPracticeWithSubtitles()` -> show and persist the subtitle overlay. `practice:end` from either the main page or subtitle overlay -> `endPracticeWithSubtitles()` -> hide and persist the overlay before voice shutdown, review generation, and archive finalization begin.
- Failure boundary: a failed/cancelled startup must not open subtitles. A subtitle-window or settings-persistence error is diagnostic-only and must not turn a successfully started or ended practice into a lifecycle failure.
- Tests: `src/main/practice-subtitle-lifecycle.test.ts` covers successful/failed startup, end ordering, and visibility-error isolation; `src/renderer/App.voice.test.tsx` and `src/renderer/subtitle-overlay.test.tsx` cover the two end-practice entry points.
- Verify: `pnpm exec vitest run src/main/practice-subtitle-lifecycle.test.ts src/renderer/App.voice.test.tsx src/renderer/subtitle-overlay.test.tsx src/main/practice-pipeline.integration.test.ts`, then `pnpm lint` and `pnpm build`. Real acceptance: keep subtitles hidden, start a practice and confirm the overlay appears only after startup succeeds; click end on both the main page and the overlay in separate sessions and confirm the overlay disappears immediately while review/archive completion continues.

## Practice Startup Cancellation

- Entry: the main practice action in `src/renderer/App.tsx`; startup ownership in `src/main/practice-controller.ts`; IPC orchestration and partial-session cleanup in `src/main/index.ts`.
- Flow: first click -> renderer request generation -> `practice:start` -> `PracticeController.start(signal)` -> API or ChatGPT preparation. A second click while `lifecycle === 'starting'` -> invalidate the renderer request generation -> `practice:cancel-start` -> abort the controller signal -> stop page/voice/transcript work -> remove the unfinished `current-practice.md` session -> return the UI to idle. A late result from the cancelled request must never activate the renderer session.
- Web runtime boundary: cancellation reloads the persistent ChatGPT view to terminate long-running page JavaScript such as composer and voice waits while preserving the dedicated login partition. Every continuation after an awaited web operation must check the startup signal before creating more side effects.
- Risk: do not disable the primary action merely because startup is busy; it is the user's recovery control. Do not call `PracticeController.reset()` to cancel an in-flight task because that drops bookkeeping without stopping the underlying operation. Cleanup must be scoped to the matching unfinished session so a late cancelled operation cannot erase a newer session.
- Tests: `src/main/practice-controller.test.ts` covers immediate cancellation and late completion isolation; `src/renderer/App.voice.test.tsx` covers the second-click affordance and stale renderer result; `src/main/practice-pipeline.integration.test.ts` remains the parser/transcript/storage boundary check.
- Verify: `pnpm exec vitest run src/main/practice-controller.test.ts src/renderer/App.voice.test.tsx src/main/practice-pipeline.integration.test.ts`, then `pnpm lint` and `pnpm build`. Real acceptance: start a ChatGPT web practice, click the same button again while it says “正在启动… 再次点击取消”, confirm it returns to “确认并开始” without closing SpeakHub, then immediately start again and confirm exactly one new session reaches subtitles and archive storage.

## ChatGPT Web Sign-in Navigation

- Entry: connection UI in `src/renderer/App.tsx`; persistent embedded page and IPC in `src/main/index.ts`; one-time real-browser handoff in `src/main/chatgpt-browser-login.ts`; embedded URL policy in `src/main/connection-navigation.ts`.
- Primary Google flow: “使用 Google 登录 ChatGPT” is always visible on the connection page, even when cached readiness says the provider is connected. Clicking it -> create or reuse the app-owned `userData/chatgpt-login-browser` Chrome/Edge profile and a localhost-only DevTools port -> open `https://chatgpt.com/auth/login` directly -> complete the normal ChatGPT Google login in that real browser -> require both a stable ChatGPT Auth.js session cookie and no remaining ChatGPT/OpenAI/Google authentication-flow page -> read only exact `chatgpt.com` cookies through CDP -> copy them into `persist:speaksub-chatgpt` -> close the login browser while retaining its dedicated profile -> reload the real `chatgpt.com` page inside Electron -> verify `/api/auth/session` reports a user/access token and `ChatGPTAutomation.isReady()` finds the composer. Future reauthentication reuses the saved Google account without touching the user's normal Chrome profile.
- Embedded fallback: the persistent partition still loads `chatgpt.com` and OpenAI email/password pages directly. Google may reject an embedded Electron user agent, so “Continue with Google” inside the right-hand page is not the supported Google path.
- Connection-page escape: “返回主界面” is always visible whether login is ready, pending, or failed and calls `connection:hide`; the page must never trap the user behind a readiness check.
- White-screen recovery: the connection page always exposes “刷新连接页” -> `connection:reload` -> `webContents.reloadIgnoringCache()`. It is blocked during an active practice and preserves all login data.
- Failure detection: `did-fail-load` reports only non-aborted main-frame failures; `render-process-gone` and `unresponsive` also mark the page failed. Diagnostics store only the safe origin, error code/description, or renderer reason/exit code—never OAuth query strings or cookie values. Reopening a failed connection page reloads it even when its current URL is still allowlisted.
- Destructive fallback: “清除缓存并重新登录” appears only after a refresh attempt or reported failure. Confirmation is rendered inline inside the 420 px connection panel because a renderer modal cannot cover the native `WebContentsView` on the right. Confirming clears the dedicated partition's HTTP/code cache, embedded Google/OpenAI/ChatGPT site data, and the app-owned `userData/chatgpt-login-browser` profile; practice archives, subtitle settings, and API configuration remain intact.
- Navigation policy: top-level navigation is HTTPS-only and exact-host allowlisted. Google OAuth popups are redirected into the same embedded connection view so they reuse the ChatGPT partition. The view uses a Chrome-compatible Windows user agent based on Electron's bundled Chromium version.
- Security boundaries: never read the user's normal Chrome profile or decrypt its cookie database. The login browser must use the fixed app-owned profile under `userData`, bind CDP to loopback, import exact `chatgpt.com` domains only, and never log cookie values. The dedicated profile retains reusable Google/OpenAI login state between launches. Do not accept renderer-supplied profile paths, executable paths, ports, domains, or cookie payloads.
- Cookie mapping: import only Secure cookies from exact ChatGPT domains, prefer an unpartitioned cookie when CDP reports a duplicate key, and preserve Chrome host-only cookies by omitting Electron's `domain` field. Cookies whose names start with `__Host-` must additionally use path `/`; attaching a Domain produces Chromium `EXCLUDE_INVALID_PREFIX`. `__Secure-` cookies must remain secure, and chunked session cookies must be stable across two reads before import. Cookie presence alone is not login success: an expired or server-invalid session cookie can remain in the reused browser profile while `/auth/login` is still visible. Session-cookie write failures stop the handoff; conflicts from optional cookies are counted and skipped.
- Risk: the handoff depends on ChatGPT's private web-cookie and `/api/auth/session` contracts and may require maintenance if Auth.js cookie names, authentication routes, Cloudflare checks, or browser security rules change. A copied cookie or visible logged-out composer is not acceptance. Diagnostics record success/failure duration and cookie counts but never cookie values; real acceptance still requires a prompt/reply transcript.
- Tests: `src/main/chatgpt-browser-login.test.ts` for domain, Auth.js cookie, authentication-flow completion, Electron mapping, and executable discovery boundaries; `src/main/chatgpt-automation.test.ts` for real-session and composer checks; `src/main/connection-navigation.test.ts` for embedded URL boundaries, reload/cache helpers, failure filtering, and safe diagnostic origins; `src/renderer/App.voice.test.tsx` for login, refresh, inline destructive confirmation, and always-available return navigation.
- Verify: `pnpm exec vitest run src/main/chatgpt-browser-login.test.ts src/main/connection-navigation.test.ts src/main/chatgpt-automation.test.ts src/main/chatgpt-adapter.test.ts src/renderer/App.voice.test.tsx`, then `pnpm lint` and `pnpm build`. Real acceptance requires a user-owned account: confirm “返回主界面” works before login and after login; finish Google sign-in and confirm the embedded sidebar shows that account's conversations; disconnect the network and reload to confirm a visible recoverable load error; reconnect and confirm “刷新连接页” recovers without losing login; click “清除缓存并重新登录” and confirm the inline warning stays sharp and confined to the left panel; confirm the action signs out and permits a fresh login; finally send one practice prompt and verify parsed reply chunks reach the transcript and archive.

## Speech Model Download and Extraction

- Entry: settings UI in `src/renderer/App.tsx`; IPC bridge in `src/main/preload.ts` and `src/main/index.ts`; implementation in `src/main/speech-model-manager.ts`.
- Storage: both packaged and development builds use Electron `userData/speech-models`. Never create or download models beside the installed executable because an all-users installation directory can be read-only for a normal app launch.
- Flow: settings retry -> `speech-assets:download` -> rescan manually placed assets -> cloud MiMo mode verifies/downloads VAD only; local Kokoro mode verifies/downloads VAD and Kokoro -> reuse a verified `.tar.bz2` when present -> extract into `.extracting` -> verify required model files -> atomically replace the final model directory.
- Download transport: construct `SpeechModelManager` with Electron `net.fetch` so model downloads use Chromium's network stack and system proxy configuration, matching browser behavior. Stream chunks to an async file handle, hash while writing, and publish progress at most every 200 ms or 1 MiB instead of broadcasting every network chunk.
- Extraction: stream BZIP2 decompression and TAR entry extraction inside the Electron main process with `unbzip2-stream` and `tar-stream`; never depend on a system `tar` or `bzip2` executable. Reject entries that escape the temporary destination or use unsupported link/device types.
- Manual install: place the extracted `kokoro-int8-multi-lang-v1_1` directory directly under `speech-models`, with `model.int8.onnx`, `voices.bin`, `tokens.txt`, both lexicons, `espeak-ng-data`, and `dict` immediately inside it. Afterward, retry from settings or restart the app.
- Settings help: the speech-assets card always keeps automatic download as the primary action, then shows the actual `userData/speech-models` path, an IPC-backed “open model folder” action, allowlisted official VAD/Kokoro download links, and fallback placement instructions.
- Kokoro cleanup: the settings card always shows Kokoro status even when MiMo is selected. An installed model can be removed only after confirmation, only when no practice is active and the saved provider is not Kokoro. `speech-assets:remove-kokoro` accepts no path and deletes only the manager-owned Kokoro directory, archive, partial download, and extraction directory; VAD is preserved.
- IPC: `speech-assets:install-info` returns the root, VAD file, and Kokoro directory; `speech-assets:open-directory` may only open the manager-owned root and never accepts a renderer-supplied path. `speech-assets:remove-kokoro` likewise accepts no renderer-supplied target.
- Failure recovery: retain a size- and SHA-256-verified archive after extraction failure, remove the incomplete `.extracting` directory, and reuse the archive on retry. Invalid archives must be removed and downloaded again.
- Tests: `src/main/speech-model-manager.test.ts`; settings integration coverage: `src/renderer/App.voice.test.tsx`; link allowlist coverage: `src/shared/help-links.test.ts` and `src/main/external-help-navigation.test.ts`.
- Verify: `pnpm exec vitest run src/main/speech-model-manager.test.ts src/renderer/App.voice.test.tsx`, then `pnpm lint` and `pnpm build`. For real Windows acceptance, extract in a path containing Chinese characters, spaces, and parentheses, confirm the required files are present, switch and save MiMo, delete Kokoro from settings, and confirm only the Kokoro directory disappears while VAD remains ready.

## Shared System Prompt Management

- Entry: practice UI in `src/renderer/App.tsx`; storage in `src/main/app-settings.ts`; shared prompt composition in `src/shared/direct-chat-prompt.ts`.
- Flow: both ChatGPT 网页 and API 直连 open the same `管理系统提示词` editor -> `savePromptTemplates()` -> persisted `PromptTemplates.systemPrompt`. API 直连 sends `system prompt + scenario + difficulty + correction + focus` as its system message; ChatGPT 网页 merges that same content into its first prompt.
- Compatibility: legacy saved template settings without `systemPrompt` automatically receive `defaultDirectChatSystemPrompt`; saving a custom system prompt does not replace the three template libraries.
- Tests: `src/main/app-settings.test.ts`, `src/shared/direct-chat-prompt.test.ts`, `src/main/learning-service.test.ts`, and `src/renderer/App.voice.test.tsx`.
- Verify: `pnpm exec vitest run src/main/app-settings.test.ts src/shared/direct-chat-prompt.test.ts src/main/learning-service.test.ts src/renderer/App.voice.test.tsx && pnpm lint && pnpm build`.

## Text Reply Barge-in

- Entry: API text composers in `src/renderer/App.tsx` and `src/renderer/subtitle-overlay.tsx`; IPC bridge in `src/main/preload.ts`; orchestration in `src/main/index.ts`; replacement ordering in `src/main/interruptible-task-handoff.ts`.
- API flow: user submits while a reply is streaming -> renderer keeps the input and optional TTS checkbox enabled -> `InterruptibleTaskHandoff.replace()` aborts the current `LearningService.streamChat()` signal -> any partial assistant text is finalized with `interrupted: true` through `handleEvent()` and the normal store/checkpoint path -> pending TTS and renderer playback receive a generation interrupt -> the old task settles -> the new user event is appended -> a new stream starts with the complete conversation history.
- Streaming guarantee: normal SSE deltas are forwarded immediately. If a compatible provider returns one oversized SSE delta or a complete JSON response despite `stream: true`, `LearningService` splits it into short, frame-paced subtitle deltas while preserving the exact text and the same AbortSignal, so the overlay still updates progressively and remains interruptible. `subtitle-overlay.tsx` merges those updates by `sourceMessageId` and shows the sentence-save action only after `status: complete`.
- ChatGPT web flow: a replacement submission calls `ChatGPTAutomation.stopGenerating()` when the visible stop control exists, finalizes the adapter's latest streaming assistant event as interrupted, then uses the existing composer/send confirmation path. The adapter remains the source of parsed transcript events.
- Concurrency rule: renderer request versions prevent an older cancelled send from clearing the busy state or restoring text over a newer draft. Main-process replacement handoffs are serialized, but they do not wait for a full reply before accepting the next replacement.
- Development-runtime risk: renderer HMR can show the new editable composer while an already-running Electron main process still serves an older `practice:sendMessage` handler. If a retired IPC error appears in the UI but `rg` finds it in neither `src` nor `out`, restart the entire `electron-vite dev` process; reloading only the window is insufficient.
- Tests: `src/main/interruptible-task-handoff.test.ts`, `src/main/chatgpt-automation.test.ts`, `src/renderer/subtitle-overlay.test.tsx`, `src/main/learning-service.test.ts`, `src/main/store.test.ts`, and `src/main/practice-pipeline.integration.test.ts`.
- Verify: `pnpm exec vitest run src/main/interruptible-task-handoff.test.ts src/main/chatgpt-automation.test.ts src/renderer/subtitle-overlay.test.tsx src/main/learning-service.test.ts src/main/store.test.ts src/main/practice-pipeline.integration.test.ts`, then `pnpm lint`, `pnpm test`, and `pnpm build`. Real acceptance: send an API text message, type before the reply completes, submit again, and confirm the first assistant event is marked interrupted, old text/TTS stops, the second user event is persisted once, and the new reply uses the prior history. Repeat once in ChatGPT web mode and confirm its visible generation stops before the replacement prompt is sent.

## TTS Provider Selection

- Entry and settings: `src/renderer/App.tsx` -> `ProviderSettings` in `src/shared/types.ts` -> encrypted secrets in `src/main/secure-settings.ts` -> validation and service construction in `src/main/index.ts`.
- Local flow: streamed LLM text -> `SpeechSegmenter` -> `LocalSpeechService.synthesize()` -> `speech-tts-worker.ts` -> Kokoro float32/24 kHz -> `voice:audio` -> renderer player.
- Cloud flow: streamed LLM text -> `SpeechSegmenter` -> `LocalSpeechService.synthesize()` -> `mimo-tts-client.ts` -> Xiaomi MiMo `/v1/chat/completions` SSE -> base64 PCM16/24 kHz conversion -> `voice:audio` -> renderer player.
- Text-mode opt-in: API direct + text practice shows an unchecked “朗读 AI 回复” box in `subtitle-overlay.tsx`. Checked sends `sendPracticeMessage(message, true)` through `preload.ts` -> `index.ts`; the normal LLM/transcript/checkpoint path is unchanged, while reply segments additionally use a synthesis-only `LocalSpeechService` (no VAD or Aliyun ASR) and `voice:audio` is played in the overlay renderer. ChatGPT web text mode does not show this local-TTS control.
- Voice preview: settings voice button -> `previewMimoTtsVoice()` -> preload -> `providers:preview-mimo-tts` -> current form Key or encrypted saved Key -> fixed short preview text in `index.ts` -> `MimoTtsClient` -> 24 kHz float audio returned over IPC -> dedicated renderer preview player. Preview does not start a practice or write transcript/archive data.
- Settings persistence: changing the TTS provider or clicking a MiMo voice immediately sends a partial `saveProviderSettings()` update to `SecureSettings`; these updates are serialized and do not replace the renderer's full provider-form state, so unfinished API Key input is retained. API keys, LLM fields, and Aliyun settings still use the form's save button.
- Setup help: the MiMo Key “如何获取” action opens a four-step renderer dialog, explains that the current standard endpoint expects an `sk-…` key rather than a Token Plan `tp-…` key, and links only to `MIMO_HELP_LINKS` pages allowed by `src/shared/help-links.ts` and `src/main/external-help-navigation.ts`.
- Preview cancellation: selecting another voice aborts the previous main-process HTTP request; leaving settings, unmounting, or starting a practice also cancels the request and stops the dedicated preview player. Do not reuse the practice player because preview generations must not suppress later practice audio.
- Input remains separate: microphone float32/16 kHz -> VAD worker -> Aliyun Fun-ASR. Changing TTS must not change recognition, transcript parsing, chunk boundaries, barge-in, or archive writes.
- Cancellation: barge-in, practice end, or generation replacement aborts active MiMo HTTP requests and rejects stale synthesis with `AbortError`; local Kokoro keeps its worker generation gate.
- Defaults and compatibility: new or legacy settings without an explicit TTS choice default to cloud `mimo`; an explicitly saved `kokoro` choice remains unchanged. MiMo uses `mimo-v2.5-tts` and an English voice default of `Mia`. MiMo mode requires only VAD locally, while Kokoro mode requires both VAD and the Kokoro model.
- Tests: `src/main/mimo-tts-client.test.ts`, `src/main/local-speech-service.test.ts`, `src/main/speech-segments.test.ts`, `src/main/secure-settings.test.ts`, `src/main/speech-model-manager.test.ts`, `src/renderer/App.voice.test.tsx`, `src/renderer/subtitle-overlay.test.tsx`, `src/shared/help-links.test.ts`, and `src/main/external-help-navigation.test.ts`.
- Verify: `pnpm exec vitest run src/main/mimo-tts-client.test.ts src/main/local-speech-service.test.ts src/main/speech-segments.test.ts src/main/secure-settings.test.ts src/main/speech-model-manager.test.ts src/renderer/App.voice.test.tsx src/renderer/subtitle-overlay.test.tsx src/main/practice-pipeline.integration.test.ts`, then `pnpm lint` and `pnpm build`. Real acceptance requires a valid MiMo key: verify voice previews and API voice interruption as before; then start API text practice, confirm the unchecked box produces text only, check “朗读 AI 回复,” send another message, and confirm the same parsed/archived reply also plays once through the selected TTS voice.

## Packaged App Startup

- Entry: Electron lifecycle and window creation in `src/main/index.ts`; existing-window activation helper in `src/main/window-activation.ts`; early filesystem initialization in `src/main/speech-model-manager.ts`.
- Version label: `package.json` -> `app.getVersion()` -> `app:version` IPC -> `preload.ts` `getAppVersion()` -> `App.tsx` `.brand-version` badge. Do not hard-code a displayed version in the renderer.
- Flow: acquire the Electron single-instance lock -> initialize services using writable `userData` paths -> create renderer and auxiliary windows -> show the main window. A second launch exits immediately and asks the first instance to restore, show, and focus its window.
- Failure handling: the `app.whenReady()` initialization chain must end in a visible startup error dialog and write `startup-failed` to the diagnostic log when available. Do not leave an initialization rejection unhandled while all windows still have `show: false`.
- Risk: a process visible in Task Manager does not prove successful startup. If the process group has GPU/network utility children but no `--type=renderer` child, inspect synchronous constructors and filesystem writes that run before `createMainWindow()`.
- Tests: `src/main/window-activation.test.ts`, `src/main/speech-model-manager.test.ts`, and `src/renderer/App.voice.test.tsx`.
- Verify: `pnpm exec vitest run src/main/window-activation.test.ts src/main/speech-model-manager.test.ts`, then `pnpm lint` and `pnpm package:win`. Install under an administrator-owned directory, launch as a normal user, confirm a visible main window and renderer process, then launch again and confirm only one main-process instance remains.

## Windows Installer Recovery

- Entry: `build/installer.nsh`; packaging configuration: `package.json` -> `build.nsis.include`.
- Flow: NSIS `preInit` -> selects the x64 package's registry view -> validates both per-user and per-machine uninstall commands -> keeps valid registrations -> otherwise keeps `InstallLocation` but removes the unusable uninstall record -> removes a duplicate per-user location after a successful all-users migration -> normal installation repairs into the previous directory.
- Risk: electron-builder reports destination copy failures with the generic “SpeakHub cannot be closed” message. Always check the target folder ACL before investigating process locks. A missing uninstaller must not cause deletion of `InstallLocation`, because that value is also the installer’s path-memory source.
- Permission: the assisted installer still offers per-user and per-machine modes, but fresh installs default to per-machine and can request elevation. A per-user install cannot write to administrator-owned folders such as a protected `D:\tools`; use the per-machine option for those paths.
- Verify: create a stale HKCU or HKLM record with `InstallLocation` pointing to a directory whose uninstaller is missing, run `pnpm package:win`, and install the resulting package. Confirm the stale uninstall record is removed, the directory defaults to the saved location, installation completes with the required privilege, and a second install without `/D` still uses that location.

## Subtitle Overlay Interaction

- Entry: `src/renderer/subtitle-overlay.tsx`; window control: `src/main/index.ts`; renderer IPC bridge: `src/main/preload.ts`.
- Flow: word/control hover -> `subtitle:interactive` -> `BrowserWindow.setIgnoreMouseEvents`; three-bar drag -> `subtitle:move` -> persisted overlay bounds.
- Tests: `src/renderer/subtitle-overlay.test.tsx`.
- Verify: `pnpm exec vitest run src/renderer/subtitle-overlay.test.tsx`; then start the app and drag the three bars only while unlocked. Confirm locking prevents movement and transparent subtitle areas still click through.

## Saved Conversation Sentences

- Entry: the bookmark action at the end of each completed subtitle in `src/renderer/subtitle-overlay.tsx`; learning-center list in `src/renderer/LearningCenter.tsx`.
- Flow: completed voice or text `TranscriptEvent` -> renderer sends only `sourceMessageId` through `saveSessionSentence()` in `src/main/preload.ts` -> `session:save-sentence` in `src/main/index.ts` validates the active session -> `SpeakSubStore.saveSentenceFavorite()` resolves the authoritative completed transcript text -> current Markdown `## Saved sentences` and embedded metadata -> archive reconciliation builds `learning-index.json.sentences` -> `learning:sentences:list` -> learning-center “句子” tab. New sentences default to `learning`; `learning:sentences:update-status` persists reversible `learning`/`mastered` grouping and `learnedAt` in the owning archive.
- Analysis flow: list refresh and sentence clicks are local-only and must never call the LLM. Ending a practice collects the completed archive, saved vocabulary, and all saved sentences -> one `LearningService.reviewWithSentences()` request returns the review plus one validated analysis per saved `sourceMessageId` -> `SpeakSubStore.saveReview()` writes both into current archive metadata -> `finalizeSession()` rebuilds the index -> the three-line preview and detail drawer read the cached analysis. Archived “重新生成复盘” uses the same combined request and `saveArchivedReview()` path, including for older sentences without analysis. An incomplete sentence-analysis result fails the combined review instead of silently storing a partial set; the saved transcript and sentences still finalize safely.
- Storage and safety: streaming events cannot be saved; repeated clicks on the same source message are idempotent; saved text is normalized to the compact subtitle form. Deleting an archived session also removes its sentence entries. Legacy indexes or archive metadata without `sentences`/`learningStatus` migrate to an empty list or default each saved sentence to `learning` during rebuild.
- Tests: `src/main/store.test.ts` covers completed/streaming boundaries, Markdown, deduplication, combined review/analysis persistence, status changes, restart rebuild, and archive deletion; `src/main/learning-service.test.ts` covers the single-request combined response and incomplete-analysis rejection; `src/renderer/subtitle-overlay.test.tsx` covers both voice and text entry points plus symmetric wrap-width calculation; `src/renderer/LearningCenter.test.tsx` covers cached analysis display, source/mode metadata, and learning/mastered grouping.
- Verify: `pnpm exec vitest run src/main/store.test.ts src/main/learning-service.test.ts src/renderer/subtitle-overlay.test.tsx src/renderer/LearningCenter.test.tsx src/main/practice-pipeline.integration.test.ts src/main/speech-segments.test.ts`, then `pnpm lint` and `pnpm build`. Real acceptance: save one AI and one user sentence in both voice and text practices, finish each practice, and confirm the ending progress waits for one combined review request; then confirm all four appear under learning center -> “句子” -> “正在学” with analysis already present before any sentence click and remain after restart. Mark one “已学会”, confirm it moves groups and can be moved back. Resize the subtitle overlay and confirm the text begins and wraps with equal 57 px left/right gutters.

本文件按“要改什么”定位入口、数据流、测试和验收方式。最近完整验收提交：`unknown (v0.1.0 release validation, 2026-07-28)`。

## 先看这里

| 目标 | 主要文件 | 配套测试 | 验证命令 |
| --- | --- | --- | --- |
| 改练习入口、界面状态或 IPC | `src/renderer/App.tsx`、`src/renderer/app-state.ts`、`src/main/preload.ts`、`src/main/index.ts` | `App.voice.test.tsx`、`app-state.test.ts`、`practice-pipeline.integration.test.ts` | `pnpm lint && pnpm test && pnpm build` |
| 改 ChatGPT 网页自动化 | `src/main/chatgpt-automation.ts`、`src/main/chatgpt-adapter.ts`、`src/main/index.ts` | `chatgpt-automation.test.ts`、`chatgpt-adapter.test.ts` | `pnpm test && pnpm build`，再做登录态验收 |
| 改 API 对话、语音或抢话 | `src/main/index.ts`、`src/main/local-speech-service.ts`、`src/main/speech-segments.ts`、`src/main/barge-in-policy.ts` | 同名测试、`practice-pipeline.integration.test.ts`、`App.voice.test.tsx` | `pnpm test && pnpm build` |
| 改麦克风采集或设置页检测 | `src/renderer/local-speech-audio.ts`、`src/renderer/App.tsx` | `local-speech-audio.test.ts`、`App.voice.test.tsx` | `pnpm exec vitest run src/renderer/local-speech-audio.test.ts src/renderer/App.voice.test.tsx && pnpm build` |
| 改字幕、查词或窗口布局 | `src/renderer/subtitle-overlay.tsx`、`src/shared/transcript.ts`、`src/shared/subtitle-words.ts`、`src/main/window-layout.ts` | 同名测试 | `pnpm lint && pnpm test && pnpm build` |
| 改归档、复盘、词汇或学习中心 | `src/main/store.ts`、`src/main/learning-service.ts`、`src/renderer/LearningCenter.tsx` | `store.test.ts`、`learning-service.test.ts`、`LearningCenter.test.tsx`、`practice-pipeline.integration.test.ts` | `pnpm lint && pnpm test && pnpm build` |
| 改设置、密钥或 API 连通性检测 | `src/main/provider-connection-check.ts`、`src/main/secure-settings.ts`、`src/renderer/App.tsx` | `provider-connection-check.test.ts`、`secure-settings.test.ts`、`App.voice.test.tsx` | `pnpm lint && pnpm exec vitest run src/main/provider-connection-check.test.ts src/renderer/App.voice.test.tsx` |
| 改社区加入或赞助入口 | `src/renderer/App.tsx`、`src/main/preload.ts`、`src/main/index.ts`、`src/renderer/assets/support-payment-code.jpg` | `App.voice.test.tsx` | `pnpm lint && pnpm exec vitest run src/renderer/App.voice.test.tsx && pnpm build` |
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

复盘超时恢复链路：

```text
practice:end 保存完整对话 -> LearningService.review() 使用 120 秒复盘专用超时
-> 成功：store.saveReview() -> finalizeSession() -> review.assessment 写入 learning-index.json
-> 失败：仍归档完整对话并标记暂无复盘
-> LearningCenter 历史详情“重新生成复盘”
-> learning:sessions:review -> 读取既有 Markdown -> 重新请求复盘
-> store.saveArchivedReview() 原子回写 Markdown 和 learning-index.json
-> 刷新复盘详情与能力趋势
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

设置页连通性检测链路：

```text
App.tsx 当前表单值（密码框为空时允许复用已保存 Key）
-> preload.ts
-> index.ts providers:check-llm / providers:check-aliyun
-> provider-connection-check.ts
-> 最小非流式 /chat/completions / Fun-ASR task-started 后立即 stop
-> 中文成功或可操作错误返回设置页；不保存测试输入、不启动麦克风、不写入练习
```

设置页麦克风检测链路：

```text
App.tsx“检测麦克风”
-> LocalSpeechAudioCapture 请求系统权限并输出 16 kHz Float32 chunk
-> microphoneSignalLevel 计算本地 RMS 输入强度
-> 4 秒后区分检测到声音 / 有权限但无声音 / 权限或设备错误
-> 停止音轨；不调用 LLM、阿里识别或 TTS
```

应用更新链路：

```text
App 启动 5 秒 / 设置页手动检查
-> preload IPC
-> UpdateService 读取 yin-yizhen/SpeakHub 最新 GitHub Release
-> App 显示版本和 Release 正文
-> 主进程下载到 userData/updates/downloads
-> 校验大小、SHA-256（存在时）和 Windows MZ 文件头
-> 独立启动 NSIS 安装器，确认已启动后旧应用自动退出
-> NSIS 覆盖安装，不与仍在运行的 SpeakHub 争用文件锁
```

- 风险：应用内更新不能在旧进程仍运行时仅调用 `shell.openPath()`。必须以独立进程启动安装器，并仅在收到启动成功事件后退出；启动失败时必须保持应用打开，避免留下半安装状态或白屏。

## Code Map

### 主进程与 IPC

- `src/main/index.ts`：Electron 生命周期、窗口、IPC、练习状态与各服务编排。文件较大；修改时应沿具体 IPC 链路定位，不要只看 UI。
- `src/main/preload.ts`：渲染进程 API 白名单；所有持续事件统一经 `onIpc()` 注册并返回解绑函数。
- 社区群号复制：设置页的“加入 QQ 群” -> `preload.ts` -> `community:copy-qq-group-number` -> 主进程 Electron clipboard；不要让渲染进程自行假设网页 Clipboard API 可用。
- `src/main/practice-controller.ts`：开始/结束去重和生命周期状态。
- `src/main/provider-connection-check.ts`：设置页的大模型真实对话检测和阿里 Fun-ASR 握手检测；当前输入 Key 优先，空密码框回退到 `SecureSettings` 中已保存的 Key。
- `src/main/update-service.ts`：GitHub Release 解析、版本比较、安装包下载、镜像安全门控、进度、校验和安装器启动。

### 练习与语音

- `src/main/practice-profile.ts`：练习参数解析与提示词组合。
- `src/main/chatgpt-automation.ts`：ChatGPT DOM 定位、发送、等待回复、语音启动和历史删除。
- `src/main/chatgpt-adapter.ts`：ChatGPT 页面消息解析及观察。
- `src/main/local-speech-service.ts`：VAD、云端识别与本地 TTS worker 编排。
- `src/main/speech-segments.ts`：流式文本分段，是 TTS chunk 边界的唯一实现。
- `src/shared/direct-chat-prompt.ts`：生成 API 直连的完整 `system`；固定英语占比和残缺/错误输入处理规则，再叠加所选提示词与本次练习重点。

### 数据与学习

- `src/main/store.ts`：`current-practice.md`、最终 Markdown 和 `learning-index.json` 的唯一写入入口；历史复盘重试也必须通过 `saveArchivedReview()` 同步回写 Markdown 与索引。
- `src/main/session-checkpoint.ts`：练习中的增量落盘。
- `src/main/learning-service.ts`：LLM 消息角色组装、SSE 解析和复盘结构化；对话历史必须保持 `system -> user / assistant` 顺序。普通对话请求为 30 秒超时，完整复盘为 120 秒专用超时。
- `src/renderer/LearningCenter.tsx`：历史、完整复盘、缺失复盘的显式重试、词汇和复习 UI。

### 渲染与共享配置

- `src/renderer/App.tsx`：主界面组合与客户端交互状态。
- `src/renderer/assets/support-payment-code.jpg`：赞助弹窗使用的原始微信付款码；必须保持原图，不得经 UI 截图或图片生成后替换。
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
| `src/main/store.test.ts` | chunk 合并、Markdown、复盘、历史复盘回写、搜索、词汇和索引持久化 |
| `src/main/speech-segments.test.ts` | TTS 分段边界 |
| `src/main/chatgpt-automation.test.ts` | 网页 DOM、发送确认、回复稳定和清理 |
| `src/main/learning-service.test.ts` | 完整 system 组合、user/assistant 历史顺序、SSE、非流式回退与复盘超时边界 |
| `src/main/provider-connection-check.test.ts` | 大模型最小对话、HTTP/超时错误、已保存 Key 回退，以及阿里握手与安全关闭 |
| `src/renderer/local-speech-audio.test.ts` | 麦克风采集重采样、输入强度阈值、提示音和播放 generation |
| `src/renderer/App.voice.test.tsx` | 来源、模式、语音门控、设置和客户端事件 |
| `src/renderer/app-state.test.ts` | 生命周期忙碌状态、下一次练习模板映射 |
| `src/renderer/subtitle-overlay.test.tsx` | 字幕、查词、收藏和交互状态 |
| `src/renderer/LearningCenter.test.tsx` | 历史详情、缺失复盘重试、词汇列表和复习卡 |
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

## Windows App Icon

- Source artwork: `resources/app-icon-rounded.png`; Windows executable, installer, desktop shortcut, and taskbar use `resources/app-icon-rounded.ico` through `package.json`.
- During development, `src/main/index.ts` explicitly supplies the same `.ico` to the main window; after packaging, Windows uses the executable icon.
- Verify with `pnpm package:win`, then inspect the installer and installed desktop shortcut on Windows.

## API Voice Shutdown Safety

- Entry: `src/main/index.ts` 的 `practice:end`；worker 编排在 `src/main/local-speech-service.ts`，原生任务分别在 `speech-vad-worker.ts` 与 `speech-tts-worker.ts`。
- Flow: 取消当前回复 -> 停止接收新语音任务 -> 等待正在运行的 sherpa/ONNX 调用完成 -> worker 关闭消息端口并自然退出 -> 生成复盘 -> 归档入库。
- Risk: 不得在 `OfflineTts.generateAsync()` 或 VAD 原生调用仍运行时直接调用 `Worker.terminate()`；这会导致 Electron 以 `0xc0000409` 原生退出。正常关闭也不得通过全局 error listener 上报为失败。
- Tests: `src/main/local-speech-service.test.ts` 必须覆盖 stop 已发送但 worker 尚未退出时，`LocalSpeechService.stop()` 仍保持等待，并确认正常退出不产生错误事件。
- Verify: `pnpm exec vitest run src/main/local-speech-service.test.ts src/main/practice-pipeline.integration.test.ts && pnpm build`；真实验收时在 AI 正在合成或播放语音时点击“结束并生成复盘”，确认应用不退出、复盘完成且归档可打开。

## Subtitle Overlay Positioning

- Entry: drag and resize pointer handling in `src/renderer/subtitle-overlay.tsx`; IPC bridge in `src/main/preload.ts`; native `BrowserWindow` bounds and mouse passthrough in `src/main/index.ts`; geometry helpers in `src/main/window-layout.ts`; hit areas in `src/renderer/overlay.css`.
- Flow: pointer down on the drag zone or resize handle -> capture that pointer and retain its starting screen coordinates plus window bounds -> continue receiving the same pointer outside the original hit area -> `subtitle:move` or `subtitle:resize` -> update native bounds immediately -> coalesce bounds persistence and settings broadcast until movement has been idle for 120 ms.
- Tests: `src/renderer/subtitle-overlay.test.tsx` covers pointer capture, a large horizontal/vertical drag beyond the narrow handle, and capture release. `src/main/window-layout.test.ts` covers resize geometry and minimum readable height; `src/main/app-settings.test.ts` covers the persisted subtitle-settings boundary.
- Risks: do not reintroduce current-target hit testing during an active drag; pointer cancel and lost capture must clear drag state; bounds must remain updated in memory during movement even though disk persistence is deferred.
- Verify: `pnpm exec vitest run src/renderer/subtitle-overlay.test.tsx src/main/window-layout.test.ts`, then `pnpm lint` and `pnpm build`. Real acceptance: drag rapidly left/right and up/down beyond the original handle and window edges, release outside the overlay, then reopen the overlay and confirm its final bounds were persisted.

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
- 结束练习时复盘失败不会丢失对话；历史详情必须保留显式“重新生成复盘”入口。真实验收要确认重试成功后同一 Markdown 出现 `## Review`、详情出现评分，学习中心能力趋势随即更新。
- 设置页“探测可用模型”只验证 `/models`；“检测大模型”才验证实际 `/chat/completions`。阿里检测只验证 Key、网络和服务握手，不代表麦克风或扬声器可用。
- 大模型连通性检测只要求成功返回标准 `choices[0].message`；不要要求极短测试请求必须有非空 `message.content`，推理模型可能先耗尽测试输出额度但真实流式对话仍完全可用。
- 设置页麦克风检测仅验证系统权限和本地输入信号，不验证阿里识别准确率或扬声器；离开设置页时必须停止测试音轨。
- `main.tsx` 与 `overlay-main.tsx` 由两个 HTML 入口引用，静态未使用扫描可能误报，不能删除。
- `.playwright-cli/` 与 `artifacts/` 是本地验收产物，除非明确纳入版本控制，否则视为用户工作区内容。
- 正式版直接加载打包后的本地 HTML，不启动 localhost 服务，也不占用固定端口。
- 自动更新只接受 `yin-yizhen/SpeakHub` 的正式 GitHub Release；第三方镜像仅在资产带 GitHub SHA-256 digest 时启用。
