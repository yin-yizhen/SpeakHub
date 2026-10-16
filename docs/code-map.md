# SpeakHub Code Map

## Gemini Web Practice and AI Studio Login

- UI guidance: `App.tsx` names Gemini 3.8 Live for conversations and the configured LLM API for reviews. The connection panel highlights “首次使用，请点击下方‘使用 Google 登录 Gemini’”; `styles.css` styles the hint separately from the live status. `App.voice.test.tsx` verifies the guidance and login control. Version 0.2.4 release copy: `docs/releases/v0.2.4.md`; follow `agent.md` for build/upload and update-popup acceptance. Source push alone does not trigger an update.

- Entry: main selector `Gemini 网页` in `src/renderer/App.tsx` -> `gemini:open` -> independent `WebContentsView` created by `createGeminiView()` in `src/main/index.ts`, partition `persist:speaksub-gemini`. The renderer connection panel exposes Google login, refresh and return-to-main controls. `GeminiWebSession` receives this embedded host; normal practice does not launch or connect to external Chrome. Existing ChatGPT view/profile stay separate.
- Startup: load a fresh Live document at `gemini-3.8-live` in the owned embedded view, install microphone routing/gate, start capture before sending the combined prompt through the embedded input bridge, and require its user transcript as submission confirmation. Voice mode waits for a live microphone track. Google copyright acknowledgement remains a user action in the app's connection page. Start cancellation disconnects/stops this view without destroying login. The first blank document is loaded explicitly so an unattached empty-frame target does not stall CDP/Playwright discovery.
- Visibility: `geminiPageVisible` is exposed through `getState()` and `onGeminiPageVisible()`; `gemini:hide` moves the same view into a dedicated hidden `BaseWindow` via `placeChatGPTView()`, keeping a positive viewport and `backgroundThrottling: false`. ChatGPT/Gemini connection views are mutually exclusive in the visible main window. Returning to main must not navigate, mute or end the session; reopening Gemini reuses its live document.
- Login: only `gemini:login` opens/reuses real Chrome/Edge with the fixed app-owned `ai-studio-login-browser` profile. After a signed-in Live page is available, `selectAIStudioLoginCookies()` accepts Secure, unpartitioned cookies from exactly `google.com` (parent auth cookies needed by AI Studio) and `aistudio.google.com`; no ordinary browser profile or unrelated service/subdomain cookies are read/imported. Transfer through `toElectronCookie()` into the isolated Gemini partition, flush cookies, validate the embedded account/composer, then close the dedicated login browser while retaining its profile. Do not reuse ChatGPT's Auth.js cookie rule or declare usable voice from cookies/account labels alone. Real transcript/reply acceptance is required.
- Persistence and permissions: settings retain the third source; history filters label Gemini separately. Browser port/profile metadata is `userData/ai-studio-browser-state.json` and development can adopt the prior probe state only for the matching fixed profile. Login CDP endpoints stay loopback-only. Main-frame navigation is HTTPS/exact-host allowlisted; microphone permission is audio-only and scoped to the AI Studio origin. Before each prompt the page must explicitly show `No API key selected`; sending otherwise fails without enabling billing.
- Runtime: 350 ms serialized DOM polling -> `readAIStudioSnapshot()` -> main `handleEvent()` -> subtitle/checkpoint/store. Deduplicate status/text updates; change capture epoch on document replacement or turn-count reset, ignore late results after stop, warn after repeated read failures, and retain an explicit warning for missing user transcriptions. Closing the practice tab/browser does not erase already captured text; end practice to archive it and start a new session to reconnect.
- End: the main-window Gemini end action skips local capture shutdown waits; the first synchronous action in `practice:end` calls `GeminiWebSession.muteOutput()` -> native `webContents.setAudioMuted(true)` (covers buffered HTML/WebAudio output). Then mute input, stop reply/capture, flush final transcript, disconnect Live, archive, and call `LearningService.reviewWithSentences()` with the configured LLM API key/model/base URL. Never send a summary prompt to Gemini. API failure preserves the conversation for retry. Native mute stays on through navigation, show/hide, disconnect failures and review; only a successfully prepared fresh practice unmutes. New Gemini views start muted.
- Historical review retry: `learning:sessions:review` uses the same configured `LearningService` API for every source including Gemini, saves structured review/sentence analyses to the same archive/index, and preserves original transcript turns. `archiveForReview()` excludes the initial generated setup turn. No Gemini browser is opened for review.
- Hidden-page input risk: `WebContents.sendInputEvent()` may silently fail while the view's native parent is hidden. Attach the child renderer's debugger and send `Emulation.setFocusEmulationEnabled` before CDP `Input.*`; this does not activate an OS window. A preserved matching prompt draft may be resubmitted without reinserting text; unrelated drafts must still stop submission. Verify an attributable submitted turn, not a click or a nonempty textarea. Cookie handoff explicitly flushes the partition's cookie store before validating the embedded page.
- Entry: `node scripts/probe-ai-studio.cjs` reuses the browser launcher in `src/main/chatgpt-browser-login.ts`, opens `https://aistudio.google.com/live` in real Chrome/Edge with an independent `userData/ai-studio-login-browser` profile and loopback-only CDP. It never reads the normal browser profile or changes ChatGPT's profile. Re-running reuses the live probe rather than disrupting sign-in.
- Inspection: after the user signs in, `node scripts/inspect-ai-studio.cjs` reads visible DOM from the exact HTTPS AI Studio origin only. It refuses to read account-login page contents, cookies, headers, credentials, or arbitrary origins. Local port metadata and the DOM inspection output are ignored files under `tmp/`.
- Login difference: ChatGPT imports its own Auth.js cookies; AI Studio needs the restricted Google-parent/AI Studio cookie handoff described above. Keep the two partitions and dedicated profiles independent. Probe scripts retain an external-browser fallback for diagnostics; the application's normal Gemini host is embedded.
- Parser: `src/main/ai-studio-page-dom.ts` -> `readAIStudioSnapshot(document)` reads observed `ms-bidi-turn .turn.user/.turn.model` children, audio `.transcript` and typed `ms-bidi-text-part`; excludes controls and page/account text. Empty user turns followed by model replies are reported as missing transcription, never fabricated. The DOM lacks durable message IDs; `GeminiWebSession` scopes positional IDs by capture/document epoch. Same-count DOM virtualization/reordering is not established as supported; verify IDs before adapting to future site changes.
- Tests: `gemini-web-session.test.ts` covers synchronous native mute before blocked cleanup, cancelled/fresh preparation mute state, ordered deduplication, document epochs, missing turns, late stop and confirmed sending with draft preservation; `App.voice.test.tsx` covers three source buttons, saved selection, browser opening and startup without API credentials/local capture; `app-settings.test.ts` covers persisted Gemini preference; `practice-pipeline.integration.test.ts` covers parser/subtitle/checkpoint/archive and Gemini history filtering. Login/parser tests remain as listed below. Do not promote guessed selectors or screenshots alone into an adapter.
- Verify: `pnpm exec vitest run src/main/gemini-web-session.test.ts src/main/ai-studio-page-dom.test.ts src/main/app-settings.test.ts src/main/learning-service.test.ts src/main/practice-pipeline.integration.test.ts src/renderer/App.voice.test.tsx`, `pnpm lint`, `pnpm test`, `pnpm build`. Manual: choose Gemini, open/sign in, start a fresh voice/text practice, verify subtitles and input toggle/F8, end and confirm the saved source, immediate silence and API review; repeat after browser reload and cancellation. Retained probe scripts can independently check live DOM through isolated `tmp/ai-studio-capture-*` archives; those test archives must not be imported into normal history. Screenshots stay under ignored `output/playwright/`.
- Historical prototype checks below used webpage summaries; superseded by configured API reviews and immediate native mute on 2026-10-16.
- Live check on 2026-10-15: user completed Google login in real Chrome and started Gemini 3.8 Live, with the page showing no API Key selected. Read 21 nonempty messages (10 user / 11 model), identified one missing user transcript, and preserved all 21 through subtitle output, duplicate replay, Markdown and a single learning-index archive. A text request in the existing web session produced a readable summary; it ignored the requested Chinese language in favor of the earlier English-only instruction and is not a verified assessment. No Google cookies were copied and no API billing was enabled. The user-started stream was disconnected after capture; the dedicated signed-in browser profile is retained. This initial probe predates the main-window Gemini source described above; embedded Google-cookie handoff and structured grading are still outside this mode.
- Validation for this prototype: all 337 tests passed; `pnpm lint`, `pnpm build`, and script syntax checks passed. The real test archive and summary remain under ignored `tmp/`, separate from the user's learning history.
- Main-window integration check on 2026-10-15: all 345 tests, lint and build passed. The real Gemini browser service confirmed native prompt submission, partial/final assistant callbacks and an 87-character web summary with capture paused before the summary request. A subsequent fresh-tab run stopped at Google's copyright acknowledgement rather than accepting it automatically; startup now waits up to two minutes for the user's action. Runtime UI exposes all three source buttons, saves `gemini-web`, and preserves the existing scene/level/focus. Fresh physical-microphone practice via the new main-window source remains user acceptance; the prior prototype microphone conversation predates this final integration.
- Embedded acceptance on 2026-10-16: the real app completed Google-browser -> isolated embedded login and closed the login browser. During a user-started voice session, `geminiPageVisible` remained false while the page retained a 1261 x 860 viewport, Live connection and `No API key selected` state. Both roles continued reaching main events; the matching `current-practice.md` contained 12 user / 12 assistant turns with `source: gemini-web`. Do not interrupt or restart an active user session for inspection. All 349 tests passed; lint/build passed. Closing/reopening a future app process to verify login persistence is still a separate acceptance step.
- Final acceptance on 2026-10-16: a hidden-page native-input failure initially left that 24-turn archive without a summary. Child-renderer focus emulation restored submission. After a real process restart, the embedded page remained signed in without opening Chrome; the Gemini history retry returned a 91-character web summary and saved it to that same record, with all 24 original turns retained. The app then reported idle, Gemini hidden, and review saved. This validates login persistence, hidden input, summary and archive/index update boundaries. Tests additionally cover embedded/external input, matching-draft retry, login-cookie scope and independent ChatGPT/Gemini hidden hosts.
- Final checks for the embedded implementation: 350 tests passed, `pnpm lint`, `pnpm build` and `git diff --check` passed. The user's actual 24-turn practice and recovered summary are in the existing learning archive, not a temporary replacement; retain this record when continuing work.

- Immediate-end/API acceptance on 2026-10-16: native Electron WebContents harness confirmed mute before blocked cleanup and after failed DOM disconnect/reload. Unit coverage also checks cancelled preparation remains muted and fresh successful preparation unmutes. Main-window Gemini end bypasses unrelated local voice-capture waits. Using the saved LLM API, historical review of the real 24-turn Gemini record returned 10 corrections and structured assessment; rereading the archive retained all 24 turns. Gemini remained about:blank during review, proving no web summary request. Full 352 tests, lint/build passed. Physical speaker latency on a live user voice session remains user acceptance.

## Aliyun ASR Continuous Audio and Recovery

- Model: `paraformer-realtime-v2` on the Beijing DashScope endpoint. `aliyun-asr.ts` / `AliyunAsr` replace the old Fun-ASR module. Settings checks and practice use the same client and saved `aliyunAsrApiKey`; no key migration is needed. Speech usage provider ID is `aliyun-asr`; existing monthly duration counters remain cumulative. Directory-price estimates use CNY 0.00024/second, before free quota and discounts; they are not the provider bill.
- Parameters: 16 kHz PCM16, filler removal disabled to preserve learner speech, VAD segmentation (`semantic_punctuation_enabled: false`, 1,100 ms silence), and `heartbeat: true`. Settings `asrLanguage` defaults to `en` (English practice, `language_hints: ['en']`); `auto` omits the hints for Chinese/English mixed speech. The form saves this through `SecureSettings`; `index.ts` passes it to both practice and the settings connection check. Partial TTS preference saves must retain it. A language hint is not proof of higher real-user accuracy: compare the same microphone speech before drawing that conclusion.
- Model-change risk: do not replace only the model ID when changing ASR families; check request parameters, partial/final sentence schema, duration reporting, and live service acceptance. Model availability cannot be established by mocked/loopback tests alone.
- Entry: `src/renderer/local-speech-audio.ts` -> `voice:audio` in `src/main/index.ts` -> `src/main/local-speech-service.ts` -> `src/main/speech-vad-worker.ts` -> `src/main/aliyun-asr.ts` -> transcript callbacks -> `handleEvent()` / checkpoint / archive.
- Transport: VAD emits every captured 16 kHz chunk exactly once, including leading/trailing silence; it only gates speech-activity notifications for barge-in. Do not restore speech-only forwarding or pre-roll replay: dropping silence both starves ASR sentence completion and defeats `heartbeat: true`. See [Aliyun heartbeat contract](https://help.aliyun.com/zh/model-studio/paraformer-client-events).
- Muted/startup capture gaps: the ASR client sends 200 ms of synthetic PCM16 silence when no audio has arrived for 200 ms. This does not reopen the microphone. The keepalive starts only after `task-started` and ends on failure/stop. Continuous audio increases submitted audio duration compared with speech-only transport; usage remains based on provider-reported duration.
- Recovery: task failure/finish, socket error/close, and handshake timeout invalidate the attempt immediately, even without a close acknowledgement. Once a session has connected, retries back off from 1 to 8 seconds independently of microphone input. Pending audio is bounded to the existing 32,000-sample buffer; long outages cannot guarantee preservation of speech. Old socket events cannot mutate the replacement task or double-count usage. Stop cancels retries/keepalive and settles pending startup; initial connection failures remain visible to practice startup.
- Tests: `src/main/speech-vad-worker.test.ts` verifies continuous chunk output and activity ordering; `src/main/aliyun-asr.test.ts` covers PCM silence, failure recovery, stale callbacks, backoff and cancellation; `src/main/aliyun-asr.integration.test.ts` uses real loopback WebSockets for 10 seconds of silence and recovery to partial/final transcripts. `local-speech-service.test.ts` covers worker orchestration, and `practice-pipeline.integration.test.ts` covers transcript/checkpoint/archive boundaries.
- Verify: `pnpm exec vitest run src/main/aliyun-asr.test.ts src/main/aliyun-asr.integration.test.ts src/main/speech-vad-worker.test.ts src/main/local-speech-service.test.ts src/main/provider-connection-check.test.ts src/main/practice-pipeline.integration.test.ts`, then `pnpm lint`, `pnpm test`, and `pnpm build`.
- Provider acceptance (requires configured credentials and microphone): start API voice practice, stay silent for at least 12 seconds, speak and confirm a complete subtitle and AI reply; repeat after muting/unmuting and a brief network interruption. Confirm subsequent turns reach the archive once each and ending practice stops all retries. Loopback coverage does not establish live Aliyun recognition accuracy or native microphone/VAD behavior.
- Live check on 2026-10-15: the saved Key received `task-started` for Paraformer; after 12 seconds without capture, 6.21 seconds of synthetic English PCM produced eight partial callbacks and a final “Hello, I am practicing English today.” with no ASR errors. The rebuilt app's `providers:check-aliyun` IPC also succeeded. This checks cloud audio/transcript boundaries, not physical microphone capture or a full AI voice turn. Full suite: 321 tests passed; lint/build passed.

## Automatic Subtitle Lifecycle

- Entry: practice IPC orchestration in `src/main/index.ts`; ordering helper in `src/main/practice-subtitle-lifecycle.ts`; manual subtitle controls still use `subtitle:update` and `subtitle:toggle` through `src/main/preload.ts`.
- Flow: successful `practice:start` -> `startPracticeWithSubtitles()` -> show and persist the subtitle overlay. `practice:end` from either the main page or subtitle overlay -> `endPracticeWithSubtitles()` -> hide and persist the overlay before voice shutdown, review generation, and archive finalization begin.
- Failure boundary: a failed/cancelled startup must not open subtitles. A subtitle-window or settings-persistence error is diagnostic-only and must not turn a successfully started or ended practice into a lifecycle failure.
- Tests: `src/main/practice-subtitle-lifecycle.test.ts` covers successful/failed startup, end ordering, and visibility-error isolation; `src/renderer/App.voice.test.tsx` and `src/renderer/subtitle-overlay.test.tsx` cover the two end-practice entry points.
- Verify: `pnpm exec vitest run src/main/practice-subtitle-lifecycle.test.ts src/renderer/App.voice.test.tsx src/renderer/subtitle-overlay.test.tsx src/main/practice-pipeline.integration.test.ts`, then `pnpm lint` and `pnpm build`. Real acceptance: keep subtitles hidden, start a practice and confirm the overlay appears only after startup succeeds; click end on both the main page and the overlay in separate sessions and confirm the overlay disappears immediately while review/archive completion continues.

## Header Microphone Toggle and Shortcut

- Entry: the button before “显示字幕” in `src/renderer/App.tsx`, styled by `.microphone-toggle` in `styles.css`. It shows on/off status and `MicrophoneGateState.shortcut`. In voice mode it is clickable before practice and during active practice; only startup/shutdown transitions temporarily disable it.
- Flow: header click -> existing `toggleMicrophoneGate()` IPC -> `index.ts` shared microphone gate -> API capture or ChatGPT microphone gate -> `onMicrophoneGateState` -> header and capture status. The settings shortcut recorder -> `saveMicrophoneShortcut()` -> `microphone-shortcut.ts` validation / main global shortcut registration -> the same gate. Default is F8; custom shortcuts must appear in the header without a second hardcoded binding.
- State owner: `src/main/microphone-gate.ts` keeps a pre-practice preference separately from the active capture gate. Idle shortcut/click changes never start audio capture. Voice startup inherits an explicitly chosen state, otherwise retains the existing enabled default; ending practice stops capture while retaining the choice. Toggle uses the published current state, so repeated idle presses alternate correctly.
- User-facing button wording is “麦克风开启/关闭” in both idle and active states; the idle tooltip explains that recording starts with practice. Settings microphone checks are local input tests, and an idle on/off preference alone neither creates an AI conversation nor starts ChatGPT audio capture. Before diagnosing an active-voice input failure, verify lifecycle, source/mode, preload readiness, live-track input signal and subsequent user transcript events; do not infer successful capture from the header toggle alone.
- Web readiness: `did-start-navigation` in `index.ts` must reset preload microphone readiness only for a full main-frame navigation. ChatGPT conversation SPA URL changes and iframe navigation do not rerun preload, so resetting there makes both hotkey and button fail after startup.
- Tests: `src/renderer/App.voice.test.tsx` covers header ordering, idle SVG-icon clicks in both directions without capture, switching the shared gate during practice, capture stop and configured shortcut updates; `src/main/microphone-gate.test.ts` covers preference inheritance, hardware failures and SPA navigation; `src/main/microphone-shortcut.test.ts` covers keyboard normalization; `src/renderer/local-speech-audio.test.ts` covers capture/audio boundaries.
- Verify: `pnpm exec vitest run src/renderer/App.voice.test.tsx src/main/microphone-shortcut.test.ts src/renderer/local-speech-audio.test.ts`, `pnpm lint`, `pnpm build`. Live acceptance: start API and ChatGPT voice practice separately; click the header toggle and use F8 to confirm the same state changes, then save a custom shortcut and confirm the header label and keybinding update together.
- Live check on 2026-10-02: Electron reported the configured F8 global shortcut registered; the real header SVG/button changed pressed state true -> false -> true during a user-started ChatGPT voice session. Pre-practice selection and no-capture behavior are covered by gate/renderer tests. An OS-generated F8 key press was not injected in this check.

## ChatGPT Microphone Device Routing

- Entry: `src/main/chatgpt-microphone-preload.ts` installs the self-contained `installChatGPTMicrophoneGate()` from `src/main/chatgpt-microphone-input.ts` in the page world before voice capture. It wraps `getUserMedia` and gates existing/future audio tracks.
- Input rule: map the exact Windows `communications` alias (string, exact/ideal object, or sole array entry) to `default`, matching the settings local microphone test. Preserve named hardware IDs, ordinary default requests, video-only requests and other audio-processing options. Do not change Windows device settings.
- Confirmed failure on 2026-10-02: an active, enabled, unmuted live ChatGPT track used `Communications - 麦克风阵列 (网易虚拟音频设备)` and had RMS about 0.000007; the simultaneous settings-style default capture used Senary Audio and had RMS about 0.257. Header state and gate readiness were both true, so neither proves usable speech input.
- Live repair: reconnected only native ChatGPT voice in the same conversation, installed the routing wrapper and retained the local session. Both captures then used `Default - 麦克风阵列 (Senary Audio)` with matching RMS about 0.163; new user speech transcript appeared. No audio recording was stored by the diagnostic signal check.
- Tests: `src/main/chatgpt-microphone-input.test.ts` invokes the real serialized gate installer and covers alias mapping, explicit-device preservation, unchanged constraints and existing/future track enable state. `microphone-gate.test.ts` covers the main shared state; `App.voice.test.tsx` covers header controls; `practice-pipeline.integration.test.ts` covers transcript/archive boundaries.
- Verify: `pnpm exec vitest run src/main/chatgpt-microphone-input.test.ts src/main/microphone-gate.test.ts src/renderer/App.voice.test.tsx src/main/practice-pipeline.integration.test.ts`, `pnpm lint`, `pnpm test`, `pnpm build`. Live acceptance: compare live track and settings default device, speak to confirm user transcript plus AI reply, then toggle mute on/off. A device-route change affects new streams, so reconnect native voice to verify it; changing `track.enabled` alone cannot switch a stream's hardware source.

## Saved Voice Input Selection

- Entry: “设置 -> 麦克风与快捷键 -> 语音输入设备” in `src/renderer/App.tsx`. `src/renderer/microphone-input.ts` lists named hardware devices, omits default/communications aliases from hardware options and resolves saved choices for this origin. “刷新输入设备” requests local permission if needed, stops its temporary stream, and refreshes names. Selection is saved immediately and blocked during practice.
- Persistence/IPC: `MicrophoneInputSelection` in `src/shared/types.ts` stores deviceId, label and same-name labelIndex. `getMicrophoneInput()` / `saveMicrophoneInput()` in `preload.ts` -> `microphone:input:get/save` in `index.ts` -> validated `AppSettingsStore.microphoneInput()` / `setMicrophoneInput()` in `app-settings.ts`. Old settings default to system default. Saving during a live session is rejected in main as well as disabled in UI.
- Local flow: settings detection and API voice both call `LocalSpeechAudioCapture.start(callback, selection)` -> `requestMicrophoneStream()` -> current-origin hardware ID -> exact getUserMedia constraint -> normal 16 kHz chunks. Missing hardware fails visibly instead of falling back silently.
- Web flow: page preload ready -> main sends `speaksub:microphone-input` before gate state -> page gate `setInputDevice()` -> getUserMedia resolves label/ordinal through ChatGPT's own enumerateDevices. Device IDs are origin-specific, so never pass a renderer's exact hashed ID directly into ChatGPT capture. App system-default selection overrides stale browser preferences. Explicit app selections preserve audio processing options and apply to future streams; they do not switch an existing track in-place.
- Tests: `app-settings.test.ts` covers persistence and validation; `renderer/microphone-input.test.ts` covers origin remapping and missing hardware; `chatgpt-microphone-input.test.ts` covers web remapping, missing devices and authoritative default; `App.voice.test.tsx` covers selection saving and the same selection passed into detection.
- Verify: `pnpm exec vitest run src/main/app-settings.test.ts src/main/chatgpt-microphone-input.test.ts src/renderer/microphone-input.test.ts src/renderer/App.voice.test.tsx src/main/practice-pipeline.integration.test.ts`, then `pnpm lint`, `pnpm test`, `pnpm build`. Acceptance: choose a named microphone, detect its signal, restart to verify persistence, start API and web voice separately and verify the selected track/device and user transcript. Unplug it and confirm a visible selection error rather than another device being used.

## Web Subtitle Collection Recovery

- Entry: `src/main/chatgpt-adapter.ts` -> shared `chatgpt-page-dom.ts` parser -> `index.ts` `handleEvent()` -> transcript IPC/checkpoint -> `src/renderer/App.tsx` and `subtitle-overlay.tsx`.
- Recovery: each serialized 350 ms poll ensures the observer exists and drains it in one page call. New documents emit existing attributable messages immediately, so a reply generated before observer attachment is not silently treated as an already-seen baseline. Execution-context destruction or missing body is retryable; warn after five consecutive failed reads but continue recovery. Generation checks discard late results after stop.
- Renderer boundary: clear previous events before requesting startup, never after `practice:start` resolves. ChatGPT sends its first reply during startup, before voice confirmation; clearing the UI afterward loses that reply even if storage already contains it.
- Tests: `chatgpt-adapter.test.ts` covers transient rejection, replacement documents, initial message replay, final-state changes and late cancellation; `App.voice.test.tsx` covers subtitle events received before startup resolves; `practice-pipeline.integration.test.ts` verifies parser output through subtitle/checkpoint/archive storage.
- Verify: `pnpm exec vitest run src/main/chatgpt-adapter.test.ts src/renderer/App.voice.test.tsx src/renderer/subtitle-overlay.test.tsx src/main/practice-pipeline.integration.test.ts`, `pnpm lint`, `pnpm test`, `pnpm build`. Real acceptance: during a new web voice session, confirm initial assistant and subsequent voice events reach both UI and `current-practice.md`; navigate/reload only in a controlled test and confirm the observer recovers. On 2026-10-01, after user-confirmed restart, the repaired adapter read an existing real practice page: 9 events (5 user, 4 assistant), nonempty subtitle chunks, one QA archive and learning-index file, with zero read warnings. This read-only replay verifies collection/chunk/storage boundaries; a fresh live voice round remains a user acceptance step.

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

## ChatGPT Voice Button Accuracy

- Entry: `prepareWebPractice()` in `src/main/index.ts` -> `ChatGPTAutomation.fillAndSendPrompt()` -> capture conversation URL -> `waitForReplyAndStartVoice()` in `src/main/chatgpt-automation.ts` -> voice-started status. Transcripts still flow through `chatgpt-adapter.ts` and normal checkpoint/archive writes.
- Shared DOM boundary: `src/main/chatgpt-page-dom.ts` is the single parser used by prompt confirmation, reply readiness and the injected transcript observer. Current pages use `data-content-search-unit-key` ending in `:user`/`:assistant`, `data-user-message-bubble` and `data-markdown-text-style="assistant-message"`; legacy role attributes/articles remain supported. Preserve complete collapsed prompt text, paragraph boundaries and stable message IDs while excluding action buttons/role headings. Never assume legacy selectors exist just because the page displays messages.
- Send confirmation: compare the full normalized latest user message with the prompt and require the composer draft to be empty. A shared prefix or clicked send button alone is insufficient. The transcript observer re-reads before draining so an attribute-only stop-button change can finalize streaming text; both `停止` and `停止生成` (and English equivalents) mean generation is busy.
- Retry/start boundary: `startNewChat()` loads `https://chatgpt.com/` directly; substring matches for “新聊天” can select a project-scoped sidebar action. The composer locator accepts editable/textbox controls only, never a model-picker button whose label contains ChatGPT. Focus selects the existing draft before one native `insertText()` so retry replaces retained text instead of appending a second prompt. Enter fallback explicitly refocuses that composer.
- Send readiness: wait up to 5 seconds for a unique visible enabled send button, scoped to the composer form when present. React can replace the voice control with send asynchronously after insertion. Do not restore geometric guesses around the input: they can click model/navigation controls before send mounts.
- First-send recovery: a button click plus Enter can both be ignored during cold-start hydration. `fillAndSendPrompt()` now allows a bounded 15-second recovery period with at most two more clicks, without reinserting the prompt. Retry only when the untouched expected draft remains, no matching user message exists and generation is not busy. An acknowledged prompt or an empty composer means submission is pending: wait for confirmation rather than clicking/pressing Enter again. A user-edited draft stops recovery. Tests cover ignored first actions and acknowledgement arriving before draft clearing.
- First-request live acceptance on 2026-10-01: after restarting Electron, one `practice:start` IPC request with a generic 51-character prompt reached `voiceStarted: true` in 20,525 ms without a second startup request. User/assistant transcript events were present. This confirms the cold main-process startup chain with the final background host; the UI button calls the same IPC path. Retrying submission does not create another practice session.
- Background view: `applyWindowMode()` / `layoutChatHostView()` in `src/main/index.ts` delegate to `src/main/chatgpt-view-host.ts`. The same live ChatGPT `WebContentsView` belongs to a hidden `BaseWindow` when the connection panel is closed, and moves into the main window only when it is opened. Both `setVisible(false)` and out-of-parent bounds produced a 0 x 0 viewport; placing the page “under” the BrowserWindow renderer still covered its controls in real UI use. Do not restore either approach.
- Reply readiness: use only assistant text after the latest user message; require unchanged text for 900 ms and no visible generation-stop button. Words such as “Thinking” in conversation content and hidden stop controls are not generation signals.
- Button contract: the observed Chinese UI exposes separate “听写” and “开始语音” buttons, then “结束语音” after activation. Match dedicated voice-mode test IDs or explicit Chinese/English start labels, exclude navigation/message content, disabled/hidden controls, and refuse ambiguous multiple candidates. Never use a generic `voice`/`语音` substring as a start action.
- Confirmation: click once, allow up to 12 seconds for a visible enabled end-voice control. A removed/replaced start button is not evidence of success. Cancel the pending action if the conversation URL changes. Restart the Electron main process after editing this script; renderer refresh alone cannot load it.
- Tests: `chatgpt-automation.test.ts` executes the injected script against DOM fixtures covering selection, streaming stability, old replies, hidden controls, delayed confirmation and React replacement; `chatgpt-adapter.test.ts` plus `practice-pipeline.integration.test.ts` cover parsing/storage boundaries.
- Live acceptance on 2026-10-01: the real embedded ChatGPT page accepted the practice prompt, generated its reply, and the app automatically reached voice-started with visible enabled `关闭麦克风` / `结束语音` controls. Subsequent voice conversation units were observed and `current-practice.md` was updated. This verifies the automatic startup and checkpoint boundary; finalized archive coverage remains in the integration tests.
- Additional cold-start acceptance on 2026-10-01: without opening the connection page once, the background viewport stayed 900 x 860; one prompt reached a formal conversation URL, the draft cleared and automatic voice startup reached visible enabled end/microphone controls. End-practice generated a review and archive successfully. Retained-draft replacement and delayed form-send readiness have injected-script regression tests.
- Connection-toggle acceptance on 2026-10-01: opened the connection view, inserted a 21-character retained test draft, returned to the studio, started practice and reopened the connection view during startup. The real page reached voice-started at a formal URL, the prompt contained none of the retained draft, and subsequent voice turns reached transcript events. Opening the connection view must remain supported during startup and active practice.
- Verify: `pnpm exec vitest run src/main/chatgpt-automation.test.ts src/main/chatgpt-adapter.test.ts src/main/practice-pipeline.integration.test.ts`, `pnpm lint`, `pnpm build`. Live acceptance: send a practice prompt, observe its complete reply, confirm only “开始语音” is clicked and “结束语音” appears, then speak and verify transcript/archive output. Manual entry/exit verification alone does not establish this entire automatic flow.

## Previous ChatGPT Practice Cleanup

- Entry: next `prepareWebPractice()` in `src/main/index.ts` -> `cleanPreviousInBackground()` -> separate hidden, authenticated `BrowserWindow` -> `cleanRecordedConversations()` in `src/main/background-cleanup.ts` -> `ChatGPTAutomation.deleteConversation()` -> delete confirmation -> remove only the matching marker in `src/main/chatgpt-marker.ts`. Opening SpeakHub alone no longer triggers cleanup. Local learning archives are independent and preserved.
- Recording: `captureConversationUrl()` waits up to 20 seconds for a formal `https://chatgpt.com/c/<id>` URL; optimistic `local-chatgpt:` and `WEB:` IDs are not usable cloud identities. `captureConversationTitle()` reads the matching sidebar link, not prompt content. `ChatGPTMarkerStore` saves URL/title/time and rejects temporary or lookalike-host URLs. Older temporary markers cannot establish a deletion target and are ignored.
- Identity: automatic cleanup always uses the recorded URL, even when a title is present. ChatGPT titles can repeat or change. The target row must contain no other conversation links; missing menus never fall back to a neighboring row. New practice records added during a cleanup batch must survive that batch. Failed deletions retain their valid marker for later retry.
- Current DOM: row action is `button[aria-label="聊天操作"]` / English chat options. Radix opens on `pointerdown`; scroll the exact row into view and dispatch pointer events, with one delayed click fallback for older menus. Confirm `删除聊天` / `Delete chat` inside the delete dialog; verify the exact link disappears before removing its marker.
- Tests: `src/main/chatgpt-automation.test.ts` executes pointer-driven deletion and verifies same-title neighboring chats survive; `src/main/chatgpt-marker.test.ts` covers formal IDs, titles, legacy migration and replacement safety; `src/main/background-cleanup.test.ts` covers sequential deletion and retry retention. `src/main/practice-pipeline.integration.test.ts` checks independent local storage.
- Verify: `pnpm exec vitest run src/main/chatgpt-automation.test.ts src/main/chatgpt-marker.test.ts src/main/background-cleanup.test.ts src/main/practice-pipeline.integration.test.ts`, then `pnpm lint`, `pnpm test`, `pnpm build`. Live acceptance on 2026-10-01 deleted the ended SpeakHub conversation titled `英语自我介绍练习` through the real sidebar menu/dialog; its link disappeared and all other observed sidebar links remained. The local `speaksub-practice-2026-10-01T03-26-44-186Z.md` archive remained present after cloud deletion.

## ChatGPT Native View Visibility and Minimize

- Entry: `src/main/index.ts` creates the persistent page and its hidden `BaseWindow`; `src/main/chatgpt-view-host.ts` places the same `WebContentsView` into the correct native parent. `connection:show` / `connection:hide` reparent it without reload. Main window resize recalculates bounds, and main window closure explicitly closes the page and destroys its background host.
- Background mode: the page is absent from `mainWindow.contentView.children`, its hidden host stays hidden and skips the taskbar, and the page retains a positive viewport. Main-page titlebar buttons must remain visible and clickable. Connection mode: the page exists only inside the main window at the normal 420 px sidebar offset. The background page view itself stays visible to Chromium; hide the host window rather than calling `view.setVisible(false)`.
- Tests: `src/main/chatgpt-view-host.test.ts` covers exclusive parent ownership, a usable viewport and repeated show/hide without duplicate attachments. `chatgpt-automation.test.ts` and `practice-pipeline.integration.test.ts` cover sending and parser/storage boundaries.
- Verify: `pnpm exec vitest run src/main/chatgpt-view-host.test.ts src/main/chatgpt-automation.test.ts src/main/practice-pipeline.integration.test.ts`, `pnpm lint`, `pnpm test`, `pnpm build`. Real acceptance on 2026-10-01: captured the unoccluded full main page; triggered its actual minimize button IPC and confirmed `isMinimized() === true`, `pageInMain === false`, background host hidden and a 900 x 860 viewport. Open/close connection moved the page between exactly those parents. A fresh live voice startup after this host change was not executed because automatic approval rejected starting a new ChatGPT practice; earlier voice acceptance predates this final host change.

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
- Cloud flow: streamed LLM text -> `SpeechSegmenter` -> `SpeechSynthesisQueue` in `speech-synthesis-queue.ts` -> `LocalSpeechService.synthesize(..., onAudio)` -> `mimo-tts-client.ts` -> Xiaomi MiMo `/v1/chat/completions` SSE -> incremental PCM16/24 kHz decoding -> `voice:audio` -> `LocalSpeechAudioPlayer`. Settings previews still collect the complete buffer.
- Sentence latency: never wait for a whole cloud request before forwarding its audio, or serialize all cloud requests. The queue prepares at most two adjacent segments; current-segment packets stream immediately, next-segment packets wait in order. Cloud segmentation combines tiny greetings (first minimum 24 characters, fallback at 52) and batches later sentences (minimum 100, fallback at 180); a final short reply is flushed normally. Kokoro keeps its original segmentation and full-buffer output.
- Playback: streaming chunks have unique packet IDs and `streaming: true`. The renderer adds a 600 ms initial buffer when no sources are queued, then schedules packets and sentences on one Web Audio clock, without inserting a delay per sentence. Pending playback tracks each packet through its `onended` IPC. MiMo's own first-packet latency remains; prefetch and buffering cannot promise gap-free playback on every network.
- Cancellation risk: a generation interrupt must suppress current and prefetched packets, avoid starting queued obsolete requests, abort active HTTP/reader work, and reject synthesis that resumes from startup after cancellation. PCM bytes may straddle SSE events; preserve an odd trailing byte until the next event rather than quantizing or dropping it.
- Text-mode opt-in: API direct + text practice shows an unchecked “朗读 AI 回复” box in `subtitle-overlay.tsx`. Checked sends `sendPracticeMessage(message, true)` through `preload.ts` -> `index.ts`; the normal LLM/transcript/checkpoint path is unchanged, while reply segments additionally use a synthesis-only `LocalSpeechService` (no VAD or Aliyun ASR) and `voice:audio` is played in the overlay renderer. ChatGPT web text mode does not show this local-TTS control.
- Voice preview: settings voice button -> `previewMimoTtsVoice()` -> preload -> `providers:preview-mimo-tts` -> current form Key or encrypted saved Key -> fixed short preview text in `index.ts` -> `MimoTtsClient` -> 24 kHz float audio returned over IPC -> dedicated renderer preview player. Preview does not start a practice or write transcript/archive data.
- Settings persistence: changing the TTS provider or clicking a MiMo voice immediately sends a partial `saveProviderSettings()` update to `SecureSettings`; these updates are serialized and do not replace the renderer's full provider-form state, so unfinished API Key input is retained. API keys, LLM fields, and Aliyun settings still use the form's save button.
- Setup help: the MiMo Key “如何获取” action opens a four-step renderer dialog, explains that the current standard endpoint expects an `sk-…` key rather than a Token Plan `tp-…` key, and links only to `MIMO_HELP_LINKS` pages allowed by `src/shared/help-links.ts` and `src/main/external-help-navigation.ts`.
- Preview cancellation: selecting another voice aborts the previous main-process HTTP request; leaving settings, unmounting, or starting a practice also cancels the request and stops the dedicated preview player. Do not reuse the practice player because preview generations must not suppress later practice audio.
- Input remains separate: microphone float32/16 kHz -> VAD worker -> Aliyun Paraformer. Changing TTS must not change recognition, transcript parsing, chunk boundaries, barge-in, or archive writes.
- Cancellation: barge-in, practice end, or generation replacement aborts active MiMo HTTP requests and rejects stale synthesis with `AbortError`; local Kokoro keeps its worker generation gate.
- Defaults and compatibility: new or legacy settings without an explicit TTS choice default to cloud `mimo`; an explicitly saved `kokoro` choice remains unchanged. MiMo uses `mimo-v2.5-tts` and an English voice default of `Mia`. MiMo mode requires only VAD locally, while Kokoro mode requires both VAD and the Kokoro model.
- Tests: `src/main/mimo-tts-client.test.ts` (incremental/split PCM and stalled reader cancellation), `src/main/speech-synthesis-queue.test.ts` (prefetch bound/order/interruption/failure), `src/main/local-speech-service.test.ts` (stream forwarding and stale generations), `src/main/speech-segments.test.ts` (cloud batching), `src/renderer/local-speech-audio.test.ts` (continuous scheduling and initial buffer), plus settings/model/renderer and `practice-pipeline.integration.test.ts` coverage.
- Verify: `pnpm exec vitest run src/main/mimo-tts-client.test.ts src/main/speech-synthesis-queue.test.ts src/main/local-speech-service.test.ts src/main/speech-segments.test.ts src/renderer/local-speech-audio.test.ts src/main/secure-settings.test.ts src/main/speech-model-manager.test.ts src/renderer/App.voice.test.tsx src/renderer/subtitle-overlay.test.tsx src/main/practice-pipeline.integration.test.ts`, then `pnpm lint` and `pnpm build`. Real acceptance requires a valid MiMo key: compare at least three consecutive English sentences, verify playback starts before HTTP completion, check no reordered/duplicated words, interrupt while the next segment is prefetched, and verify the next reply plays normally. Verify voice previews and text-mode opt-in; parsed/archived reply text must remain unchanged.
- Live check on 2026-10-15: baseline separate requests took about 3.2–5.2 seconds to generate 1–2.6 seconds of speech. With batching/prefetch, the same test paragraph used two requests; 32 live PCM packets passed through the actual `LocalSpeechAudioPlayer` in Electron, all 32 ended, and its Web Audio schedule had no gaps between packets. First provider packet still took about 5.5 seconds in that run. This verifies cloud/audio scheduling, not subjective voice quality or a microphone-driven AI conversation. After English-hint tuning, the synthetic ASR sample returned both English sentences completely. Full suite: 332 tests; lint/build passed.

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
- Analysis flow: list refresh and sentence clicks are local-only and must never call the LLM. Ending a practice collects the completed archive, saved vocabulary, and all saved sentences -> `LearningService.reviewWithSentences()` returns the review plus one validated analysis per saved `sourceMessageId` -> `SpeakSubStore.saveReview()` writes both into current archive metadata -> `finalizeSession()` rebuilds the index -> the three-line preview and detail drawer read the cached analysis. Every transcript is first sent to the model in one complete request. Long transcripts over 8,000 characters use streaming JSON reception and a 300-second review timeout so the gateway does not need to buffer the entire structured result; the threshold is based on text size, never elapsed practice time, so a one-hour practice with only a few lines remains a normal complete request. Only when that complete request actually receives HTTP 504 or times out does recovery split it on complete AI/Me turn boundaries into requests of at most about 6,000 transcript characters. A failed segment is split again down to the 2,000-character retry floor. Every segment is analyzed; segment corrections are parsed and locally deduplicated without an item-count cap, while a compact final request synthesizes the overall summary, assessment, saved vocabulary, and saved-sentence analyses without resending the raw transcript or correction list. Archived “重新生成复盘” uses the same path and `saveArchivedReview()`, including for older sentences without analysis. An incomplete sentence-analysis result fails the review instead of silently storing a partial set; the saved transcript and sentences still finalize safely.
- Storage and safety: streaming events cannot be saved; repeated clicks on the same source message are idempotent; saved text is normalized to the compact subtitle form. Deleting an archived session also removes its sentence entries. Legacy indexes or archive metadata without `sentences`/`learningStatus` migrate to an empty list or default each saved sentence to `learning` during rebuild.
- Tests: `src/main/store.test.ts` covers completed/streaming boundaries, Markdown, deduplication, combined review/analysis persistence, status changes, restart rebuild, and archive deletion; `src/main/learning-service.test.ts` covers the short single-request response, complete long-transcript streaming, 504 fallback chunking/adaptive re-splitting, local correction merge, incomplete-analysis rejection, preservation of more than ten valid corrections, and exclusion of the generated ChatGPT setup prompt while retaining API/user turns; `src/renderer/subtitle-overlay.test.tsx` covers both voice and text entry points plus symmetric wrap-width calculation; `src/renderer/LearningCenter.test.tsx` covers cached analysis display, per-session long-correction collapse/expand, source/mode metadata, and learning/mastered grouping.
- Verify: `pnpm exec vitest run src/main/store.test.ts src/main/learning-service.test.ts src/renderer/subtitle-overlay.test.tsx src/renderer/LearningCenter.test.tsx src/main/practice-pipeline.integration.test.ts src/main/speech-segments.test.ts`, then `pnpm lint` and `pnpm build`. Real acceptance: save one AI and one user sentence in both voice and text practices, finish each practice, and confirm the ending progress first sends one complete review request; then confirm all four appear under learning center -> “句子” -> “正在学” with analysis already present before any sentence click and remain after restart. Open a history detail with more than five corrections, confirm only that session's correction count is initially visible, expand to see every correction, and collapse it again without affecting the global sentence list. Mark one sentence “已学会”, confirm it moves groups and can be moved back. Resize the subtitle overlay and confirm the text begins and wraps with equal 57 px left/right gutters.

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
practice:end 保存完整对话 -> LearningService.review() 使用 300 秒复盘专用超时
-> 先将完整转写单次发送；超过 8,000 字符时以流式 JSON 接收，避免网关等待整份结果
-> 仅完整请求遇到 504/超时才按完整 turn 分成约 6,000 字符的片段
-> 片段仍失败则继续缩小；每段均送入模型，本地合并全部纠错，再以精简证据生成总评
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
-> 最小非流式 /chat/completions / Paraformer task-started 后立即 stop
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
- `src/main/provider-connection-check.ts`：设置页的大模型真实对话检测和阿里 Paraformer 握手检测；当前输入 Key 优先，空密码框回退到 `SecureSettings` 中已保存的 Key。
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
- `src/main/learning-service.ts`：LLM 消息角色组装、SSE 解析和复盘结构化；对话历史必须保持 `system -> user / assistant` 顺序。普通对话请求为 30 秒超时，复盘请求为 300 秒专用超时。长转写先完整流式请求；只有 504/超时才走 turn 对齐的分段分析、失败段递归缩小和精简总评链路，是否进入流式模式与练习持续时间无关。
- `src/renderer/LearningCenter.tsx`：历史、完整复盘、缺失复盘的显式重试、词汇和复习 UI。单次历史复盘超过五条纠错时默认收起，按该次复盘独立展开全部；这不是全局“句子”列表。

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
| `src/main/learning-service.test.ts` | 完整 system 组合、user/assistant 历史顺序、SSE、非流式回退、复盘超时、长转写分段/504 重试/纠错合并、ChatGPT 启动提示词排除与完整纠错列表 |
| `src/main/provider-connection-check.test.ts` | 大模型最小对话、HTTP/超时错误、已保存 Key 回退，以及阿里握手与安全关闭 |
| `src/renderer/local-speech-audio.test.ts` | 麦克风采集重采样、输入强度阈值、提示音和播放 generation |
| `src/renderer/App.voice.test.tsx` | 来源、模式、语音门控、设置和客户端事件 |
| `src/renderer/app-state.test.ts` | 生命周期忙碌状态、下一次练习模板映射 |
| `src/renderer/subtitle-overlay.test.tsx` | 字幕、查词、收藏和交互状态 |
| `src/renderer/LearningCenter.test.tsx` | 历史详情、单次长纠错列表折叠/完整展开、缺失复盘重试、词汇列表和复习卡 |
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

先读根目录 `agent.md`。它汇总已核实的打包、源码推送、用户上传 Release 和旧版自动更新验收流程；根目录 `AGENTS.md` 是后续任务的入口。

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
- ChatGPT 发送入口优先限定在输入框所属表单；等待唯一的可见、可用发送按钮，旧页面没有表单时才搜索全页具名发送键。不得恢复按几何位置猜控件的兜底。
- ChatGPT 新建聊天后输入框可能先显示、后才接受文本；`fillAndSendPrompt()` 可等待 45 秒取得焦点，选中旧草稿后只输入一次，再等待发送按钮。首次提交未被接受时仅按未发送草稿状态有限重试，不重复输入提示词。
- ChatGPT 清理失败时必须保留 marker，供下次启动重试；不能删除普通用户对话。
- 不要只看 UI 截图猜修复点；至少验证解析输出、chunk 输出和入库结果中的一个或多个边界。
- `store.ts` 是学习索引和复习日期的唯一写入点；列表刷新不得触发 LLM 网络回退。
- 结束练习时复盘失败不会丢失对话；历史详情必须保留显式“重新生成复盘”入口。真实验收要确认重试成功后同一 Markdown 出现 `## Review`、详情出现评分，学习中心能力趋势随即更新。
- 长对话的 `issues` 不设 8 条或 10 条硬上限；模型返回的全部有效、非重复纠错都应通过解析并写入归档。首页可单独截取少量摘要，但历史详情保存和展示完整列表；每条纠错的字段类型与收藏句子分析完整性仍必须严格校验。
- 长对话的上下文容量与网关等待时间是两个边界：只要模型支持，先把完整转写一次发送并流式接收 JSON；不要因持续时间长而主动删减或分段。仅在完整请求收到 504/超时时，才按 Markdown 的完整 AI/Me turn 分段提取纠错并继续缩小失败段。每段内容都送入模型，最终总评只携带精简证据；各段 `issues` 在本地按原句和改写去重合并，避免汇总模型截断或重新施加数量上限。
- ChatGPT 网页归档的第一条 `Me` 是应用发送的练习启动提示词，不是学习者口语。复盘输入副本必须移除嵌入的 Base64 元数据、已有 `## Review` 和这条首轮提示词，只分析余下 `### Me`；API 直连没有这条网页启动消息，第一条真实回答不得删除。原始 Markdown 归档保持不变。
- 设置页“探测可用模型”只验证 `/models`；“检测大模型”才验证实际 `/chat/completions`。阿里检测只验证 Key、网络和服务握手，不代表麦克风或扬声器可用。
- 大模型连通性检测只要求成功返回标准 `choices[0].message`；不要要求极短测试请求必须有非空 `message.content`，推理模型可能先耗尽测试输出额度但真实流式对话仍完全可用。
- 设置页麦克风检测仅验证系统权限和本地输入信号，不验证阿里识别准确率或扬声器；离开设置页时必须停止测试音轨。
- `main.tsx` 与 `overlay-main.tsx` 由两个 HTML 入口引用，静态未使用扫描可能误报，不能删除。
- `.playwright-cli/` 与 `artifacts/` 是本地验收产物，除非明确纳入版本控制，否则视为用户工作区内容。
- 正式版直接加载打包后的本地 HTML，不启动 localhost 服务，也不占用固定端口。
- 自动更新只接受 `yin-yizhen/SpeakHub` 的正式 GitHub Release；第三方镜像仅在资产带 GitHub SHA-256 digest 时启用。
