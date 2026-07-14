export type Speaker = 'assistant' | 'user'
export type TranscriptStatus = 'streaming' | 'complete'
export type SubtitleMode = 'assistant' | 'user' | 'both'
export type SubtitleLayout = 'same-side' | 'split'
export type SubtitleBackground = 'transparent' | 'glass' | 'solid'
export type CorrectionStrength = 'light' | 'normal' | 'strict'
export type PracticeSource = 'chatgpt-web' | 'gemini-web' | 'api-direct'
export type PracticeMode = 'text' | 'voice'
export type PracticeLifecycle = 'idle' | 'starting' | 'active' | 'ending' | 'error'
export type RealtimeProtocolProfile = 'current' | 'legacy'
export type WebPracticeSource = Extract<PracticeSource, 'chatgpt-web' | 'gemini-web'>

export interface TranscriptEvent {
  id: string
  sessionId: string
  sourceMessageId: string
  speaker: Speaker
  text: string
  status: TranscriptStatus
  receivedAt: string
}

export interface PracticeSession {
  id: string
  startedAt: string
  endedAt?: string
  correctionStrength: CorrectionStrength
}

export interface PracticeProfile {
  topic: string
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1'
  correctionStrength: CorrectionStrength
  source: PracticeSource
  mode: PracticeMode
}

export interface SessionArchiveItem {
  session: PracticeSession
  transcript: TranscriptEvent[]
  review?: ReviewResult
}

export interface ConnectionState {
  ready: boolean
  pageVisible: boolean
  activeProvider: WebPracticeSource
  providers: Record<WebPracticeSource, boolean>
}

export type AutomationPhase = 'idle' | 'filling-prompt' | 'prompt-sent' | 'waiting-for-reply' | 'starting-voice' | 'voice-started' | 'stopping-voice' | 'failed'

export interface AutomationStatus {
  phase: AutomationPhase
  message: string
  recoverable?: boolean
}

export interface PracticeStartResult {
  session: PracticeSession
  voiceStarted: boolean
  source: PracticeSource
  mode: PracticeMode
  warning?: string
}

export interface PracticeEndResult {
  session: PracticeSession
  review?: ReviewResult
  error?: string
  voiceStopped: boolean
  voiceWarning?: string
}

export interface SubtitlePreferences {
  mode: SubtitleMode
  layout: SubtitleLayout
  background: SubtitleBackground
  backgroundColor: string
  backgroundOpacity: number
  assistantColor: string
  userColor: string
  fontSize: number
  opacity: number
  locked: boolean
  visible: boolean
  maxLines: number
  bounds?: { x: number; y: number; width: number; height: number }
}

export interface DictionaryResult {
  query: string
  phonetic?: string
  definitions: string[]
  contextualMeaning?: string
  naturalAlternative?: string
}

export interface ReviewIssue {
  original: string
  improved: string
  reason: string
}

export interface ReviewResult {
  topic: string
  summary: string
  issues: ReviewIssue[]
  vocabulary: Array<{ term: string; meaning: string }>
  nextPractice: string
}

export interface SavedStudyItem {
  id: string
  kind: 'word' | 'sentence'
  sourceText: string
  note?: string
  createdAt: string
}

export interface ProviderSettings {
  llmBaseUrl?: string
  llmModel?: string
  hasLlmKey: boolean
  realtimeEnabled?: boolean
  realtimeModel?: string
  realtimeProtocol?: RealtimeProtocolProfile
}

export interface ProviderSettingsInput {
  llmBaseUrl?: string
  llmModel?: string
  llmApiKey?: string
  realtimeEnabled?: boolean
  realtimeModel?: string
  realtimeProtocol?: RealtimeProtocolProfile
  clearLlmApiKey?: boolean
}

export interface SpeakSubApi {
  startPractice: (topic: string, level: string, strength: CorrectionStrength, source: PracticeSource, mode: PracticeMode) => Promise<PracticeStartResult>
  sendApiMessage: (message: string) => Promise<void>
  startVoiceCapture: () => Promise<void>
  stopVoiceCapture: () => Promise<void>
  sendVoiceAudio: (pcm16: ArrayBuffer) => Promise<void>
  endPractice: () => Promise<PracticeEndResult>
  cancelPracticeStart: () => Promise<void>
  getState: () => Promise<{ session?: PracticeSession; settings: SubtitlePreferences; events: TranscriptEvent[]; connection: ConnectionState; automation: AutomationStatus; source: PracticeSource; mode: PracticeMode; lifecycle: PracticeLifecycle }>
  completeConnection: () => Promise<ConnectionState>
  showConnectionPage: (source?: Extract<PracticeSource, 'chatgpt-web' | 'gemini-web'>) => Promise<ConnectionState>
  clearPendingCleanup: (source: Extract<PracticeSource, 'chatgpt-web' | 'gemini-web'>) => Promise<void>
  hideConnectionPage: () => Promise<ConnectionState>
  updateSubtitle: (settings: Partial<SubtitlePreferences>) => Promise<SubtitlePreferences>
  toggleOverlay: () => Promise<SubtitlePreferences>
  setOverlayInteractive: (interactive: boolean) => Promise<void>
  resizeOverlay: (direction: import('../main/window-layout').ResizeDirection, origin: { x: number; y: number; width: number; height: number }, deltaX: number, deltaY: number) => Promise<SubtitlePreferences>
  lookup: (selection: string, sentence?: string) => Promise<DictionaryResult>
  saveStudyItem: (item: Omit<SavedStudyItem, 'id' | 'createdAt'>) => Promise<SavedStudyItem>
  listStudyItems: () => Promise<SavedStudyItem[]>
  deleteStudyItem: (id: string) => Promise<void>
  listSessions: () => Promise<SessionArchiveItem[]>
  getProviderSettings: () => Promise<ProviderSettings>
  saveProviderSettings: (settings: ProviderSettingsInput) => Promise<ProviderSettings>
  clearAllData: () => Promise<void>
  onTranscript: (listener: (event: TranscriptEvent) => void) => () => void
  onSubtitleSettings: (listener: (settings: SubtitlePreferences) => void) => () => void
  onAutomationStatus: (listener: (status: AutomationStatus) => void) => () => void
  onConnectionState: (listener: (state: ConnectionState) => void) => () => void
  onVoiceAudio: (listener: (pcm16: ArrayBuffer) => void) => () => void
  onVoiceInterrupt: (listener: () => void) => () => void
}

declare global {
  interface Window { speaksub: SpeakSubApi }
}
