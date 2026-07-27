import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Notification, screen, shell, WebContentsView, type OpenDialogOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { ChatGPTAdapter, type SourceAdapter } from './chatgpt-adapter'
import { ChatGPTAutomation } from './chatgpt-automation'
import { ChatGPTMarkerStore } from './chatgpt-marker'
import { cleanRecordedConversations } from './background-cleanup'
import { isCurrentConnectionPage, loadConnectionUrl } from './connection-navigation'
import { LearningService } from './learning-service'
import { LocalSpeechService } from './local-speech-service'
import { SpeechModelManager, speechModelRoot } from './speech-model-manager'
import { SpeechSegmenter } from './speech-segments'
import { SequentialTaskQueue } from './sequential-task-queue'
import { SessionCheckpoint } from './session-checkpoint'
import { SecureSettings } from './secure-settings'
import { SpeakSubStore } from './store'
import { AppSettingsStore, defaultSubtitlePreferences, parseSubtitleUpdate } from './app-settings'
import { discoverProviderModels } from './provider-model-probe'
import { defaultMicrophoneShortcut, normalizeMicrophoneShortcut, replaceGlobalMicrophoneShortcut } from './microphone-shortcut'
import { bargeInDelayMs } from './barge-in-policy'
import { PracticeController } from './practice-controller'
import { buildPracticePrompt, parsePracticeProfile } from './practice-profile'
import { DiagnosticLog } from './diagnostic-log'
import { AnonymousAnalytics } from './analytics'
import { ALIYUN_FUN_ASR_CNY_PER_SECOND } from './aliyun-fun-asr'
import { openAllowedHelpUrl } from './external-help-navigation'
import { embeddedConnectionBounds, resizeBounds, subtitleBounds, subtitleHeight, type ResizeDirection } from './window-layout'
import { mergeTranscriptEvent } from '../shared/transcript'
import type { AutomationStatus, ConnectionState, CorrectionStrength, GeneratedSpeechChunk, MicrophoneGateState, PracticeMode, PracticeProfile, PracticeSession, PracticeSource, ReviewResult, SpeechUsageState, SubtitlePreferences, TranscriptEvent, VoiceAudioChunk, VoiceCaptureStatus, VoiceTurnPhase } from '../shared/types'

const CHATGPT_URL = 'https://chatgpt.com/'
const CONNECTION_WIDTH = 420
const WEB_PRACTICE_PARTITION = 'persist:speaksub-chatgpt'

let mainWindow: BrowserWindow | undefined
let chatHostView: WebContentsView | undefined
let cleanupWindow: BrowserWindow | undefined
let cleanupTask: Promise<void> | undefined
let overlayWindow: BrowserWindow | undefined
let adapter: SourceAdapter | undefined
let chatgptAutomation: ChatGPTAutomation | undefined
let store: SpeakSubStore
let settings: SecureSettings
let appSettings: AppSettingsStore
let learning: LearningService
let chatMarker: ChatGPTMarkerStore
let activeSession: PracticeSession | undefined
let activeSource: PracticeSource = 'chatgpt-web'
let activeMode: PracticeMode = 'voice'
let activeTopic = '日常聊天'
let activeLevel = 'A1'
let activePrompt: string | undefined
let events: TranscriptEvent[] = []
let localSpeech: LocalSpeechService | undefined
let speechModels: SpeechModelManager
let voicePhase: VoiceTurnPhase = 'idle'
let voiceGeneration = 0
let voiceTurnFinishedGeneration: number | undefined
let activeVoiceReply: { generation: number; controller: AbortController; messageId: string; reply: string } | undefined
const pendingPlayback = new Map<string, number>()
const voiceReplyPromises = new Set<Promise<void>>()
let microphoneSpeechActive = false
let microphoneSpeechStartedAt = 0
let recentSpeechEligibleUntil = 0
let pendingBargeTranscript: { utteranceId: string; text: string; final: boolean } | undefined
let bargeTimer: ReturnType<typeof setTimeout> | undefined
let echoCancellationAvailable = true
let subtitle: SubtitlePreferences = defaultSubtitlePreferences
let connection: ConnectionState = { ready: false, pageVisible: true, activeProvider: 'chatgpt-web', providers: { 'chatgpt-web': false } }
let automationStatus: AutomationStatus = { phase: 'idle', message: 'Ready to practice.' }
let studioBounds: Electron.Rectangle
const practiceController = new PracticeController()
let textMessagePromise: Promise<void> | undefined
let diagnostics: DiagnosticLog
let sessionCheckpoint: SessionCheckpoint | undefined
let archiveDirectory: string
let microphoneActive = false
let microphoneShortcut = defaultMicrophoneShortcut
let microphoneShortcutError: string | undefined
let chatgptMicrophoneGateReady = false
let analytics: AnonymousAnalytics | undefined
let sessionSpeechUsageSeconds = 0
let aliyunTaskUsageSeconds = 0

function rendererUrl(page: string): string { return process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}/${page}` : pathToFileURL(join(__dirname, `../renderer/${page}`)).toString() }
function preloadPath(): string { return join(__dirname, '../preload/preload.js') }
function chatgptMicrophonePreloadPath(): string { return join(__dirname, '../preload/chatgpt-microphone.js') }
function broadcast(channel: string, payload: unknown): void { for (const window of [mainWindow, overlayWindow]) if (window && !window.isDestroyed()) window.webContents.send(channel, payload) }
function microphoneGateState(): MicrophoneGateState { return { active: microphoneActive, available: Boolean(activeSession) && activeMode === 'voice', shortcut: microphoneShortcut } }
function usageMonth(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
function speechUsageState(): SpeechUsageState {
  const month = usageMonth()
  const monthlySeconds = appSettings?.speechUsageSeconds(month) ?? 0
  return { provider: 'aliyun-fun-asr', sessionSeconds: sessionSpeechUsageSeconds, month, monthlySeconds, estimatedCny: monthlySeconds * ALIYUN_FUN_ASR_CNY_PER_SECOND }
}
function announceSpeechUsage(): void { broadcast('speech:usage', speechUsageState()) }
function recordAliyunUsage(cumulativeSeconds: number): void {
  const delta = Math.max(0, Math.floor(cumulativeSeconds) - aliyunTaskUsageSeconds)
  if (!delta) return
  aliyunTaskUsageSeconds += delta
  sessionSpeechUsageSeconds += delta
  appSettings.addSpeechUsageSeconds(usageMonth(), delta)
  announceSpeechUsage()
}
function state() { return { session: activeSession, settings: subtitle, events, connection, automation: automationStatus, source: activeSource, mode: activeMode, lifecycle: practiceController.lifecycle, microphone: microphoneGateState(), speechAssets: speechModels.state(), speechUsage: speechUsageState(), voicePhase } }
function announceAutomation(status: AutomationStatus): void { automationStatus = status; diagnostics?.write('automation', { phase: status.phase, recoverable: status.recoverable }); broadcast('automation:status', status) }
function announceConnection(): void { broadcast('connection:state', connection) }
function announceMicrophone(): void { broadcast('microphone:state', microphoneGateState()) }
function announceVoicePhase(phase: VoiceTurnPhase): void { voicePhase = phase; broadcast('voice:phase', phase) }
function notify(title: string, body: string): void { if (Notification.isSupported()) new Notification({ title, body }).show() }
function sourceUrl(): string { return CHATGPT_URL }

async function setMicrophoneGate(active: boolean): Promise<MicrophoneGateState> {
  if (!activeSession || activeMode !== 'voice') { microphoneActive = false; announceMicrophone(); return microphoneGateState() }
  if (activeSource === 'chatgpt-web') {
    if (!chatHostView || !chatgptMicrophoneGateReady) throw new Error('ChatGPT microphone gate is not ready. Refresh the connection page and try again.')
    chatHostView.webContents.send('speaksub:microphone-gate', active)
  }
  microphoneActive = active
  announceMicrophone()
  return microphoneGateState()
}

async function toggleMicrophoneGate(): Promise<MicrophoneGateState> { return setMicrophoneGate(!microphoneActive) }

function registerMicrophoneShortcut(next: string): string {
  const previous = microphoneShortcut
  const shortcut = replaceGlobalMicrophoneShortcut(globalShortcut, previous, next, () => { void toggleMicrophoneGate().catch((error) => announceAutomation({ phase: 'failed', message: error instanceof Error ? error.message : 'Could not toggle the microphone.', recoverable: true })) })
  microphoneShortcut = shortcut
  microphoneShortcutError = undefined
  announceMicrophone()
  return shortcut
}

function layoutChatHostView(): void {
  if (!mainWindow || !chatHostView) return
  const [width, height] = mainWindow.getContentSize()
  chatHostView.setBounds(embeddedConnectionBounds({ width, height }, CONNECTION_WIDTH))
}

function applyWindowMode(): void {
  if (!mainWindow || !chatHostView) return
  mainWindow.setMinimumSize(1020, 680); mainWindow.setBounds(studioBounds)
  if (connection.pageVisible) {
    layoutChatHostView(); chatHostView.setVisible(true); mainWindow.show(); chatHostView.webContents.focus(); return
  }
  chatHostView.setVisible(false); mainWindow.show(); mainWindow.focus()
}

function createChatHostView(): void {
  if (!mainWindow) return
  chatHostView = new WebContentsView({ webPreferences: { partition: WEB_PRACTICE_PARTITION, preload: chatgptMicrophonePreloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  mainWindow.contentView.addChildView(chatHostView)
  chatHostView.setVisible(false); chatHostView.webContents.setBackgroundThrottling(false)
  const allowed = (value: string) => { try { const url = new URL(value); return url.protocol === 'https:' && ['chatgpt.com', 'auth.openai.com'].includes(url.hostname) } catch { return false } }
  chatHostView.webContents.setWindowOpenHandler(({ url }) => allowed(url) ? { action: 'allow' } : { action: 'deny' })
  chatHostView.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
  chatHostView.webContents.on('did-start-navigation', () => { chatgptMicrophoneGateReady = false })
  ipcMain.on('speaksub:microphone-gate:ready', (event, result: { ok?: boolean; message?: string }) => {
    if (event.sender !== chatHostView?.webContents) return
    chatgptMicrophoneGateReady = result?.ok === true
    if (!chatgptMicrophoneGateReady) { announceAutomation({ phase: 'failed', message: result?.message ?? 'ChatGPT microphone gate could not start.', recoverable: true }); return }
    const webInputActive = Boolean(activeSession) && activeSource === 'chatgpt-web' && activeMode === 'voice' ? microphoneActive : true
    event.sender.send('speaksub:microphone-gate', webInputActive)
  })
  ipcMain.on('speaksub:microphone-gate:applied', (event, result: { ok?: boolean; message?: string }) => {
    if (event.sender !== chatHostView?.webContents || result?.ok) return
    microphoneActive = false; announceMicrophone(); announceAutomation({ phase: 'failed', message: result?.message ?? 'ChatGPT microphone gate did not apply.', recoverable: true })
  })
  void loadConnectionUrl(chatHostView.webContents, CHATGPT_URL)
  chatgptAutomation = new ChatGPTAutomation(chatHostView.webContents)
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({ ...studioBounds, show: false, frame: false, backgroundColor: '#f7fdfb', title: 'SpeakHub', webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false } })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedHelpUrl(
      url,
      (target) => shell.openExternal(target),
      (message) => dialog.showErrorBox('无法打开网页', `${message}\n\n请检查 Windows 是否设置了默认浏览器。`)
    )
    return { action: 'deny' }
  })
  mainWindow.removeMenu(); mainWindow.loadURL(rendererUrl('index.html'))
  mainWindow.on('move', () => { studioBounds = mainWindow!.getBounds() })
  mainWindow.on('resize', () => { studioBounds = mainWindow!.getBounds(); if (connection.pageVisible) layoutChatHostView() })
  mainWindow.on('restore', applyWindowMode); mainWindow.on('closed', () => { adapter?.stop(); adapter = undefined; chatHostView = undefined; chatgptAutomation = undefined; cleanupWindow?.destroy(); overlayWindow?.close() })
}

function createOverlayWindow(): void {
  const bounds = subtitleBounds(screen.getPrimaryDisplay().workArea, undefined, subtitleHeight(subtitle.fontSize, subtitle.maxLines))
  overlayWindow = new BrowserWindow({ ...bounds, transparent: true, frame: false, alwaysOnTop: true, resizable: false, minWidth: 420, minHeight: 150, skipTaskbar: true, hasShadow: false, webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false } })
  overlayWindow.setAlwaysOnTop(true, 'pop-up-menu'); overlayWindow.loadURL(rendererUrl('overlay.html')); overlayWindow.hide(); overlayWindow.webContents.once('did-finish-load', () => setOverlayInteractive(false)); overlayWindow.on('moved', persistOverlayBounds); overlayWindow.on('resized', persistOverlayBounds)
}

function persistOverlayBounds(): void { if (!overlayWindow || subtitle.locked || !subtitle.visible) return; subtitle = { ...subtitle, bounds: overlayWindow.getBounds() }; persistSubtitle(); broadcast('subtitle:settings', subtitle) }
function setOverlayInteractive(interactive: boolean): void { overlayWindow?.setIgnoreMouseEvents(!interactive, { forward: true }) }
function persistSubtitle(): void { appSettings?.saveSubtitle(subtitle) }
function showOverlay(): SubtitlePreferences { if (!overlayWindow) return subtitle; const current = subtitle.bounds ?? overlayWindow.getBounds(); const bounds = subtitleBounds(screen.getPrimaryDisplay().workArea, current.width, Math.max(current.height, subtitleHeight(subtitle.fontSize, subtitle.maxLines))); overlayWindow.setBounds(bounds); subtitle = { ...subtitle, visible: true, bounds }; setOverlayInteractive(false); overlayWindow.show(); overlayWindow.moveTop(); mainWindow?.focus(); persistSubtitle(); broadcast('subtitle:settings', subtitle); return subtitle }

function handleEvent(event: Omit<TranscriptEvent, 'id' | 'sessionId'>): void {
  if (!activeSession) return
  const next: TranscriptEvent = { ...event, id: randomUUID(), sessionId: activeSession.id }
  events = mergeTranscriptEvent(events, next); store.upsertEvent(next); broadcast('transcript:event', next)
  diagnostics?.write('transcript', { sessionId: activeSession.id, speaker: next.speaker, status: next.status, characters: next.text.length, total: events.length })
}

function stopSessionCheckpoint(flush = false): void { sessionCheckpoint?.stop(flush); sessionCheckpoint = undefined }
function beginSession(profile: PracticeProfile): PracticeSession {
  events = []
  activeSession = store.createSession(profile)
  sessionCheckpoint = new SessionCheckpoint(() => { if (activeSession) store.flushSession(activeSession.id) })
  sessionCheckpoint.start()
  return activeSession
}

function beginWebAdapter(): void {
  if (!chatHostView) throw new Error('The web practice window is not ready.')
  const unsupported = () => announceAutomation({ phase: 'failed', message: 'ChatGPT page text cannot be read. Open the connection page and check the signed-in page.', recoverable: true })
  adapter = new ChatGPTAdapter(chatHostView.webContents, handleEvent, unsupported)
  adapter.start()
}

function createCleanupWindow(): BrowserWindow {
  cleanupWindow?.destroy()
  cleanupWindow = new BrowserWindow({ show: false, skipTaskbar: true, webPreferences: { partition: WEB_PRACTICE_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  cleanupWindow.webContents.setBackgroundThrottling(false)
  return cleanupWindow
}

function cleanPreviousInBackground(): void {
  if (cleanupTask) return
  const markerStore = chatMarker
  if (!markerStore.readAll().length) return
  const worker = createCleanupWindow()
  const automation = new ChatGPTAutomation(worker.webContents)
  cleanupTask = cleanRecordedConversations(markerStore, (conversation) => conversation.conversationTitle
    ? automation.deleteConversationByTitle(conversation.conversationTitle)
    : automation.deleteConversation(conversation.conversationUrl)).then((summary) => {
    if (!summary.attempted) return
    if (summary.remainingRecordedUrls.length) {
      notify('SpeakSub cleanup needs attention', `${summary.remainingRecordedUrls.length} recorded ChatGPT chat${summary.remainingRecordedUrls.length === 1 ? '' : 's'} could not be deleted and will be retried later.`)
      return
    }
    notify('SpeakSub cleaned previous chats', `${summary.deleted} recorded ChatGPT chat${summary.deleted === 1 ? '' : 's'} deleted.`)
  }).catch((error) => notify('SpeakSub cleanup needs attention', error instanceof Error ? error.message : 'Background cleanup failed.')).finally(() => {
    if (!worker.isDestroyed()) worker.destroy()
    if (cleanupWindow === worker) cleanupWindow = undefined
    cleanupTask = undefined
  })
}

async function prepareWebPractice(topic: string, level: string, strength: CorrectionStrength, mode: PracticeMode, focus?: string, prompt?: string) {
  if (!connection.providers['chatgpt-web']) throw new Error('Please sign in to ChatGPT on the connection page first.')
  const automation = chatgptAutomation
  if (!automation) throw new Error('The web practice window is not ready.')
  cleanPreviousInBackground()
  announceAutomation({ phase: 'filling-prompt', message: 'Creating a new ChatGPT practice.' })
  const newChat = await automation.startNewChat(); if (!newChat.ok) throw new Error(newChat.message)
  const profile = parsePracticeProfile({ topic, level, correctionStrength: strength, source: 'chatgpt-web', mode, focus, prompt })
  const session = beginSession(profile); beginWebAdapter()
  let sent
  try { sent = await automation.fillAndSendPrompt(buildPracticePrompt(profile)) }
  catch (error) { adapter?.stop(); adapter = undefined; stopSessionCheckpoint(true); store.abortSession(session.id); activeSession = undefined; throw error }
  if (!sent.ok) {
    adapter?.stop(); adapter = undefined; stopSessionCheckpoint(true); store.abortSession(session.id); activeSession = undefined
    announceAutomation({ phase: 'failed', message: sent.message, recoverable: true }); throw new Error(sent.message)
  }
  const capture = await automation.captureConversationUrl().catch(() => ({ ok: false, message: 'ChatGPT did not expose a conversation URL; automatic cleanup is unavailable for this turn.', conversationUrl: undefined }))
  if (capture.ok && capture.conversationUrl) {
    chatMarker.write(capture.conversationUrl)
    void automation.captureConversationTitle(capture.conversationUrl).then((conversationTitle) => {
      if (conversationTitle) chatMarker.setTitle(capture.conversationUrl!, conversationTitle)
    }).catch(() => undefined)
  }
  announceAutomation({ phase: 'waiting-for-reply', message: 'Prompt sent. Waiting for ChatGPT.' })
  if (mode === 'text') { announceAutomation({ phase: 'idle', message: 'ChatGPT text practice is ready.' }); return { session, voiceStarted: false, source: 'chatgpt-web' as const, mode, warning: capture.ok ? undefined : capture.message } }
  const voice = await automation.waitForReplyAndStartVoice().catch((error) => ({ ok: false, message: error instanceof Error ? error.message : 'ChatGPT voice could not start.' }))
  if (!voice.ok) { announceAutomation({ phase: 'failed', message: voice.message, recoverable: true }); return { session, voiceStarted: false, source: 'chatgpt-web' as const, mode, warning: voice.message } }
  announceAutomation({ phase: 'voice-started', message: voice.message }); return { session, voiceStarted: true, source: 'chatgpt-web' as const, mode }
}

async function beginApiVoicePractice(strength: CorrectionStrength, topic: string, level: string, focus?: string, prompt?: string) {
  const config = settings.get()
  if (!config.llmBaseUrl || !config.llmModel || !config.hasLlmKey) throw new Error('请先在设置中填写 DeepSeek 或其他 OpenAI-compatible 文本 API。')
  if (!config.hasAliyunAsrKey) throw new Error('请先在设置中填写阿里云 DashScope API Key。')
  const assets = speechModels.state()
  const requiredReady = assets.vad.status === 'ready' && assets.tts.status === 'ready'
  if (!requiredReady) throw new Error('请先到设置下载 VAD 与 Kokoro 语音组件。')
  announceAutomation({ phase: 'filling-prompt', message: '正在连接阿里中英实时识别…' })
  const profile = parsePracticeProfile({ topic, level, correctionStrength: strength, source: 'api-direct', mode: 'voice', focus, prompt })
  const session = beginSession(profile)
  microphoneSpeechActive = false
  recentSpeechEligibleUntil = 0
  pendingBargeTranscript = undefined
  sessionSpeechUsageSeconds = 0
  aliyunTaskUsageSeconds = 0
  announceSpeechUsage()
  echoCancellationAvailable = true
  clearBargeTimer()
  localSpeech = new LocalSpeechService(speechModels.paths, {
    aliyunApiKey: settings.getSecrets().aliyunAsrApiKey
  })
  localSpeech.onSpeechActivity((active) => handleLocalSpeechActivity(active))
  localSpeech.onTranscript((transcript) => acceptLocalTranscript(session.id, transcript))
  localSpeech.onUsage(recordAliyunUsage)
  localSpeech.onError((error) => announceAutomation({ phase: 'failed', message: error.message, recoverable: true }))
  try { await localSpeech.start() } catch (error) { await localSpeech.stop().catch(() => undefined); localSpeech = undefined; stopSessionCheckpoint(true); store.abortSession(session.id); activeSession = undefined; throw error }
  announceVoicePhase('listening')
  announceAutomation({ phase: 'idle', message: `阿里中英识别已就绪。按 ${microphoneShortcut} 开始说话。` })
  return { session, voiceStarted: false, source: 'api-direct' as const, mode: 'voice' as const }
}

function clearBargeTimer(): void {
  if (bargeTimer) clearTimeout(bargeTimer)
  bargeTimer = undefined
}

function handleLocalSpeechActivity(active: boolean): void {
  microphoneSpeechActive = active
  clearBargeTimer()
  diagnostics?.write('voice-speech-activity', {
    active,
    phase: voicePhase,
    generation: activeVoiceReply?.generation
  })
  if (active) {
    microphoneSpeechStartedAt = Date.now()
    recentSpeechEligibleUntil = 0
    const sessionId = activeSession?.id
    if (activeVoiceReply && sessionId) {
      const generation = activeVoiceReply.generation
      const delay = interruptionDelay()
      bargeTimer = setTimeout(() => {
        bargeTimer = undefined
        if (!microphoneSpeechActive || activeVoiceReply?.generation !== generation) return
        const pending = pendingBargeTranscript
        const interrupted = interruptVoiceResponse('vad')
        if (!interrupted || !pending) return
        pendingBargeTranscript = undefined
        emitLocalTranscript(sessionId, pending)
      }, delay)
    }
    return
  }
  recentSpeechEligibleUntil = Date.now() + 2_500
}

function interruptionDelay(): number {
  return bargeInDelayMs(voicePhase, echoCancellationAvailable)
}

function interruptVoiceResponse(trigger: 'vad' | 'transcript' | 'manual' = 'transcript'): boolean {
  const turn = activeVoiceReply
  if (!turn) return false
  clearBargeTimer()
  voiceGeneration += 1
  turn.controller.abort()
  localSpeech?.cancelSynthesis(turn.generation)
  for (const [id, generation] of pendingPlayback) if (generation <= turn.generation) pendingPlayback.delete(id)
  mainWindow?.webContents.send('voice:interrupt', voiceGeneration)
  if (turn.reply.trim()) {
    handleEvent({
      sourceMessageId: turn.messageId,
      speaker: 'assistant',
      text: turn.reply,
      status: 'complete',
      interrupted: true,
      receivedAt: new Date().toISOString()
    })
  }
  if (activeVoiceReply === turn) activeVoiceReply = undefined
  voiceTurnFinishedGeneration = undefined
  diagnostics?.write('voice-barge-in', {
    trigger,
    phase: voicePhase,
    generation: turn.generation,
    speechMs: Math.max(0, Date.now() - microphoneSpeechStartedAt),
    recognizedCharacters: pendingBargeTranscript?.text.trim().length ?? 0
  })
  announceVoicePhase('listening')
  announceAutomation({ phase: 'idle', message: '已打断 AI，正在听你说。' })
  return true
}

function emitLocalTranscript(sessionId: string, transcript: { utteranceId: string; text: string; final: boolean }): void {
  if (!activeSession || activeSession.id !== sessionId || !transcript.text.trim()) return
  handleEvent({ sourceMessageId: `${sessionId}-${transcript.utteranceId}`, speaker: 'user', text: transcript.text, status: transcript.final ? 'complete' : 'streaming', receivedAt: new Date().toISOString() })
  if (!transcript.final) return
  announceVoicePhase('thinking')
  const task = streamApiReply(false)
  voiceReplyPromises.add(task)
  void task.catch(() => undefined).finally(() => voiceReplyPromises.delete(task))
}

function tryBargeIn(): boolean {
  const transcript = pendingBargeTranscript
  if (!transcript || !activeVoiceReply || !transcript.text.trim()) return false
  const speechRecentlyEnded = Date.now() <= recentSpeechEligibleUntil
  if (!microphoneSpeechActive && !(transcript.final && speechRecentlyEnded)) return false
  const elapsed = Date.now() - microphoneSpeechStartedAt
  const delay = interruptionDelay()
  if (!transcript.final && elapsed < delay) return false
  if (!interruptVoiceResponse('transcript')) return false
  pendingBargeTranscript = undefined
  return true
}

function acceptLocalTranscript(sessionId: string, transcript: { utteranceId: string; text: string; final: boolean }): void {
  if (!activeSession || activeSession.id !== sessionId || !transcript.text.trim()) return
  if (voicePhase !== 'listening') {
    pendingBargeTranscript = transcript
    if (!tryBargeIn()) return
  }
  emitLocalTranscript(sessionId, transcript)
}

function maybeResumeListening(generation: number): void {
  if (voiceTurnFinishedGeneration !== generation || [...pendingPlayback.values()].some((value) => value === generation) || !activeSession || practiceController.lifecycle !== 'active' || activeMode !== 'voice' || activeSource !== 'api-direct') return
  voiceTurnFinishedGeneration = undefined
  if (activeVoiceReply?.generation === generation) activeVoiceReply = undefined
  if (!pendingBargeTranscript) localSpeech?.reset()
  announceVoicePhase('listening')
  announceAutomation({ phase: 'idle', message: '可以继续说话，也可以随时打断 AI。' })
}

async function streamApiReply(addUserMessage: boolean, userText?: string): Promise<void> {
  if (!activeSession) throw new Error('Start an API practice first.')
  if (addUserMessage && userText) handleEvent({ sourceMessageId: `api-user-${randomUUID()}`, speaker: 'user', text: userText, status: 'complete', receivedAt: new Date().toISOString() })
  const messageId = `api-assistant-${randomUUID()}`
  const segmenter = new SpeechSegmenter()
  const shouldSpeak = activeMode === 'voice'
  let reply = ''
  let segmentIndex = 0
  const synthesis = new SequentialTaskQueue()
  const generation = shouldSpeak ? ++voiceGeneration : 0
  const controller = new AbortController()
  const turn = shouldSpeak ? { generation, controller, messageId, reply } : undefined
  if (turn) activeVoiceReply = turn
  voiceTurnFinishedGeneration = undefined
  const queueSpeech = (text: string): void => {
    if (!shouldSpeak || !localSpeech) return
    const index = segmentIndex++
    announceVoicePhase('synthesizing')
    synthesis.enqueue(async () => {
      const audio = await localSpeech!.synthesize(text, messageId, index, generation)
      if (!activeSession || controller.signal.aborted || generation !== voiceGeneration) return
      if (audio.sampleRate !== 24000) throw new Error(`Kokoro returned unsupported sample rate ${audio.sampleRate}.`)
      const id = `${messageId}-${index}`
      const samples = audio.samples.slice()
      const chunk: GeneratedSpeechChunk = { id, messageId, index, generation, sampleRate: 24000, format: 'float32', samples: samples.buffer, final: true }
      pendingPlayback.set(id, generation)
      announceVoicePhase('speaking')
      mainWindow?.webContents.send('voice:audio', chunk)
    })
  }
  announceAutomation({ phase: 'waiting-for-reply', message: 'DeepSeek 正在流式回复…' })
  try {
    await learning.streamChat(events, activeTopic, activeLevel, {
      signal: controller.signal,
      onDelta: (delta) => {
        if (controller.signal.aborted || (shouldSpeak && generation !== voiceGeneration)) return
        reply += delta
        if (turn) turn.reply = reply
        handleEvent({ sourceMessageId: messageId, speaker: 'assistant', text: reply, status: 'streaming', receivedAt: new Date().toISOString() })
        for (const segment of segmenter.push(delta)) queueSpeech(segment)
      }
    }, activePrompt)
    for (const segment of segmenter.flush()) queueSpeech(segment)
    if (reply) handleEvent({ sourceMessageId: messageId, speaker: 'assistant', text: reply, status: 'complete', receivedAt: new Date().toISOString() })
    await synthesis.done()
    if (shouldSpeak && generation !== voiceGeneration) return
    voiceTurnFinishedGeneration = shouldSpeak ? generation : undefined
    if (!shouldSpeak) announceAutomation({ phase: 'idle', message: 'API reply received. Continue when ready.' })
    if (shouldSpeak) maybeResumeListening(generation)
  } catch (error) {
    if (controller.signal.aborted || (shouldSpeak && generation !== voiceGeneration)) return
    announceAutomation({ phase: 'failed', message: error instanceof Error ? error.message : 'API reply failed.', recoverable: true })
    if (shouldSpeak && activeSession) {
      voiceTurnFinishedGeneration = generation
      maybeResumeListening(generation)
    }
    throw error
  }
}

function setConnection(next: Partial<ConnectionState>): ConnectionState { connection = { ...connection, ...next }; connection.ready = connection.providers[connection.activeProvider]; applyWindowMode(); announceConnection(); return connection }

async function chooseArchiveDirectory(): Promise<string | undefined> {
  if (activeSession) throw new Error('End the active practice before changing the archive folder.')
  const options: OpenDialogOptions = { title: 'Choose SpeakSub archive folder', defaultPath: archiveDirectory, properties: ['openDirectory', 'createDirectory'] }
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
  const directory = result.filePaths[0]
  if (result.canceled || !directory) return undefined
  archiveDirectory = directory
  store = new SpeakSubStore(archiveDirectory)
  appSettings.setArchiveDirectory(archiveDirectory)
  return archiveDirectory
}

async function completeConnection(): Promise<ConnectionState> {
  const source = connection.activeProvider
  if (!chatHostView || !isCurrentConnectionPage(chatHostView.webContents.getURL(), source)) throw new Error('Open the ChatGPT connection page first.')
  const ready = await chatgptAutomation?.isReady()
  if (!ready) throw new Error('The ChatGPT composer was not found. Finish signing in and try again.')
  appSettings.setProviderReady(source, true)
  return setConnection(appSettings.connection(source, false))
}

async function sendPracticeMessage(message: string): Promise<void> {
  if (!activeSession || activeMode !== 'text') throw new Error('Start a text practice first.')
  if (textMessagePromise) throw new Error('Wait for the current reply before sending another message.')
  const text = z.string().trim().min(1).max(10_000).parse(message)
  textMessagePromise = (async () => {
    try {
      if (activeSource === 'api-direct') {
        await streamApiReply(true, text)
        return
      }
      const automation = chatgptAutomation
      if (!automation) throw new Error('The web practice window is not ready.')
      const provider = 'ChatGPT'
      announceAutomation({ phase: 'waiting-for-reply', message: `Sending your message to ${provider}…` })
      const sent = await automation.fillAndSendPrompt(text)
      if (!sent.ok) throw new Error(sent.message)
      announceAutomation({ phase: 'waiting-for-reply', message: `Your message was sent. Waiting for ${provider}…` })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Message failed to send.'
      announceAutomation({ phase: 'failed', message: detail, recoverable: true })
      throw error
    } finally {
      textMessagePromise = undefined
    }
  })()
  return textMessagePromise
}

function installIpc(): void {
  ipcMain.handle('app:state', () => state())
  ipcMain.handle('connection:complete', () => completeConnection())
  ipcMain.handle('connection:show', () => {
    activeSource = 'chatgpt-web'
    const next = setConnection(appSettings.connection('chatgpt-web', true))
    if (chatHostView && !isCurrentConnectionPage(chatHostView.webContents.getURL(), 'chatgpt-web')) {
      void loadConnectionUrl(chatHostView.webContents, sourceUrl()).catch((error) => announceAutomation({ phase: 'failed', message: error instanceof Error ? `Could not open ChatGPT: ${error.message}` : 'Could not open the connection page.', recoverable: true }))
    }
    return next
  })
  ipcMain.handle('connection:clear-pending-cleanup', () => {
    chatMarker.clear()
    announceAutomation({ phase: 'idle', message: 'The previous practice record was cleared. You can start a new practice.' })
  })
  ipcMain.handle('connection:hide', () => setConnection({ pageVisible: false }))
  ipcMain.handle('window:minimize', (event) => { if (event.sender === mainWindow?.webContents) mainWindow.minimize() })
  ipcMain.handle('window:toggle-maximize', (event) => {
    if (event.sender !== mainWindow?.webContents) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle('window:close', (event) => { if (event.sender === mainWindow?.webContents) mainWindow.close() })
  ipcMain.handle('practice:start', (_event, topic: string, level: string, strength: CorrectionStrength, source: PracticeSource = 'chatgpt-web', mode: PracticeMode = 'text', focus?: string, prompt?: string) => practiceController.start(async () => {
    const profile = parsePracticeProfile({ topic, level, correctionStrength: strength, source, mode, focus, prompt })
    activeSource = profile.source; activeMode = profile.mode; activeTopic = profile.topic; activeLevel = profile.level; activePrompt = buildPracticePrompt(profile)
    microphoneActive = profile.mode === 'voice'
    if (profile.source === 'chatgpt-web' && profile.mode === 'voice') chatHostView?.webContents.send('speaksub:microphone-gate', true)
    announceMicrophone()
    if (profile.source === 'api-direct') {
      const config = settings.get()
      if (!config.llmBaseUrl || !config.llmModel || !config.hasLlmKey) throw new Error('请先在设置中填写 DeepSeek 或其他 OpenAI-compatible 文本 API。')
      if (profile.mode === 'voice') return beginApiVoicePractice(profile.correctionStrength, profile.topic, profile.level, profile.focus, profile.prompt)
      const session = beginSession(profile); announceAutomation({ phase: 'idle', message: 'API direct text practice is ready. Type a message to begin.' }); return { session, voiceStarted: false, source: profile.source, mode: profile.mode }
    }
    return prepareWebPractice(profile.topic, profile.level, profile.correctionStrength, profile.mode, profile.focus, profile.prompt)
  }, () => activeSession ? { session: activeSession, voiceStarted: automationStatus.phase === 'voice-started', source: activeSource, mode: activeMode } : undefined))
  ipcMain.handle('practice:templates:get', () => appSettings.promptTemplates())
  ipcMain.handle('practice:templates:save', (_event, templates) => appSettings.setPromptTemplates(templates))
  ipcMain.handle('practice:preferences:get', () => appSettings.practicePreferences())
  ipcMain.handle('practice:preferences:save', (_event, preferences) => appSettings.setPracticePreferences(preferences))
  ipcMain.handle('practice:sendMessage', (_event, message: string) => sendPracticeMessage(message))
  ipcMain.handle('api:sendMessage', (_event, message: string) => sendPracticeMessage(message))
  ipcMain.handle('voice:audio', (_event, input: VoiceAudioChunk) => {
    const chunk = z.object({ sampleRate: z.literal(16000), format: z.literal('float32'), samples: z.instanceof(ArrayBuffer) }).parse(input)
    if (chunk.samples.byteLength > 1_048_576 || chunk.samples.byteLength % 4 !== 0) throw new Error('Invalid voice audio chunk.')
    if (activeSource === 'api-direct' && activeMode === 'voice' && microphoneActive) localSpeech?.accept(new Float32Array(chunk.samples))
  })
  ipcMain.handle('voice:playback:ended', (_event, chunkId: string) => {
    const id = z.string().min(1).max(300).parse(chunkId)
    const generation = pendingPlayback.get(id)
    pendingPlayback.delete(id)
    if (generation !== undefined) maybeResumeListening(generation)
  })
  ipcMain.handle('voice:capture:start', () => { if (!activeSession || activeSource !== 'api-direct' || activeMode !== 'voice') throw new Error('Start an API voice practice first.') })
  ipcMain.handle('voice:capture:stop', () => undefined)
  ipcMain.handle('voice:capture:status', (_event, input: VoiceCaptureStatus) => {
    const status = z.object({ echoCancellation: z.boolean() }).parse(input)
    echoCancellationAvailable = status.echoCancellation
    diagnostics?.write('voice-capture', status)
    if (!status.echoCancellation) announceAutomation({ phase: 'failed', message: '当前麦克风没有启用回声消除；仍可打断 AI，但建议使用耳机以减少误触发。', recoverable: true })
  })
  ipcMain.handle('speech-assets:get', () => speechModels.state())
  ipcMain.handle('speech-assets:download', () => speechModels.ensureAll())
  ipcMain.handle('microphone:toggle', () => toggleMicrophoneGate())
  ipcMain.handle('microphone:set', (_event, active: boolean) => setMicrophoneGate(z.boolean().parse(active)))
  ipcMain.handle('microphone:shortcut:save', (_event, shortcut: string) => { const saved = registerMicrophoneShortcut(z.string().max(80).parse(shortcut)); appSettings.setMicrophoneShortcut(saved); return saved })
  ipcMain.handle('practice:cancel-start', async () => { if (!activeSession || events.length) return; activeVoiceReply?.controller.abort(); voiceGeneration += 1; clearBargeTimer(); await localSpeech?.stop(); localSpeech = undefined; activeVoiceReply = undefined; pendingPlayback.clear(); announceVoicePhase('idle'); adapter?.stop(); adapter = undefined; stopSessionCheckpoint(true); store.abortSession(activeSession.id); activeSession = undefined; microphoneActive = false; announceMicrophone(); practiceController.reset(); announceAutomation({ phase: 'failed', message: 'Practice startup was cancelled before any transcript was recorded.', recoverable: true }) })
  ipcMain.handle('practice:end', async () => {
    const result = await practiceController.end(async () => {
      if (!interruptVoiceResponse()) {
        activeVoiceReply?.controller.abort()
        voiceGeneration += 1
        mainWindow?.webContents.send('voice:interrupt', voiceGeneration)
      }
      clearBargeTimer()
      if (textMessagePromise) await textMessagePromise.catch(() => undefined)
      if (voiceReplyPromises.size) await Promise.all([...voiceReplyPromises].map((task) => task.catch(() => undefined)))
      const session = activeSession!
      const reviewFavorites = store.favoriteWordsForSession(session.id)
      let voiceStopped = activeMode !== 'voice'; let voiceWarning: string | undefined
      if (activeSource === 'chatgpt-web' && activeMode === 'voice') { announceAutomation({ phase: 'stopping-voice', message: 'Ending ChatGPT voice…' }); const result = await chatgptAutomation?.stopVoice().catch(() => undefined); voiceStopped = result?.ok === true; voiceWarning = voiceStopped ? undefined : result?.message ?? 'Could not end ChatGPT voice automatically.' }
      if (activeSource === 'api-direct' && activeMode === 'voice') {
        await localSpeech?.stop().catch(() => undefined)
        localSpeech = undefined; activeVoiceReply = undefined; pendingPlayback.clear(); announceVoicePhase('idle'); voiceStopped = true
      }
      adapter?.stop(); adapter = undefined
      stopSessionCheckpoint(true)
      const ended = store.endSession(session)
      const reviewArchive = store.readSessionMarkdown(ended.id)
      announceAutomation({ phase: voiceStopped ? 'idle' : 'failed', message: voiceStopped ? 'Practice ended.' : voiceWarning!, recoverable: !voiceStopped })
      let review: ReviewResult | undefined; let reviewError: string | undefined
      try { review = await learning.review(reviewArchive, ended.correctionStrength, reviewFavorites); store.saveReview(ended.id, review) }
      catch (error) { reviewError = error instanceof Error ? error.message : 'Review generation failed.' }
      try { store.finalizeSession(ended.id) }
      catch (error) { throw new Error(`Could not finalize the practice archive: ${error instanceof Error ? error.message : 'unknown file error'}. The session remains available to retry.`) }
    activeSession = undefined
      microphoneActive = false; announceMicrophone()
      return { session: ended, review, error: reviewError, voiceStopped, voiceWarning }
    }, () => Boolean(activeSession))
    broadcast('practice:ended', result)
    return result
  })
  ipcMain.handle('subtitle:update', (_event, input: Partial<SubtitlePreferences>) => { const wasLocked = subtitle.locked; subtitle = parseSubtitleUpdate(subtitle, input); if (overlayWindow) { if (wasLocked !== subtitle.locked) setOverlayInteractive(false); if (!subtitle.visible) overlayWindow.hide() }; persistSubtitle(); broadcast('subtitle:settings', subtitle); return subtitle })
  ipcMain.handle('subtitle:toggle', () => { if (subtitle.visible) { subtitle = { ...subtitle, visible: false }; overlayWindow?.hide(); persistSubtitle(); broadcast('subtitle:settings', subtitle); return subtitle }; return showOverlay() })
  ipcMain.handle('subtitle:interactive', (_event, interactive: boolean) => setOverlayInteractive(z.boolean().parse(interactive)))
  ipcMain.handle('subtitle:move', (_event, origin, deltaX: number, deltaY: number) => { const parsedOrigin = z.object({ x: z.number(), y: z.number(), width: z.number().min(320), height: z.number().min(100) }).parse(origin); const dx = z.number().min(-10_000).max(10_000).parse(deltaX); const dy = z.number().min(-10_000).max(10_000).parse(deltaY); if (!overlayWindow || subtitle.locked) return subtitle; const bounds = { ...parsedOrigin, x: parsedOrigin.x + dx, y: parsedOrigin.y + dy }; overlayWindow.setBounds(bounds); subtitle = { ...subtitle, bounds }; persistSubtitle(); broadcast('subtitle:settings', subtitle); return subtitle })
  ipcMain.handle('subtitle:resize', (_event, direction: ResizeDirection, origin, deltaX: number, deltaY: number) => { const parsedDirection = z.enum(['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right']).parse(direction); const parsedOrigin = z.object({ x: z.number(), y: z.number(), width: z.number().min(320), height: z.number().min(100) }).parse(origin); const dx = z.number().min(-10_000).max(10_000).parse(deltaX); const dy = z.number().min(-10_000).max(10_000).parse(deltaY); if (!overlayWindow || subtitle.locked) return subtitle; const bounds = resizeBounds(parsedOrigin, parsedDirection, dx, dy, undefined, subtitleHeight(subtitle.fontSize, subtitle.maxLines)); overlayWindow.setBounds(bounds); subtitle = { ...subtitle, bounds }; persistSubtitle(); broadcast('subtitle:settings', subtitle); return subtitle })
  ipcMain.handle('learning:lookup', (_event, selection: string, sentence?: string) => learning.lookup(z.string().trim().min(1).max(500).parse(selection), sentence ? z.string().max(10_000).parse(sentence) : undefined))
  ipcMain.handle('session:save-favorite', (_event, word: string) => { if (!activeSession) throw new Error('Start a practice before saving a word.'); store.saveFavorite(activeSession.id, z.string().trim().min(1).max(500).parse(word)) })
  const historyQuerySchema = z.object({ text: z.string().max(10_000).optional(), source: z.enum(['chatgpt-web', 'api-direct']).optional(), mode: z.enum(['text', 'voice']).optional(), level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1']).optional(), status: z.enum(['completed', 'interrupted']).optional(), dateFrom: z.string().datetime().optional(), dateTo: z.string().datetime().optional() }).optional()
  ipcMain.handle('learning:sessions:search', (_event, query) => store.searchSessions(historyQuerySchema.parse(query)))
  ipcMain.handle('learning:sessions:get', (_event, id) => store.getSessionDetail(z.string().uuid().parse(id)))
  ipcMain.handle('learning:sessions:delete', (_event, id) => store.deleteSession(z.string().uuid().parse(id)))
  ipcMain.handle('learning:vocabulary:list', (_event, filter) => {
    const vocabulary = store.listVocabulary(z.object({ familiarity: z.enum(['unfamiliar', 'learning', 'mastered']).optional(), dueOnly: z.boolean().optional(), text: z.string().max(500).optional() }).optional().parse(filter))
    return vocabulary.map((item) => {
      if (item.meaning) return item
      const meaning = learning.lookupLocal(item.term)?.definitions.join('；')
      return meaning ? store.saveVocabularyMeaning(item.id, meaning) : item
    })
  })
  ipcMain.handle('learning:vocabulary:update', (_event, id, familiarity) => store.updateVocabularyFamiliarity(z.string().uuid().parse(id), z.enum(['unfamiliar', 'learning', 'mastered']).parse(familiarity)))
  ipcMain.handle('learning:vocabulary:review', (_event, id, rating) => store.reviewVocabulary(z.string().uuid().parse(id), z.enum(['again', 'hard', 'good', 'easy']).parse(rating)))
  ipcMain.handle('learning:vocabulary:queue', () => store.getReviewQueue())
  ipcMain.handle('learning:dashboard', (_event, period) => store.getLearningDashboard(z.enum(['week', 'month']).parse(period)))
  ipcMain.handle('learning:next-practice', (_event, id) => store.createNextPracticeDraft(z.string().uuid().parse(id)))
  ipcMain.handle('archive:get-directory', () => archiveDirectory)
  ipcMain.handle('archive:choose-directory', () => chooseArchiveDirectory())
  ipcMain.handle('providers:get', () => settings.get())
  ipcMain.handle('providers:save', (_event, input) => {
    if (activeSession) throw new Error('请先结束当前练习，再切换 API 或语音识别设置。')
    const saved = settings.save(z.object({
      llmBaseUrl: z.string().max(2_000).optional(),
      llmModel: z.string().max(200).optional(),
      llmApiKey: z.string().max(2_000).optional(),
      clearLlmApiKey: z.boolean().optional(),
      aliyunAsrApiKey: z.string().max(2_000).optional(),
      clearAliyunAsrApiKey: z.boolean().optional()
    }).parse(input))
    announceSpeechUsage()
    return saved
  })
  ipcMain.handle('providers:models', async (_event, input) => {
    const parsed = z.object({ llmBaseUrl: z.string().trim().min(1).max(2_000), llmApiKey: z.string().max(2_000).optional() }).parse(input)
    return discoverProviderModels(parsed.llmBaseUrl, parsed.llmApiKey || settings.getSecrets().llmApiKey || '')
  })
  ipcMain.handle('data:clear', () => { if (activeSession) throw new Error('End the active practice before clearing data.'); store.clear(); settings.clear(); appSettings.clear(); subtitle = defaultSubtitlePreferences; events = []; practiceController.reset(); broadcast('subtitle:settings', subtitle); return setConnection(appSettings.connection('chatgpt-web', true)) })
}

app.whenReady().then(() => {
  const workArea = screen.getPrimaryDisplay().workArea; studioBounds = { x: Math.round(workArea.x + (workArea.width - Math.min(1320, workArea.width)) / 2), y: Math.round(workArea.y + (workArea.height - Math.min(860, workArea.height)) / 2), width: Math.min(1320, workArea.width), height: Math.min(860, workArea.height) }
  const userData = app.getPath('userData'); diagnostics = new DiagnosticLog(join(userData, 'speaksub-diagnostics.jsonl')); appSettings = new AppSettingsStore(join(userData, 'app-settings.json')); try { microphoneShortcut = normalizeMicrophoneShortcut(appSettings.microphoneShortcut()) } catch { microphoneShortcut = defaultMicrophoneShortcut; appSettings.setMicrophoneShortcut(microphoneShortcut) } connection = appSettings.connection('chatgpt-web', !appSettings.providerReady('chatgpt-web')); subtitle = appSettings.readSubtitle()
  archiveDirectory = appSettings.archiveDirectory(join(userData, 'learning-archive')); store = new SpeakSubStore(archiveDirectory); settings = new SecureSettings(join(userData, 'provider-settings.json')); chatMarker = new ChatGPTMarkerStore(join(userData, 'last-speaksub-chat.json')); learning = new LearningService(settings, join(app.getAppPath(), 'resources', 'dictionaries', 'ecdict-en-zh')); speechModels = new SpeechModelManager(speechModelRoot({ isPackaged: app.isPackaged, executablePath: process.execPath, userDataDirectory: userData })); speechModels.subscribe((assetState) => broadcast('speech-assets:state', assetState))
  const showPersistedOverlay = subtitle.visible
  try { registerMicrophoneShortcut(microphoneShortcut) } catch (error) { microphoneShortcutError = error instanceof Error ? error.message : 'The saved microphone shortcut is unavailable.' }
  createMainWindow(); createChatHostView(); createOverlayWindow(); installIpc(); applyWindowMode(); cleanPreviousInBackground(); mainWindow?.webContents.once('did-finish-load', () => { analytics = new AnonymousAnalytics({ userDataDirectory: userData, appVersion: app.getVersion(), platform: process.platform, arch: process.arch }); void analytics.start() }); if (microphoneShortcutError) announceAutomation({ phase: 'failed', message: microphoneShortcutError, recoverable: true }); if (showPersistedOverlay) showOverlay()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createMainWindow(); createChatHostView(); createOverlayWindow(); applyWindowMode() } })
})

app.on('will-quit', () => globalShortcut.unregister(microphoneShortcut))

app.on('before-quit', () => { stopSessionCheckpoint(true); void analytics?.close() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
