# SpeakSub

SpeakSub is a Windows speaking-practice tool with subtitles, local practice archives, reviews, and vocabulary learning.

## Anonymous usage analytics

SpeakSub enables minimal anonymous usage analytics by default. It helps us understand application launches, approximate runtime, and version usage. Events are sent only by the Electron main process and never read practice content.

The only fields sent are an anonymous installation ID, a per-launch session ID, `app_open` / `app_heartbeat` / `app_close`, app version, operating system, architecture, and runtime seconds for a normal close.

Data is stored in Alibaba Cloud Simple Log Service (SLS) for 90 days. SpeakSub does not send audio, speech or subtitle text, ChatGPT content, cookies, API keys, accounts, file paths, IP addresses, or other free-form text.

An “active installation” is an anonymous installation ID, not necessarily a natural person. The anonymous WebTracking endpoint can be spoofed, so these figures are suitable for product trends only and must not be used for precise auditing.

## Verification

```powershell
pnpm lint
pnpm test
pnpm build
pnpm package:win
```
