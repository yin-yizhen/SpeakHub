import { app, BrowserWindow, ipcMain, Notification, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ChatGPTAdapter, type SourceAdapter } from './chatgpt-adapter'
import { ChatGPTAutomation } from './chatgpt-automation'
import { ChatGPTMarkerStore } from './chatgpt-marker'
import { GeminiAdapter } from './gemini-adapter'
import { GeminiAutomation } from './gemini-automation'
import { GeminiMarkerStore } from './gemini-marker'
import { LearningService } from './learning-service'
import { SecureSettings } from './secure-settings'
import { SpeakSubStore } from './store'
import { resizeBounds, subtitleBounds, subtitleHeight, type ResizeDirection } from './window-layout'
import { mergeTranscriptEvent } from '../shared/transcript'
import type { AutomationStatus, ConnectionState, CorrectionStrength, PracticeSession, PracticeSource, SubtitlePreferences, TranscriptEvent } from '../shared/types'

const CHATGPT_URL = 'https://chatgpt.com/'
const GEMINI_URL = 'https://gemini.google.com/app'
const CONNECTION_WIDTH = 420
const PROMPTS: Record<string, string> = {
  '日常聊天': 'Have a natural spoken English conversation with me. Ask one question at a time and gently adapt to my level.',
  '旅行英语': 'Role-play as a friendly travel companion. Use practical travel English and ask one question at a time.',
  '面试英语': 'Act as an English interviewer. Ask realistic interview questions, wait for my spoken answer, then continue.',
  '职场会议': 'Role-play a concise workplace meeting in English. Use realistic business situations and turn-taking.',
  '雅思口语': 'Act as an IELTS speaking examiner. Ask one question at a time and keep the session natural.',
  '自由闲聊': 'Start a friendly English free conversation. Keep your turns short enough for speaking practice.',
  '情景角色扮演': 'Offer a practical English role-play scenario and begin the conversation in character.'
}

let mainWindow: BrowserWindow | undefined
let chatHostWindow: BrowserWindow | undefined
let overlayWindow: BrowserWindow | undefined
let adapter: SourceAdapter | undefined
let chatgptAutomation: ChatGPTAutomation | undefined
let geminiAutomation: GeminiAutomation | undefined
let store: SpeakSubStore
let settings: SecureSettings
let learning: LearningService
let chatMarker: ChatGPTMarkerStore
let geminiMarker: GeminiMarkerStore
let activeSession: PracticeSession | undefined
let activeSource: PracticeSource = 'chatgpt-web'
let activeTopic = '日常聊天'
let activeLevel = 'B1'
let events: TranscriptEvent[] = []
let subtitle: SubtitlePreferences = { mode: 'assistant', layout: 'split', background: 'glass', backgroundColor: '#0e1713', backgroundOpacity: 0.86, assistantColor: '#f1f6f3', userColor: '#fff1c9', fontSize: 25, opacity: 0.94, locked: false, visible: false, maxLines: 4 }
let connection: ConnectionState = { ready: false, pageVisible: true }
let automationStatus: AutomationStatus = { phase: 'idle', message: 'Ready to practice.' }
let connectionStatePath = ''
let studioBounds: Electron.Rectangle

function rendererUrl(page: string): string { return process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}/${page}` : pathToFileURL(join(__dirname, `../renderer/${page}`)).toString() }
function preloadPath(): string { return join(__dirname, '../preload/preload.js') }
function broadcast(channel: string, payload: unknown): void { for (const window of [mainWindow, overlayWindow]) if (window && !window.isDestroyed()) window.webContents.send(channel, payload) }
function state() { return { session: activeSession, settings: subtitle, events, connection, automation: automationStatus, source: activeSource } }
function announceAutomation(status: AutomationStatus): void { automationStatus = status; broadcast('automation:status', status) }
function announceConnection(): void { broadcast('connection:state', connection) }
function notify(title: string, body: string): void { if (Notification.isSupported()) new Notification({ title, body }).show() }
function readConnectionReady(): boolean { try { return JSON.parse(readFileSync(connectionStatePath, 'utf8')).ready === true } catch { return false } }
function persistConnectionReady(): void { writeFileSync(connectionStatePath, JSON.stringify({ ready: connection.ready }), 'utf8') }
function sourceUrl(source: Extract<PracticeSource, 'chatgpt-web' | 'gemini-web'>): string { return source === 'gemini-web' ? GEMINI_URL : CHATGPT_URL }

function applyWindowMode(): void {
  if (!mainWindow || !chatHostWindow) return
  if (connection.pageVisible) {
    mainWindow.setMinimumSize(CONNECTION_WIDTH, 620); mainWindow.setBounds({ x: studioBounds.x, y: studioBounds.y, width: CONNECTION_WIDTH, height: studioBounds.height })
    chatHostWindow.setBounds({ x: studioBounds.x + CONNECTION_WIDTH, y: studioBounds.y, width: Math.max(560, studioBounds.width - CONNECTION_WIDTH), height: studioBounds.height }); chatHostWindow.show(); mainWindow.show(); chatHostWindow.focus(); return
  }
  mainWindow.setMinimumSize(1020, 680); chatHostWindow.setBounds(studioBounds); chatHostWindow.showInactive(); mainWindow.setBounds(studioBounds); mainWindow.show(); mainWindow.focus()
}

function createChatHostWindow(): void {
  chatHostWindow = new BrowserWindow({ ...studioBounds, show: false, title: 'Web practice connection', skipTaskbar: true, backgroundColor: '#ffffff', webPreferences: { partition: 'persist:speaksub-chatgpt', contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  chatHostWindow.webContents.setBackgroundThrottling(false)
  const allowed = (url: string) => url.startsWith('https://chatgpt.com') || url.startsWith('https://auth.openai.com') || url.startsWith('https://gemini.google.com') || url.startsWith('https://accounts.google.com')
  chatHostWindow.webContents.setWindowOpenHandler(({ url }) => allowed(url) ? { action: 'allow' } : { action: 'deny' })
  chatHostWindow.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault() })
  chatHostWindow.loadURL(CHATGPT_URL)
  chatgptAutomation = new ChatGPTAutomation(chatHostWindow.webContents); geminiAutomation = new GeminiAutomation(chatHostWindow.webContents)
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({ ...studioBounds, show: false, backgroundColor: '#111513', title: 'SpeakSub', webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false } })
  mainWindow.loadURL(rendererUrl('index.html'))
  mainWindow.on('move', () => { if (!connection.pageVisible) { studioBounds = mainWindow!.getBounds(); chatHostWindow?.setBounds(studioBounds) } })
  mainWindow.on('resize', () => { if (!connection.pageVisible) { studioBounds = mainWindow!.getBounds(); chatHostWindow?.setBounds(studioBounds) } })
  mainWindow.on('minimize', () => chatHostWindow?.hide()); mainWindow.on('restore', applyWindowMode); mainWindow.on('closed', () => { chatHostWindow?.destroy(); overlayWindow?.close() })
}

function createOverlayWindow(): void {
  const bounds = subtitleBounds(screen.getPrimaryDisplay().workArea, undefined, subtitleHeight(subtitle.fontSize, subtitle.maxLines))
  overlayWindow = new BrowserWindow({ ...bounds, transparent: true, frame: false, alwaysOnTop: true, resizable: false, minWidth: 420, minHeight: 150, skipTaskbar: true, hasShadow: false, webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false } })
  overlayWindow.setAlwaysOnTop(true, 'pop-up-menu'); overlayWindow.loadURL(rendererUrl('overlay.html')); overlayWindow.hide(); overlayWindow.on('moved', persistOverlayBounds); overlayWindow.on('resized', persistOverlayBounds)
}

function persistOverlayBounds(): void { if (!overlayWindow || subtitle.locked || !subtitle.visible) return; subtitle = { ...subtitle, bounds: overlayWindow.getBounds() }; broadcast('subtitle:settings', subtitle) }
function setOverlayInteractive(_interactive: boolean): void { overlayWindow?.setIgnoreMouseEvents(false) }
function showOverlay(): SubtitlePreferences { if (!overlayWindow) return subtitle; const current = overlayWindow.getBounds(); const bounds = subtitleBounds(screen.getPrimaryDisplay().workArea, current.width, Math.max(current.height, subtitleHeight(subtitle.fontSize, subtitle.maxLines))); overlayWindow.setBounds(bounds); subtitle = { ...subtitle, visible: true, bounds }; overlayWindow.show(); overlayWindow.moveTop(); mainWindow?.focus(); broadcast('subtitle:settings', subtitle); return subtitle }

function handleEvent(event: Omit<TranscriptEvent, 'id' | 'sessionId'>): void {
  if (!activeSession) return
  const next: TranscriptEvent = { ...event, id: randomUUID(), sessionId: activeSession.id }
  events = mergeTranscriptEvent(events, next); store.upsertEvent(next); broadcast('transcript:event', next)
}

function buildPrompt(topic: string, level: string): string { return `${PROMPTS[topic] ?? PROMPTS['自由闲聊']}\n\nMy CEFR level is ${level}. Use vocabulary, grammar, and sentence length appropriate for this level. Speak clearly and use short turns.` }
function beginSession(strength: CorrectionStrength): PracticeSession { events = []; activeSession = store.createSession(strength); return activeSession }

function beginWebAdapter(source: Extract<PracticeSource, 'chatgpt-web' | 'gemini-web'>): void {
  if (!chatHostWindow) throw new Error('The web practice window is not ready.')
  const unsupported = () => announceAutomation({ phase: 'failed', message: `${source === 'gemini-web' ? 'Gemini' : 'ChatGPT'} page text cannot be read. Open the connection page and check the signed-in page.`, recoverable: true })
  adapter = source === 'gemini-web' ? new GeminiAdapter(chatHostWindow.webContents, handleEvent, unsupported) : new ChatGPTAdapter(chatHostWindow.webContents, handleEvent, unsupported)
  adapter.start()
}

async function cleanPreviousChatGPT(): Promise<boolean> {
  const marker = chatMarker.read(); if (!marker) return true
  if (!chatgptAutomation) return false
  announceAutomation({ phase: 'filling-prompt', message: 'Cleaning the previous SpeakSub ChatGPT practice…' })
  const result = await chatgptAutomation.deleteConversation(marker.conversationUrl).catch((error) => ({ ok: false, message: error instanceof Error ? error.message : 'ChatGPT cleanup failed.' }))
  if (!result.ok) { announceAutomation({ phase: 'failed', message: `${result.message} The recorded chat was kept for retry.`, recoverable: true }); notify('SpeakSub cleanup needs attention', result.message); return false }
  chatMarker.clear(); await chatHostWindow?.loadURL(CHATGPT_URL); notify('SpeakSub cleaned the previous chat', 'Only the recorded ChatGPT practice was deleted.'); return true
}

async function cleanPreviousGemini(): Promise<boolean> {
  const marker = geminiMarker.read(); if (!marker) return true
  if (!geminiAutomation) return false
  announceAutomation({ phase: 'filling-prompt', message: 'Cleaning the previous SpeakSub Gemini practice…' })
  const result = await geminiAutomation.deleteConversation(marker.conversationUrl).catch((error) => ({ ok: false, message: error instanceof Error ? error.message : 'Gemini cleanup failed.' }))
  if (!result.ok) { announceAutomation({ phase: 'failed', message: `${result.message} The recorded chat was kept for retry.`, recoverable: true }); notify('SpeakSub cleanup needs attention', result.message); return false }
  geminiMarker.clear(); await chatHostWindow?.loadURL(GEMINI_URL); notify('SpeakSub cleaned the previous chat', 'Only the recorded Gemini practice was deleted.'); return true
}

async function prepareWebPractice(source: Extract<PracticeSource, 'chatgpt-web' | 'gemini-web'>, topic: string, level: string, strength: CorrectionStrength) {
  if (!connection.ready) throw new Error(`Please sign in to ${source === 'gemini-web' ? 'Gemini' : 'ChatGPT'} on the connection page first.`)
  const automation = source === 'gemini-web' ? geminiAutomation : chatgptAutomation
  if (!automation) throw new Error('The web practice window is not ready.')
  if (!(await (source === 'gemini-web' ? cleanPreviousGemini() : cleanPreviousChatGPT()))) throw new Error('The previous SpeakSub chat still needs cleanup. Open the connection page and retry.')
  announceAutomation({ phase: 'filling-prompt', message: `Creating a new ${source === 'gemini-web' ? 'Gemini' : 'ChatGPT'} practice…` })
  const newChat = await automation.startNewChat(); if (!newChat.ok) throw new Error(newChat.message)
  const sent = await automation.fillAndSendPrompt(buildPrompt(topic, level)); if (!sent.ok) { announceAutomation({ phase: 'failed', message: sent.message, recoverable: true }); throw new Error(sent.message) }
  const capture = await automation.captureConversationUrl()
  if (capture.ok && capture.conversationUrl) (source === 'gemini-web' ? geminiMarker : chatMarker).write(capture.conversationUrl)
  const session = beginSession(strength); beginWebAdapter(source)
  announceAutomation({ phase: 'waiting-for-reply', message: `Prompt sent. Waiting for ${source === 'gemini-web' ? 'Gemini' : 'ChatGPT'}…` })
  if (source === 'gemini-web') { announceAutomation({ phase: 'idle', message: capture.ok ? 'Gemini practice is ready.' : `Gemini practice is ready. ${capture.message}` }); return { session, voiceStarted: false, source, warning: capture.ok ? undefined : capture.message } }
  const voice = await chatgptAutomation!.waitForReplyAndStartVoice()
  if (!voice.ok) { announceAutomation({ phase: 'failed', message: voice.message, recoverable: true }); return { session, voiceStarted: false, source, warning: voice.message } }
  announceAutomation({ phase: 'voice-started', message: voice.message }); return { session, voiceStarted: true, source }
}

function setConnection(next: Partial<ConnectionState>, persist = false): ConnectionState { connection = { ...connection, ...next }; if (persist) persistConnectionReady(); applyWindowMode(); announceConnection(); return connection }

function installIpc(): void {
  ipcMain.handle('app:state', () => state())
  ipcMain.handle('connection:complete', () => setConnection({ ready: true, pageVisible: false }, true))
  ipcMain.handle('connection:show', async (_event, source: Extract<PracticeSource, 'chatgpt-web' | 'gemini-web'> = 'chatgpt-web') => { activeSource = source; await chatHostWindow?.loadURL(sourceUrl(source)); return setConnection({ pageVisible: true }) })
  ipcMain.handle('connection:hide', () => setConnection({ pageVisible: false }))
  ipcMain.handle('practice:start', async (_event, topic: string, level: string, strength: CorrectionStrength, source: PracticeSource = 'chatgpt-web') => {
    if (activeSession) return { session: activeSession, voiceStarted: automationStatus.phase === 'voice-started', source: activeSource }
    activeSource = source; activeTopic = topic; activeLevel = level
    if (source === 'api-direct') { const session = beginSession(strength); announceAutomation({ phase: 'idle', message: 'API direct practice is ready. Type a message to begin.' }); return { session, voiceStarted: false, source } }
    return prepareWebPractice(source, topic, level, strength)
  })
  ipcMain.handle('api:sendMessage', async (_event, message: string) => {
    if (!activeSession || activeSource !== 'api-direct') throw new Error('Start an API direct practice first.')
    const text = message.trim(); if (!text) return
    handleEvent({ sourceMessageId: `api-user-${randomUUID()}`, speaker: 'user', text, status: 'complete', receivedAt: new Date().toISOString() })
    announceAutomation({ phase: 'waiting-for-reply', message: 'Waiting for the API response…' })
    try { const reply = await learning.chat(events, activeTopic, activeLevel); handleEvent({ sourceMessageId: `api-assistant-${randomUUID()}`, speaker: 'assistant', text: reply, status: 'complete', receivedAt: new Date().toISOString() }); announceAutomation({ phase: 'idle', message: 'API reply received. Continue when ready.' }) }
    catch (error) { const message = error instanceof Error ? error.message : 'API request failed.'; announceAutomation({ phase: 'failed', message, recoverable: true }); throw error }
  })
  ipcMain.handle('practice:end', async () => {
    if (!activeSession) throw new Error('There is no active practice.')
    let voiceStopped = activeSource !== 'chatgpt-web'; let voiceWarning: string | undefined
    if (activeSource === 'chatgpt-web') { announceAutomation({ phase: 'stopping-voice', message: 'Ending ChatGPT voice…' }); const result = await chatgptAutomation?.stopVoice().catch(() => undefined); voiceStopped = result?.ok === true; voiceWarning = voiceStopped ? undefined : result?.message ?? 'Could not end ChatGPT voice automatically.' }
    adapter?.stop(); adapter = undefined
    const ended = store.endSession(activeSession); activeSession = undefined
    announceAutomation({ phase: voiceStopped ? 'idle' : 'failed', message: voiceStopped ? 'Practice ended.' : voiceWarning!, recoverable: !voiceStopped })
    try { const review = await learning.review(events, ended.correctionStrength); store.saveReview(ended.id, review); return { session: ended, review, voiceStopped, voiceWarning } }
    catch (error) { return { session: ended, error: error instanceof Error ? error.message : 'Review generation failed.', voiceStopped, voiceWarning } }
  })
  ipcMain.handle('subtitle:update', (_event, input: Partial<SubtitlePreferences>) => { subtitle = { ...subtitle, ...input }; if (overlayWindow) { setOverlayInteractive(!subtitle.locked); if (!subtitle.visible) overlayWindow.hide() }; broadcast('subtitle:settings', subtitle); return subtitle })
  ipcMain.handle('subtitle:toggle', () => { if (subtitle.visible) { subtitle = { ...subtitle, visible: false }; overlayWindow?.hide(); broadcast('subtitle:settings', subtitle); return subtitle }; return showOverlay() })
  ipcMain.handle('subtitle:interactive', (_event, interactive: boolean) => setOverlayInteractive(interactive))
  ipcMain.handle('subtitle:resize', (_event, direction: ResizeDirection, origin, deltaX: number, deltaY: number) => { if (!overlayWindow || subtitle.locked) return subtitle; const bounds = resizeBounds(origin, direction, deltaX, deltaY, undefined, subtitleHeight(subtitle.fontSize, subtitle.maxLines)); overlayWindow.setBounds(bounds); subtitle = { ...subtitle, bounds }; broadcast('subtitle:settings', subtitle); return subtitle })
  ipcMain.handle('learning:lookup', (_event, selection: string, sentence?: string) => learning.lookup(selection, sentence))
  ipcMain.handle('study:save', (_event, item) => store.saveStudyItem(item)); ipcMain.handle('study:list', () => store.listStudyItems()); ipcMain.handle('providers:get', () => settings.get()); ipcMain.handle('providers:save', (_event, input) => settings.save(input)); ipcMain.handle('data:clear', () => { store.clear(); settings.clear(); events = [] })
}

app.whenReady().then(() => {
  const workArea = screen.getPrimaryDisplay().workArea; studioBounds = { x: Math.round(workArea.x + (workArea.width - Math.min(1320, workArea.width)) / 2), y: Math.round(workArea.y + (workArea.height - Math.min(860, workArea.height)) / 2), width: Math.min(1320, workArea.width), height: Math.min(860, workArea.height) }
  const userData = app.getPath('userData'); connectionStatePath = join(userData, 'connection-state.json'); connection = { ready: readConnectionReady(), pageVisible: !readConnectionReady() }
  store = new SpeakSubStore(join(userData, 'learning-archive')); settings = new SecureSettings(join(userData, 'provider-settings.json')); chatMarker = new ChatGPTMarkerStore(join(userData, 'last-speaksub-chat.json')); geminiMarker = new GeminiMarkerStore(join(userData, 'last-speaksub-gemini-chat.json')); learning = new LearningService(settings, join(app.getAppPath(), 'resources', 'dictionaries', 'ecdict-en-zh'))
  createChatHostWindow(); createMainWindow(); createOverlayWindow(); installIpc(); applyWindowMode()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createChatHostWindow(); createMainWindow(); createOverlayWindow(); applyWindowMode() } })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
