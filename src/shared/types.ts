export type Speaker = 'assistant' | 'user'
type TranscriptStatus = 'streaming' | 'complete'
export type SubtitleMode = 'assistant' | 'user' | 'both'
type SubtitleBackground = 'transparent' | 'glass' | 'solid'
export type CorrectionStrength = 'light' | 'normal' | 'strict'
export type PromptTemplateCategory = 'scenario' | 'difficulty' | 'correction'
export type PracticeSource = 'chatgpt-web' | 'api-direct'
export type PracticeMode = 'text' | 'voice'
export type PracticeLifecycle = 'idle' | 'starting' | 'active' | 'ending' | 'error'
export type WebPracticeSource = Extract<PracticeSource, 'chatgpt-web'>
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1'
export type VocabularyFamiliarity = 'unfamiliar' | 'learning' | 'mastered'
export type VocabularyReviewRating = 'again' | 'hard' | 'good' | 'easy'
export type LearningPeriod = 'week' | 'month'
type SessionArchiveStatus = 'completed' | 'interrupted'
type ErrorCategory = 'grammar' | 'word-choice' | 'tense' | 'articles' | 'prepositions' | 'fluency' | 'coherence' | 'interaction' | 'other'

export interface TranscriptEvent {
  id: string
  sessionId: string
  sourceMessageId: string
  speaker: Speaker
  text: string
  status: TranscriptStatus
  receivedAt: string
  interrupted?: boolean
}

export interface PracticeSession {
  id: string
  startedAt: string
  endedAt?: string
  correctionStrength: CorrectionStrength
  topic?: string
  level?: CefrLevel
  source?: PracticeSource
  mode?: PracticeMode
  focus?: string
}

interface PracticeSessionProfile {
  topic: string
  level: CefrLevel
  correctionStrength: CorrectionStrength
  source: PracticeSource
  mode: PracticeMode
  focus?: string
  prompt?: string
}

export interface PracticeProfile extends PracticeSessionProfile {}

interface PromptTemplate { id: string; name: string; prompt: string }
export interface PromptTemplates { scenario: PromptTemplate[]; difficulty: PromptTemplate[]; correction: PromptTemplate[] }

export interface PracticePreferences {
  source: PracticeSource
  mode: PracticeMode
  scenarioTemplateId: string
  difficultyTemplateId: string
  correctionTemplateId: string
  focus: string
  focusEnabled: boolean
}

export interface ConnectionState {
  ready: boolean
  pageVisible: boolean
  activeProvider: WebPracticeSource
  providers: Record<WebPracticeSource, boolean>
}

type AutomationPhase = 'idle' | 'filling-prompt' | 'prompt-sent' | 'waiting-for-reply' | 'starting-voice' | 'voice-started' | 'stopping-voice' | 'failed'

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

interface ReviewIssue {
  original: string
  improved: string
  reason: string
}

interface PracticeAssessment {
  estimatedCefr: CefrLevel
  scores: { accuracy: number; vocabulary: number; fluency: number; interaction: number }
  errorCategories: Array<{ category: ErrorCategory; count: number }>
  weakPoints: string[]
}

export interface ReviewResult {
  topic: string
  summary: string
  issues: ReviewIssue[]
  vocabulary: Array<{ term: string; meaning: string; example?: string }>
  nextPractice: string
  assessment?: PracticeAssessment
}

export interface SessionArchiveSummary {
  id: string
  status: SessionArchiveStatus
  startedAt: string
  endedAt?: string
  durationSeconds: number
  topic: string
  level?: CefrLevel
  source?: PracticeSource
  mode?: PracticeMode
  correctionStrength: CorrectionStrength
  summary?: string
  estimatedCefr?: CefrLevel
  favoriteWords: string[]
  hasReview: boolean
}

export interface SessionArchiveDetail extends SessionArchiveSummary {
  transcript: Array<{ speaker: Speaker; text: string; receivedAt?: string; interrupted?: boolean }>
  review?: ReviewResult
  focus?: string
}

export interface HistorySearchQuery {
  text?: string
  source?: PracticeSource
  mode?: PracticeMode
  level?: CefrLevel
  status?: SessionArchiveStatus
  dateFrom?: string
  dateTo?: string
}

export interface VocabularyItem {
  id: string
  normalizedTerm: string
  term: string
  meaning?: string
  example?: string
  familiarity: VocabularyFamiliarity
  firstSavedAt: string
  lastSavedAt: string
  lastReviewedAt?: string
  nextReviewAt: string
  occurrenceCount: number
  sessionIds: string[]
}

export interface LearningDashboard {
  period: LearningPeriod
  from: string
  to: string
  sessionCount: number
  totalMinutes: number
  practiceDays: number
  streakDays: number
  newVocabulary: number
  masteredVocabulary: number
  dueVocabulary: number
  averageScores?: PracticeAssessment['scores']
  cefrTrend: Array<{ date: string; level: CefrLevel }>
  topErrors: Array<{ category: ErrorCategory; count: number }>
  activity: Array<{ date: string; sessions: number; minutes: number }>
}

export interface NextPracticeDraft extends PracticeSessionProfile {
  derivedFromSessionId: string
}

export interface ProviderSettings {
  llmBaseUrl?: string
  llmModel?: string
  hasLlmKey: boolean
  hasAliyunAsrKey?: boolean
}

export interface ProviderSettingsInput {
  llmBaseUrl?: string
  llmModel?: string
  llmApiKey?: string
  clearLlmApiKey?: boolean
  aliyunAsrApiKey?: string
  clearAliyunAsrApiKey?: boolean
}

interface ProviderModelProbeInput {
  llmBaseUrl: string
  llmApiKey?: string
}

export interface MicrophoneGateState {
  active: boolean
  available: boolean
  shortcut: string
}

type SpeechAssetStatus = 'missing' | 'downloading' | 'ready' | 'error'
export type VoiceTurnPhase = 'idle' | 'listening' | 'thinking' | 'synthesizing' | 'speaking'

export interface SpeechAssetProgress {
  status: SpeechAssetStatus
  downloadedBytes: number
  totalBytes: number
  progress: number
  error?: string
}

export interface SpeechAssetState {
  vad: SpeechAssetProgress
  tts: SpeechAssetProgress
}

export interface SpeechUsageState {
  provider: 'aliyun-fun-asr'
  sessionSeconds: number
  month: string
  monthlySeconds: number
  estimatedCny: number
}

export interface VoiceAudioChunk {
  sampleRate: 16000
  format: 'float32'
  samples: ArrayBuffer
}

export interface VoiceCaptureStatus {
  echoCancellation: boolean
}

export interface GeneratedSpeechChunk {
  id: string
  messageId: string
  index: number
  generation: number
  sampleRate: 24000
  format: 'float32'
  samples: ArrayBuffer
  final: boolean
}

export interface UpdateReleaseInfo {
  tagName: string
  name: string
  publishedAt: string
  notes: string
  htmlUrl: string
}

export interface UpdateAssetInfo {
  name: string
  size: number
}

export interface AvailableUpdateInfo {
  configured: boolean
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  message?: string
  release?: UpdateReleaseInfo
  asset?: UpdateAssetInfo
}

export interface UpdateDownloadProgress {
  status: 'connecting' | 'downloading' | 'verifying' | 'ready' | 'failed'
  channel: string
  received: number
  total: number
  percent?: number
  message?: string
}

export interface UpdateInstallResult {
  ok: boolean
  error?: string
  releaseUrl?: string
}

export interface SpeakSubApi {
  startPractice: (topic: string, level: string, strength: CorrectionStrength, source: PracticeSource, mode: PracticeMode, focus?: string, prompt?: string) => Promise<PracticeStartResult>
  getPromptTemplates: () => Promise<PromptTemplates>
  savePromptTemplates: (templates: PromptTemplates) => Promise<PromptTemplates>
  getPracticePreferences: () => Promise<PracticePreferences>
  savePracticePreferences: (preferences: PracticePreferences) => Promise<PracticePreferences>
  sendPracticeMessage: (message: string) => Promise<void>
  sendApiMessage: (message: string) => Promise<void>
  startVoiceCapture: () => Promise<void>
  stopVoiceCapture: () => Promise<void>
  reportVoiceCaptureStatus: (status: VoiceCaptureStatus) => Promise<void>
  sendVoiceAudio: (chunk: VoiceAudioChunk) => Promise<void>
  notifyVoicePlaybackEnded: (chunkId: string) => Promise<void>
  getSpeechAssetState: () => Promise<SpeechAssetState>
  downloadSpeechAssets: () => Promise<SpeechAssetState>
  endPractice: () => Promise<PracticeEndResult>
  cancelPracticeStart: () => Promise<void>
  getState: () => Promise<{ session?: PracticeSession; settings: SubtitlePreferences; events: TranscriptEvent[]; connection: ConnectionState; automation: AutomationStatus; source: PracticeSource; mode: PracticeMode; lifecycle: PracticeLifecycle; microphone: MicrophoneGateState; speechAssets: SpeechAssetState; speechUsage: SpeechUsageState; voicePhase: VoiceTurnPhase }>
  completeConnection: () => Promise<ConnectionState>
  showConnectionPage: () => Promise<ConnectionState>
  clearPendingCleanup: () => Promise<void>
  hideConnectionPage: () => Promise<ConnectionState>
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  updateSubtitle: (settings: Partial<SubtitlePreferences>) => Promise<SubtitlePreferences>
  toggleOverlay: () => Promise<SubtitlePreferences>
  setOverlayInteractive: (interactive: boolean) => Promise<void>
  moveOverlay: (origin: { x: number; y: number; width: number; height: number }, deltaX: number, deltaY: number) => Promise<SubtitlePreferences>
  resizeOverlay: (direction: import('../main/window-layout').ResizeDirection, origin: { x: number; y: number; width: number; height: number }, deltaX: number, deltaY: number) => Promise<SubtitlePreferences>
  lookup: (selection: string, sentence?: string) => Promise<DictionaryResult>
  saveSessionFavorite: (word: string) => Promise<void>
  searchSessions: (query?: HistorySearchQuery) => Promise<SessionArchiveSummary[]>
  getSessionDetail: (id: string) => Promise<SessionArchiveDetail>
  deleteSession: (id: string) => Promise<void>
  listVocabulary: (filter?: { familiarity?: VocabularyFamiliarity; dueOnly?: boolean; text?: string }) => Promise<VocabularyItem[]>
  updateVocabularyFamiliarity: (id: string, familiarity: VocabularyFamiliarity) => Promise<VocabularyItem>
  reviewVocabulary: (id: string, rating: VocabularyReviewRating) => Promise<VocabularyItem>
  getReviewQueue: () => Promise<VocabularyItem[]>
  getLearningDashboard: (period: LearningPeriod) => Promise<LearningDashboard>
  createNextPracticeDraft: (sessionId: string) => Promise<NextPracticeDraft>
  getArchiveDirectory: () => Promise<string>
  chooseArchiveDirectory: () => Promise<string | undefined>
  getProviderSettings: () => Promise<ProviderSettings>
  saveProviderSettings: (settings: ProviderSettingsInput) => Promise<ProviderSettings>
  discoverProviderModels: (input: ProviderModelProbeInput) => Promise<string[]>
  saveMicrophoneShortcut: (shortcut: string) => Promise<string>
  toggleMicrophoneGate: () => Promise<MicrophoneGateState>
  setMicrophoneGate: (active: boolean) => Promise<MicrophoneGateState>
  clearAllData: () => Promise<void>
  checkForUpdates: () => Promise<AvailableUpdateInfo>
  downloadAndInstallUpdate: () => Promise<UpdateInstallResult>
  openUpdateRelease: () => Promise<UpdateInstallResult>
  onTranscript: (listener: (event: TranscriptEvent) => void) => () => void
  onSubtitleSettings: (listener: (settings: SubtitlePreferences) => void) => () => void
  onAutomationStatus: (listener: (status: AutomationStatus) => void) => () => void
  onPracticeEnded: (listener: (result: PracticeEndResult) => void) => () => void
  onConnectionState: (listener: (state: ConnectionState) => void) => () => void
  onVoiceAudio: (listener: (chunk: GeneratedSpeechChunk) => void) => () => void
  onSpeechAssetState: (listener: (state: SpeechAssetState) => void) => () => void
  onSpeechUsage: (listener: (state: SpeechUsageState) => void) => () => void
  onVoicePhase: (listener: (phase: VoiceTurnPhase) => void) => () => void
  onVoiceInterrupt: (listener: (generation: number) => void) => () => void
  onMicrophoneGateState: (listener: (state: MicrophoneGateState) => void) => () => void
  onUpdateProgress: (listener: (progress: UpdateDownloadProgress) => void) => () => void
}

declare global {
  interface Window { speaksub: SpeakSubApi }
}
