# SpeakSub Code Map

This is the compact index for changing, testing, and running SpeakSub.

Last complete verification: `unknown`

## Start Here

| Goal | Main files | Tests | Verification |
| --- | --- | --- | --- |
| Windows, IPC, practice source routing, and overlay | `src/main/index.ts`, `src/main/preload.ts`, `src/shared/types.ts` | Electron manual check | `pnpm lint && pnpm build` |
| ChatGPT web practice and cleanup | `src/main/chatgpt-adapter.ts`, `src/main/chatgpt-automation.ts`, `src/main/chatgpt-marker.ts` | `src/main/chatgpt-*.test.ts` | `pnpm test` |
| Gemini web practice and cleanup | `src/main/gemini-adapter.ts`, `src/main/gemini-automation.ts`, `src/main/gemini-marker.ts` | `src/main/gemini-adapter.test.ts` | `pnpm test` plus Gemini manual check |
| API direct practice and review | `src/main/learning-service.ts`, `src/main/index.ts` | `src/main/learning-service.test.ts` | `pnpm test` |
| Subtitle and learning UI | `src/renderer/App.tsx`, `src/renderer/subtitle-overlay.tsx` | Electron manual check | `pnpm dev` |
| Local archive, dictionary, and learning services | `src/main/store.ts`, `src/main/local-dictionary.ts`, `src/main/learning-service.ts` | `src/main/store.test.ts`, `src/main/local-dictionary.test.ts`, `src/main/learning-service.test.ts` | `pnpm test` |

## End-to-End Flow

```text
Practice source selection in App.tsx
-> practice:start IPC
-> ChatGPT/Gemini web automation and adapter, or OpenAI-compatible LearningService.chat
-> transcript:event merge, Markdown archive, and subtitle broadcast
-> subtitle window and practice UI
-> practice:end -> LearningService.review -> Markdown review
```

## Modules

### Practice Source Routing

`src/shared/types.ts` defines `PracticeSource`: `chatgpt-web`, `gemini-web`, and `api-direct`. `src/main/preload.ts` exposes the IPC surface. `src/main/index.ts` owns the active source, local session, transcript event broadcast, source-specific startup, and end-of-session review.

API direct does not open a web window: every typed user message and received assistant reply is turned into a `TranscriptEvent`, broadcast to subtitles, and archived. It reuses the configured OpenAI-compatible Base URL, model, and encrypted API key. It is text-only in this version.

### ChatGPT and Gemini Web Practice

ChatGPT and Gemini each have their own adapter, automation, marker, selector contracts, and persisted marker file. Do not reuse ChatGPT DOM selectors for Gemini. Before a new practice, SpeakSub deletes only the exact previously recorded conversation URL for the same provider. If a provider does not expose a uniquely addressable URL, do not write a marker and do not delete a chat later.

Gemini has no voice automation in this prototype; it otherwise follows the same scene/level/start/capture/subtitle/end/review sequence as ChatGPT.

### Local Learning Services

`src/main/learning-service.ts` prefers the bundled ECDICT `LocalDictionary` and uses the optional OpenAI-compatible LLM for lookup enrichment, API direct chat, and review. There is no third-party dictionary key path. `src/main/store.ts` writes Markdown transcript and review files. LLM keys stay in Electron `safeStorage` and never enter archives.

## Test Index

| Test file | Covers |
| --- | --- |
| `src/shared/transcript.test.ts` | streaming merge, deduplication, speaker filtering, clipping |
| `src/main/chatgpt-adapter.test.ts` | ChatGPT fixture parsing |
| `src/main/chatgpt-automation.test.ts` | ChatGPT composer, send, generation, and voice selectors |
| `src/main/gemini-adapter.test.ts` | Gemini-only user/model fixture parsing |
| `src/main/chatgpt-marker.test.ts` | ChatGPT marker persistence and validation |
| `src/main/learning-service.test.ts` | local/remote lookup, review boundary, OpenAI-compatible direct-chat request and error boundary |
| `src/main/local-dictionary.test.ts` | compressed ECDICT bucket and inflection lookup |
| `src/main/store.test.ts` | Markdown session and study archive |

## Verification Commands

```powershell
pnpm lint
pnpm test
pnpm build
pnpm package:win
pnpm dev
```

## Runtime Notes

- This is a personal prototype. Web automation can break when ChatGPT or Gemini changes its DOM or service behavior.
- Real acceptance for each web provider: log in on the connection page, choose a topic and level, start, confirm page text reaches subtitles, end, restart the app, and confirm only the recorded SpeakSub conversation is removed before the next practice. Use a disposable conversation.
- Real acceptance for API direct: configure Base URL/model/key, start without opening a web page, send a user turn, confirm both turns reach subtitles and the Markdown archive, then end and confirm review generation.
- The bundled dictionary needs the matching letter bucket for queried words. If `local-dictionary.test.ts` fails for `word`, check for `resources/dictionaries/ecdict-en-zh/w.json.br` before changing lookup code.
- Verify parser output, subtitle event output, and Markdown archive when diagnosing provider changes; screenshots alone are insufficient.
