import { app, BrowserWindow, dialog, ipcMain, Notification, screen, type OpenDialogOptions } from 'electron'
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
import { RealtimeVoiceService } from './realtime-voice-service'
import { SessionCheckpoint } from './session-checkpoint'
import { SecureSettings } from './secure-settings'
import { SpeakSubStore } from './store'
import { AppSettingsStore, defaultSubtitlePreferences, parseSubtitleUpdate } from './app-settings'
import { PracticeController } from './practice-controller'
import { buildPracticePrompt, parsePracticeProfile } from './practice-profile'
import { DiagnosticLog } from './diagnostic-log'
import { resizeBounds, subtitleBounds, subtitleHeight, type ResizeDirection } from './window-layout'
import { mergeTranscriptEvent } from '../shared/transcript'
import type { AutomationStatus, ConnectionState, CorrectionStrength, PracticeEndResult, PracticeMode, PracticeSession, PracticeSource, PracticeStartResult, SubtitlePreferences, TranscriptEvent, WebPracticeSource } from '../shared/types'

const CHATGPT_URL = 'https://chatgpt.com/'
const CONNECTION_WIDTH = 420
const WEB_PRACTICE_PARTITION = 'persist:speaksub-chatgpt'

let mainWindow: BrowserWindow | undefined
let chatHostWindow: BrowserWindow | undefined
let cleanupWindow: BrowserWindow | undefined
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
let activeMode: PracticeMode = 'text'
let activeTopic = '日常聊天'
let activeLevel = 'B1'
let events: TranscriptEvent[] = []
let realtimeVoice: RealtimeVoiceService | undefined
let subtitle: SubtitlePreferences = defaultSubtitlePreferences
let connection: ConnectionState = { ready: false, pageVisible: true, activeProvider: 'chatgpt-web', providers: { 'chatgpt-web': false } }
let automationStatus: AutomationStatus = { phase: 'idle', message: 'Ready to practice.' }
let studioBounds: Electron.Rectangle
const practiceController = new PracticeController()
let textMessagePromise: Promise<void> | undefined
let diagnostics: DiagnosticLog
let sessionCheckpoint: SessionCheckpoint | undefined
let archiveDirectory: string

function rendererUrl(page: string): string { return process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}/${page}` : pathToFileURL(join(__dirname, `../renderer/${page}`)).toString() }
function preloadPath(): string { return join(__dirname, '../preload/preload.js') }
function broadcast(channel: string, payload: unknown): void { for (const window of [mainWindow, overlayWindow]) if (window && !window.isDestroyed()) window.webContents.send(channel, payload) }
function state() { return { session: activeSession, settings: subtitle, events, connection, automation: automationStatus, source: activeSource, mode: activeMode, lifecycle: practiceController.lifecycle } }
function announceAutomation(status: AutomationStatus): void { automationStatus = status; diagnostics?.write('automation', { phase: status.phase, recoverable: status.recoverable }); broadcast('automation:status', status) }
function announceConnection(): void { broadcast('connection:state', connection) }
function notify(title: string, body: string): void { if (Notification.isSupported()) new Notification({ title, body }).show() }
function sourceUrl(): string { return CHATGPT_URL }

function applyWindowMode(): void {
  if (!mainWindow || !chatHostWindow) return
  if (connection.pageVisible) {
    mainWindow.setMinimumSize(CONNECTION_WIDTH, 620); mainWindow.setBounds({ x: studioBounds.x, y: studioBounds.y, width: CONNECTION_WIDTH, height: studioBounds.height })
    chatHostWindow.setBounds({ x: studioBounds.x + CONNECTION_WIDTH, y: studioBounds.y, width: Math.max(560, studioBounds.width - CONNECTION_WIDTH), height: studioBounds.height }); chatHostWindow.show(); mainWindow.show(); chatHostWindow.focus(); return
  }
  mainWindow.setMinimumSize(1020, 680); chatHostWindow.setBounds(studioBounds); chatHostWindow.showInactive(); mainWindow.setBounds(studioBounds); mainWindow.show(); mainWindow.focus()
}

function createChatHostWindow(): void {
  chatHostWindow = new BrowserWindow({ ...studioBounds, show: false, title: 'Web practice connection', skipTaskbar: true, backgroundColor: '#ffffff', webPreferences: { partition: WEB_PRACTICE_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  chatHostWindow.webContents.setBackgroundThrottling(false)
  const allowed = (value: string) => { try { const url = new URL(value); return url.protocol === 'https:' && ['chatgpt.com', 'auth.openai.com'].includes(url.hostname) } catch { return false } }
  chatHostWindow.webContents.setWindowOpenHandler(({ url }) => allowed(url) ? { action: 'allow' } : { action: 'deny' })
  chatHostWindow.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
  void loadConnectionUrl(chatHostWindow.webContents, CHATGPT_URL)
  chatgptAutomation = new ChatGPTAutomation(chatHostWindow.webContents)
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({ ...studioBounds, show: false, backgroundColor: '#111513', title: 'SpeakSub', webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false } })
  mainWindow.loadURL(rendererUrl('index.html'))
  mainWindow.on('move', () => { if (!connection.pageVisible) { studioBounds = mainWindow!.getBounds(); chatHostWindow?.setBounds(studioBounds) } })
  mainWindow.on('resize', () => { if (!connection.pageVisible) { studioBounds = mainWindow!.getBounds(); chatHostWindow?.setBounds(studioBounds) } })
  mainWindow.on('minimize', () => chatHostWindow?.hide()); mainWindow.on('restore', applyWindowMode); mainWindow.on('closed', () => { chatHostWindow?.destroy(); cleanupWindow?.destroy(); overlayWindow?.close() })
}

function createOverlayWindow(): void {
  const bounds = subtitleBounds(screen.getPrimaryDisplay().workArea, undefined, subtitleHeight(subtitle.fontSize, subtitle.maxLines))
  overlayWindow = new BrowserWindow({ ...bounds, transparent: true, frame: false, alwaysOnTop: true, resizable: false, minWidth: 420, minHeight: 150, skipTaskbar: true, hasShadow: false, webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false } })
  overlayWindow.setAlwaysOnTop(true, 'pop-up-menu'); overlayWindow.loadURL(rendererUrl('overlay.html')); overlayWindow.hide(); overlayWindow.webContents.once('did-finish-load', () => setOverlayInteractive(true)); overlayWindow.on('moved', persistOverlayBounds); overlayWindow.on('resized', persistOverlayBounds)
}

function persistOverlayBounds(): void { if (!overlayWindow || subtitle.locked || !subtitle.visible) return; subtitle = { ...subtitle, bounds: overlayWindow.getBounds() }; persistSubtitle(); broadcast('subtitle:settings', subtitle) }
function setOverlayInteractive(interactive: boolean): void { overlayWindow?.setIgnoreMouseEvents(!interactive, { forward: true }) }
function persistSubtitle(): void { appSettings?.saveSubtitle(subtitle) }
function showOverlay(): SubtitlePreferences { if (!overlayWindow) return subtitle; const current = subtitle.bounds ?? overlayWindow.getBounds(); const bounds = subtitleBounds(screen.getPrimaryDisplay().workArea, current.width, Math.max(current.height, subtitleHeight(subtitle.fontSize, subtitle.maxLines))); overlayWindow.setBounds(bounds); subtitle = { ...subtitle, visible: true, bounds }; setOverlayInteractive(true); overlayWindow.show(); overlayWindow.moveTop(); mainWindow?.focus(); persistSubtitle(); broadcast('subtitle:settings', subtitle); return subtitle }

function handleEvent(event: Omit<TranscriptEvent, 'id' | 'sessionId'>): void {
  if (!activeSession) return
  const next: TranscriptEvent = { ...event, id: randomUUID(), sessionId: activeSession.id }
  events = mergeTranscriptEvent(events, next); store.upsertEvent(next); broadcast('transcript:event', next)
  diagnostics?.write('transcript', { sessionId: activeSession.id, speaker: next.speaker, status: next.status, characters: next.text.length, total: events.length })
}

function stopSessionCheckpoint(flush = false): void { sessionCheckpoint?.stop(flush); sessionCheckpoint = undefined }
function beginSession(strength: CorrectionStrength): PracticeSession {
  events = []
  activeSession = store.createSession(strength)
  sessionCheckpoint = new SessionCheckpoint(() => { if (activeSession) store.flushSession(activeSession.id) })
  sessionCheckpoint.start()
  return activeSession
}

function beginWebAdapter(): void {
  if (!chatHostWindow) throw new Error('The web practice window is not ready.')
  const unsupported = () => announceAutomation({ phase: 'failed', message: 'ChatGPT page text cannot be read. Open the connection page and check the signed-in page.', recoverable: true })
  adapter = new ChatGPTAdapter(chatHostWindow.webContents, handleEvent, unsupported)
  adapter.start()
}

function createCleanupWindow(): BrowserWindow {
  cleanupWindow?.destroy()
  cleanupWindow = new BrowserWindow({ show: false, skipTaskbar: true, webPreferences: { partition: WEB_PRACTICE_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  cleanupWindow.webContents.setBackgroundThrottling(false)
  return cleanupWindow
}

function cleanPreviousInBackground(): void {
  const markerStore = chatMarker
  if (!markerStore.readAll().length) return
  const worker = createCleanupWindow()
  const automation = new ChatGPTAutomation(worker.webContents)
  void cleanRecordedConversations(markerStore, (conversationUrl) => automation.deleteConversation(conversationUrl)).then((summary) => {
    if (!summary.attempted) return
    if (summary.remainingRecordedUrls.length) {
      notify('SpeakSub cleanup needs attention', `${summary.remainingRecordedUrls.length} recorded ChatGPT chat${summary.remainingRecordedUrls.length === 1 ? '' : 's'} could not be deleted and will be retried later.`)
      return
    }
    notify('SpeakSub cleaned previous chats', `${summary.deleted} recorded ChatGPT chat${summary.deleted === 1 ? '' : 's'} deleted.`)
  }).catch((error) => notify('SpeakSub cleanup needs attention', error instanceof Error ? error.message : 'Background cleanup failed.')).finally(() => {
    if (!worker.isDestroyed()) worker.destroy()
    if (cleanupWindow === worker) cleanupWindow = undefined
  })
}

async function prepareWebPractice(topic: string, level: string, strength: CorrectionStrength, mode: PracticeMode) {
  if (!connection.providers['chatgpt-web']) throw new Error('Please sign in to ChatGPT on the connection page first.')
  const automation = chatgptAutomation
  if (!automation) throw new Error('The web practice window is not ready.')
  cleanPreviousInBackground()
  announceAutomation({ phase: 'filling-prompt', message: 'Creating a new ChatGPT practice.' })
  const newChat = await automation.startNewChat(); if (!newChat.ok) throw new Error(newChat.message)
  const profile = parsePracticeProfile({ topic, level, correctionStrength: strength, source: 'chatgpt-web', mode })
  const session = beginSession(strength); beginWebAdapter()
  let sent
  try { sent = await automation.fillAndSendPrompt(buildPracticePrompt(profile)) }
  catch (error) { adapter?.stop(); adapter = undefined; stopSessionCheckpoint(true); store.abortSession(session.id); activeSession = undefined; throw error }
  if (!sent.ok) {
    adapter?.stop(); adapter = undefined; stopSessionCheckpoint(true); store.abortSession(session.id); activeSession = undefined
    announceAutomation({ phase: 'failed', message: sent.message, recoverable: true }); throw new Error(sent.message)
  }
  const capture = await automation.captureConversationUrl().catch(() => ({ ok: false, message: 'ChatGPT did not expose a conversation URL; automatic cleanup is unavailable for this turn.', conversationUrl: undefined }))
  if (capture.ok && capture.conversationUrl) chatMarker.write(capture.conversationUrl)
  announceAutomation({ phase: 'waiting-for-reply', message: 'Prompt sent. Waiting for ChatGPT.' })
  if (mode === 'text') { announceAutomation({ phase: 'idle', message: 'ChatGPT text practice is ready.' }); return { session, voiceStarted: false, source: 'chatgpt-web' as const, mode, warning: capture.ok ? undefined : capture.message } }
  const voice = await chatgptAutomation!.waitForReplyAndStartVoice().catch((error) => ({ ok: false, message: error instanceof Error ? error.message : 'ChatGPT voice could not start.' }))
  if (!voice.ok) { announceAutomation({ phase: 'failed', message: voice.message, recoverable: true }); return { session, voiceStarted: false, source: 'chatgpt-web' as const, mode, warning: voice.message } }
  announceAutomation({ phase: 'voice-started', message: voice.message }); return { session, voiceStarted: true, source: 'chatgpt-web' as const, mode }
}

async function beginRealtimePractice(strength: CorrectionStrength, topic: string, level: string) {
  const config = settings.get(); const secrets = settings.getSecrets()
  if (!config.realtimeEnabled || !config.realtimeModel) throw new Error('Enable OpenAI Realtime-compatible voice and configure a Realtime model in Settings first.')
  const session = beginSession(strength)
  realtimeVoice = new RealtimeVoiceService()
  const profile = parsePracticeProfile({ topic, level, correctionStrength: strength, source: 'api-direct', mode: 'voice' })
  try { await realtimeVoice.start({ baseUrl: config.llmBaseUrl, model: config.realtimeModel, apiKey: secrets.llmApiKey, protocol: config.realtimeProtocol, instructions: buildPracticePrompt(profile) }, {
    onStatus: (message) => announceAutomation({ phase: 'voice-started', message }),
    onTranscript: (speaker, text, sourceMessageId) => handleEvent({ sourceMessageId: `realtime-${sourceMessageId}`, speaker, text, status: 'complete', receivedAt: new Date().toISOString() }),
    onAudio: (pcm16) => mainWindow?.webContents.send('voice:audio', pcm16),
    onInterrupt: () => mainWindow?.webContents.send('voice:interrupt'),
    onError: (message) => announceAutomation({ phase: 'failed', message, recoverable: true })
  }) } catch (error) { realtimeVoice?.stop(); realtimeVoice = undefined; stopSessionCheckpoint(true); store.abortSession(session.id); activeSession = undefined; throw error }
  return { session, voiceStarted: true, source: 'api-direct' as const, mode: 'voice' as const }
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
  if (!chatHostWindow || !isCurrentConnectionPage(chatHostWindow.webContents.getURL(), source)) throw new Error('Open the ChatGPT connection page first.')
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
        handleEvent({ sourceMessageId: `api-user-${randomUUID()}`, speaker: 'user', text, status: 'complete', receivedAt: new Date().toISOString() })
        announceAutomation({ phase: 'waiting-for-reply', message: 'Waiting for the API response…' })
        const reply = await learning.chat(events, activeTopic, activeLevel)
        handleEvent({ sourceMessageId: `api-assistant-${randomUUID()}`, speaker: 'assistant', text: reply, status: 'complete', receivedAt: new Date().toISOString() })
        announceAutomation({ phase: 'idle', message: 'API reply received. Continue when ready.' })
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
    if (chatHostWindow && !isCurrentConnectionPage(chatHostWindow.webContents.getURL(), 'chatgpt-web')) {
      void loadConnectionUrl(chatHostWindow.webContents, sourceUrl()).catch((error) => announceAutomation({ phase: 'failed', message: error instanceof Error ? `Could not open ChatGPT: ${error.message}` : 'Could not open the connection page.', recoverable: true }))
    }
    return next
  })
  ipcMain.handle('connection:clear-pending-cleanup', () => {
    chatMarker.clear()
    announceAutomation({ phase: 'idle', message: 'The previous practice record was cleared. You can start a new practice.' })
  })
  ipcMain.handle('connection:hide', () => setConnection({ pageVisible: false }))
  ipcMain.handle('practice:start', (_event, topic: string, level: string, strength: CorrectionStrength, source: PracticeSource = 'chatgpt-web', mode: PracticeMode = 'text') => practiceController.start(async () => {
    const profile = parsePracticeProfile({ topic, level, correctionStrength: strength, source, mode })
    activeSource = profile.source; activeMode = profile.mode; activeTopic = profile.topic; activeLevel = profile.level
    if (profile.source === 'api-direct') {
      if (profile.mode === 'voice') return beginRealtimePractice(profile.correctionStrength, profile.topic, profile.level)
      const session = beginSession(profile.correctionStrength); announceAutomation({ phase: 'idle', message: 'API direct text practice is ready. Type a message to begin.' }); return { session, voiceStarted: false, source: profile.source, mode: profile.mode }
    }
    return prepareWebPractice(profile.topic, profile.level, profile.correctionStrength, profile.mode)
  }, () => activeSession ? { session: activeSession, voiceStarted: automationStatus.phase === 'voice-started', source: activeSource, mode: activeMode } : undefined))
  ipcMain.handle('practice:sendMessage', (_event, message: string) => sendPracticeMessage(message))
  ipcMain.handle('api:sendMessage', (_event, message: string) => sendPracticeMessage(message))
  ipcMain.handle('voice:audio', (_event, pcm16: ArrayBuffer) => { if (!(pcm16 instanceof ArrayBuffer) || pcm16.byteLength > 1_048_576) throw new Error('Invalid voice audio chunk.'); if (activeSource === 'api-direct' && activeMode === 'voice') realtimeVoice?.appendAudio(pcm16) })
  ipcMain.handle('voice:capture:start', () => { if (!activeSession || activeSource !== 'api-direct' || activeMode !== 'voice') throw new Error('Start an API voice practice first.') })
  ipcMain.handle('voice:capture:stop', () => undefined)
  ipcMain.handle('practice:cancel-start', () => { if (!activeSession || events.length) return; realtimeVoice?.stop(); realtimeVoice = undefined; adapter?.stop(); adapter = undefined; stopSessionCheckpoint(true); store.abortSession(activeSession.id); activeSession = undefined; practiceController.reset(); announceAutomation({ phase: 'failed', message: 'Practice startup was cancelled before any transcript was recorded.', recoverable: true }) })
  ipcMain.handle('practice:end', () => practiceController.end(async () => {
    if (textMessagePromise) await textMessagePromise.catch(() => undefined)
    const session = activeSession!
    const reviewEvents = [...events]
    const reviewFavorites = store.favoriteWordsForSession(session.id)
    let voiceStopped = activeMode !== 'voice'; let voiceWarning: string | undefined
    if (activeSource === 'chatgpt-web' && activeMode === 'voice') { announceAutomation({ phase: 'stopping-voice', message: 'Ending ChatGPT voice…' }); const result = await chatgptAutomation?.stopVoice().catch(() => undefined); voiceStopped = result?.ok === true; voiceWarning = voiceStopped ? undefined : result?.message ?? 'Could not end ChatGPT voice automatically.' }
    if (activeSource === 'api-direct' && activeMode === 'voice') { realtimeVoice?.stop(); realtimeVoice = undefined; voiceStopped = true }
    adapter?.stop(); adapter = undefined
    stopSessionCheckpoint(true)
    const ended = store.endSession(session); activeSession = undefined
    const reviewArchive = store.readSessionMarkdown(ended.id)
    announceAutomation({ phase: voiceStopped ? 'idle' : 'failed', message: voiceStopped ? 'Practice ended.' : voiceWarning!, recoverable: !voiceStopped })
    try { const review = await learning.review(reviewArchive, ended.correctionStrength, reviewFavorites); store.saveReview(ended.id, review); store.finalizeSession(ended.id); return { session: ended, review, voiceStopped, voiceWarning } }
    catch (error) { store.finalizeSession(ended.id); return { session: ended, error: error instanceof Error ? error.message : 'Review generation failed.', voiceStopped, voiceWarning } }
  }, () => Boolean(activeSession)))
  ipcMain.handle('subtitle:update', (_event, input: Partial<SubtitlePreferences>) => { subtitle = parseSubtitleUpdate(subtitle, input); if (overlayWindow) { setOverlayInteractive(true); if (!subtitle.visible) overlayWindow.hide() }; persistSubtitle(); broadcast('subtitle:settings', subtitle); return subtitle })
  ipcMain.handle('subtitle:toggle', () => { if (subtitle.visible) { subtitle = { ...subtitle, visible: false }; overlayWindow?.hide(); persistSubtitle(); broadcast('subtitle:settings', subtitle); return subtitle }; return showOverlay() })
  ipcMain.handle('subtitle:interactive', (_event, interactive: boolean) => setOverlayInteractive(z.boolean().parse(interactive)))
  ipcMain.handle('subtitle:resize', (_event, direction: ResizeDirection, origin, deltaX: number, deltaY: number) => { const parsedDirection = z.enum(['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right']).parse(direction); const parsedOrigin = z.object({ x: z.number(), y: z.number(), width: z.number().min(320), height: z.number().min(100) }).parse(origin); const dx = z.number().min(-10_000).max(10_000).parse(deltaX); const dy = z.number().min(-10_000).max(10_000).parse(deltaY); if (!overlayWindow || subtitle.locked) return subtitle; const bounds = resizeBounds(parsedOrigin, parsedDirection, dx, dy, undefined, subtitleHeight(subtitle.fontSize, subtitle.maxLines)); overlayWindow.setBounds(bounds); subtitle = { ...subtitle, bounds }; persistSubtitle(); broadcast('subtitle:settings', subtitle); return subtitle })
  ipcMain.handle('learning:lookup', (_event, selection: string, sentence?: string) => learning.lookup(z.string().trim().min(1).max(500).parse(selection), sentence ? z.string().max(10_000).parse(sentence) : undefined))
  ipcMain.handle('session:save-favorite', (_event, word: string) => { if (!activeSession) throw new Error('Start a practice before saving a word.'); store.saveFavorite(activeSession.id, z.string().trim().min(1).max(500).parse(word)) })
  ipcMain.handle('archive:get-directory', () => archiveDirectory)
  ipcMain.handle('archive:choose-directory', () => chooseArchiveDirectory())
  ipcMain.handle('providers:get', () => settings.get())
  ipcMain.handle('providers:save', (_event, input) => settings.save(z.object({ llmBaseUrl: z.string().max(2_000).optional(), llmModel: z.string().max(200).optional(), llmApiKey: z.string().max(2_000).optional(), realtimeEnabled: z.boolean().optional(), realtimeModel: z.string().max(200).optional(), realtimeProtocol: z.enum(['current', 'legacy']).optional(), clearLlmApiKey: z.boolean().optional() }).parse(input)))
  ipcMain.handle('data:clear', () => { if (activeSession) throw new Error('End the active practice before clearing data.'); store.clear(); settings.clear(); appSettings.clear(); subtitle = defaultSubtitlePreferences; connection = appSettings.connection('chatgpt-web', true); events = []; practiceController.reset(); broadcast('subtitle:settings', subtitle); announceConnection() })
}

app.whenReady().then(() => {
  const workArea = screen.getPrimaryDisplay().workArea; studioBounds = { x: Math.round(workArea.x + (workArea.width - Math.min(1320, workArea.width)) / 2), y: Math.round(workArea.y + (workArea.height - Math.min(860, workArea.height)) / 2), width: Math.min(1320, workArea.width), height: Math.min(860, workArea.height) }
  const userData = app.getPath('userData'); diagnostics = new DiagnosticLog(join(userData, 'speaksub-diagnostics.jsonl')); appSettings = new AppSettingsStore(join(userData, 'app-settings.json')); connection = appSettings.connection('chatgpt-web', !appSettings.providerReady('chatgpt-web')); subtitle = appSettings.readSubtitle()
  archiveDirectory = appSettings.archiveDirectory(join(userData, 'learning-archive')); store = new SpeakSubStore(archiveDirectory); settings = new SecureSettings(join(userData, 'provider-settings.json')); chatMarker = new ChatGPTMarkerStore(join(userData, 'last-speaksub-chat.json')); learning = new LearningService(settings, join(app.getAppPath(), 'resources', 'dictionaries', 'ecdict-en-zh'))
  const showPersistedOverlay = subtitle.visible
  createChatHostWindow(); createMainWindow(); createOverlayWindow(); installIpc(); applyWindowMode(); if (showPersistedOverlay) showOverlay()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createChatHostWindow(); createMainWindow(); createOverlayWindow(); applyWindowMode() } })
})

app.on('before-quit', () => stopSessionCheckpoint(true))
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
