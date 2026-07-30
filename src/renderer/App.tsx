import { useEffect, useMemo, useRef, useState } from 'react'
import type { AutomationStatus, AvailableUpdateInfo, ConnectionState, CorrectionStrength, MicrophoneGateState, MimoTtsVoice, NextPracticeDraft, PracticeLifecycle, PracticeMode, PracticePreferences, PracticeSource, PromptTemplateCategory, PromptTemplates, ProviderSettings, ProviderSettingsInput, ReviewResult, SpeechAssetInstallInfo, SpeechAssetState, SpeechSynthesisProvider, SpeechUsageState, SubtitlePreferences, TranscriptEvent, UpdateDownloadProgress, VoiceTurnPhase } from '../shared/types'
import { defaultSubtitlePreferences } from '../shared/defaults'
import { LocalSpeechAudioCapture, LocalSpeechAudioPlayer, microphoneSignalLevel, microphoneSignalThreshold, playMicrophoneToggleTone } from './local-speech-audio'
import { isPracticeTransitionBusy, templateSelectionForDraft } from './app-state'
import { LearningCenter } from './LearningCenter'
import { shortcutFromKeyboardEvent } from '../main/microphone-shortcut'
import { ALIYUN_HELP_LINKS, MIMO_HELP_LINKS, SPEECH_MODEL_DOWNLOAD_LINKS } from '../shared/help-links'
import { buildChatGptWebPrompt, buildDirectChatSystemPrompt, defaultDirectChatSystemPrompt } from '../shared/direct-chat-prompt'
import { useAppUpdates } from './use-app-updates'

const brandIcon = new URL('./assets/app-icon-transparent.png', import.meta.url).href
const supportPaymentCode = new URL('./assets/support-payment-code.jpg', import.meta.url).href
const mimoVoiceGroups: Array<{ label: string; voices: Array<{ id: MimoTtsVoice; description: string }> }> = [
  { label: '英文音色', voices: [{ id: 'Mia', description: '自然女声' }, { id: 'Chloe', description: '明亮女声' }, { id: 'Milo', description: '自然男声' }, { id: 'Dean', description: '沉稳男声' }] },
  { label: '中文音色', voices: [{ id: '冰糖', description: '清甜女声' }, { id: '茉莉', description: '温柔女声' }, { id: '苏打', description: '清朗男声' }, { id: '白桦', description: '沉稳男声' }] }
]

function WindowControls() {
  return <div className="window-controls" aria-label="窗口控制">
    <button className="window-control minimize" type="button" aria-label="最小化" onClick={() => void window.speaksub.minimizeWindow()}/>
    <button className="window-control maximize" type="button" aria-label="最大化或还原" onClick={() => void window.speaksub.toggleMaximizeWindow()}/>
    <button className="window-control close" type="button" aria-label="关闭窗口" onClick={() => void window.speaksub.closeWindow()}/>
  </div>
}

const sourceLabels: Record<PracticeSource, string> = { 'chatgpt-web': 'ChatGPT 网页', 'api-direct': 'API 直连' }
const defaultMicrophone: MicrophoneGateState = { active: false, available: false, shortcut: 'F8' }
const defaultSpeechAssets: SpeechAssetState = {
  vad: { status: 'missing', downloadedBytes: 0, totalBytes: 0, progress: 0 },
  tts: { status: 'missing', downloadedBytes: 0, totalBytes: 0, progress: 0 }
}
const defaultSpeechUsage: SpeechUsageState = { provider: 'aliyun-fun-asr', sessionSeconds: 0, month: '', monthlySeconds: 0, estimatedCny: 0 }
type ProviderCheckState = 'idle' | 'checking' | 'success' | 'error'
type TtsPreferenceSaveState = 'idle' | 'saving' | 'saved' | 'error'
const microphoneTestDurationMs = 4_000

function remainingBytes(asset: SpeechAssetState[keyof SpeechAssetState]): number {
  return asset.status === 'ready' ? 0 : Math.max(0, asset.totalBytes - asset.downloadedBytes)
}

function speechDownloadAction(assets: SpeechAssetState, includeTts: boolean, retry = false): string {
  const vadRemaining = remainingBytes(assets.vad)
  const ttsRemaining = includeTts ? remainingBytes(assets.tts) : 0
  const megabytes = Math.max(1, Math.round((vadRemaining + ttsRemaining) / 1_000_000))
  const label = includeTts ? 'VAD 与 Kokoro' : 'VAD'
  return `${retry ? '重试下载' : '下载'}${label}（约 ${megabytes} MB）`
}

function speechAssetStatus(asset: SpeechAssetState[keyof SpeechAssetState]): string {
  if (asset.status === 'downloading') return `${Math.round(asset.progress * 100)}%`
  if (asset.status === 'ready') return '已就绪'
  if (asset.status === 'error') return '下载失败'
  return asset.downloadedBytes > 0 ? `需补全 · 已有 ${Math.round(asset.progress * 100)}%` : '未下载'
}

function SpeechInstallHelp({ info, onOpenDirectory }: { info?: SpeechAssetInstallInfo; onOpenDirectory: () => void }) {
  return <section className="speech-install-help" aria-labelledby="speech-install-help-title">
    <div>
      <strong id="speech-install-help-title">下载与安装说明</strong>
      <small>优先点击上方下载按钮，SpeakHub 会自动完成下载、校验和安装。以下内容仅用于自动安装持续失败时。</small>
    </div>
    <div className="speech-install-location">
      <span>模型安装目录</span>
      <output title={info?.root}>{info?.root ?? '正在读取安装目录…'}</output>
      <button className="quiet-action" type="button" disabled={!info} onClick={onOpenDirectory}>打开模型文件夹</button>
    </div>
    <div className="speech-install-links">
      <a className="quiet-action" href={SPEECH_MODEL_DOWNLOAD_LINKS.vad} target="_blank" rel="noreferrer">下载 Silero VAD ↗</a>
      <a className="quiet-action" href={SPEECH_MODEL_DOWNLOAD_LINKS.kokoro} target="_blank" rel="noreferrer">下载 Kokoro ↗</a>
    </div>
    <ol>
      <li>VAD 下载后放到 <code title={info?.vadFile}>{info?.vadFile ?? 'speech-models\\silero-vad\\silero_vad.onnx'}</code>。</li>
      <li>Kokoro 压缩包放到上面的模型安装目录，再点击“下载/重试”，SpeakHub 会自动校验并解压。</li>
      <li>若已自行解压，请将完整文件夹放到 <code title={info?.ttsDirectory}>{info?.ttsDirectory ?? 'speech-models\\kokoro-int8-multi-lang-v1_1'}</code>，不要出现双层同名目录。</li>
    </ol>
  </section>
}

function UpdatePromptDialog({
  update,
  status,
  downloading,
  progress,
  showReleaseFallback,
  onDownload,
  onOpenRelease,
  onRemindLater,
  onSkipVersion
}: {
  update: AvailableUpdateInfo
  status: string
  downloading: boolean
  progress?: UpdateDownloadProgress
  showReleaseFallback: boolean
  onDownload: () => void
  onOpenRelease: () => void
  onRemindLater: () => void
  onSkipVersion: () => void
}) {
  const publishedAt = update.release?.publishedAt
    ? new Date(update.release.publishedAt).toLocaleString()
    : ''
  return <div className="confirm-layer update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
    <div>
      <header className="update-dialog-header">
        <div><p className="kicker">APPLICATION UPDATE</p><h2 id="update-dialog-title">SpeakHub 有新版本</h2><p>当前 {update.currentVersion} → 最新 {update.latestVersion}</p></div>
        <button className="template-editor-close" type="button" aria-label="稍后提醒" title="稍后提醒" disabled={downloading} onClick={onRemindLater}>×</button>
      </header>
      <section className="update-release-summary">
        <strong>{update.release?.name || `SpeakHub v${update.latestVersion}`}</strong>
        {publishedAt && <small>发布于 {publishedAt}</small>}
      </section>
      <section className="update-notes">
        <strong>本次更新内容</strong>
        <div>{update.release?.notes?.trim() || '此版本未填写更新说明。'}</div>
      </section>
      {(status || progress) && <section className="update-progress" aria-live="polite">
        <span>{status}</span>
        {progress?.total ? <progress max={progress.total} value={progress.received}/> : null}
      </section>}
      <footer>
        <button className="quiet-action" type="button" disabled={downloading} onClick={onSkipVersion}>跳过此版本</button>
        <button className="quiet-action" type="button" disabled={downloading} onClick={onRemindLater}>稍后提醒</button>
        {showReleaseFallback && <button className="quiet-action" type="button" onClick={onOpenRelease}>打开 GitHub Release</button>}
        <button className="primary-action" type="button" disabled={downloading || !update.asset} onClick={onDownload}>{downloading ? '正在下载…' : '立即更新'}</button>
      </footer>
    </div>
  </div>
}

export function App() {
  const [settings, setSettings] = useState<SubtitlePreferences>(defaultSubtitlePreferences)
  const [connection, setConnection] = useState<ConnectionState>({ ready: false, pageVisible: true, activeProvider: 'chatgpt-web', providers: { 'chatgpt-web': false } })
  const [connectionLoginBusy, setConnectionLoginBusy] = useState(false)
  const [automation, setAutomation] = useState<AutomationStatus>({ phase: 'idle', message: '正在准备练习。' })
  const [session, setSession] = useState<string>()
  const [events, setEvents] = useState<TranscriptEvent[]>([])
  const [source, setSource] = useState<PracticeSource>('chatgpt-web')
  const [mode, setMode] = useState<PracticeMode>('voice')
  const [focus, setFocus] = useState('')
  const [focusEnabled, setFocusEnabled] = useState(false)
  const [templates, setTemplates] = useState<PromptTemplates>()
  const [selectedTemplates, setSelectedTemplates] = useState({ scenario: '', difficulty: '', correction: '' })
  const [templateEditor, setTemplateEditor] = useState<PromptTemplateCategory>()
  const [templateDraft, setTemplateDraft] = useState<PromptTemplates>()
  const [systemPromptEditorOpen, setSystemPromptEditorOpen] = useState(false)
  const [systemPromptDraft, setSystemPromptDraft] = useState('')
  const [apiMessage, setApiMessage] = useState('')
  const [apiBusy, setApiBusy] = useState(false)
  const [tab, setTab] = useState<'practice' | 'learning' | 'settings'>('practice')
  const [review, setReview] = useState<ReviewResult>()
  const [providers, setProviders] = useState<ProviderSettings>()
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [modelProbeState, setModelProbeState] = useState<'idle' | 'probing' | 'error'>('idle')
  const [modelProbeMessage, setModelProbeMessage] = useState('')
  const [llmCheckState, setLlmCheckState] = useState<ProviderCheckState>('idle')
  const [llmCheckMessage, setLlmCheckMessage] = useState('')
  const [aliyunCheckState, setAliyunCheckState] = useState<ProviderCheckState>('idle')
  const [aliyunCheckMessage, setAliyunCheckMessage] = useState('')
  const [ttsProvider, setTtsProvider] = useState<SpeechSynthesisProvider>('mimo')
  const [mimoVoice, setMimoVoice] = useState<MimoTtsVoice>('Mia')
  const [ttsPreferenceSave, setTtsPreferenceSave] = useState<{ state: TtsPreferenceSaveState; message: string }>({ state: 'idle', message: '' })
  const [mimoPreview, setMimoPreview] = useState<{ state: ProviderCheckState | 'playing'; voice?: MimoTtsVoice; message: string }>({ state: 'idle', message: '' })
  const [microphoneTestState, setMicrophoneTestState] = useState<ProviderCheckState>('idle')
  const [microphoneTestMessage, setMicrophoneTestMessage] = useState('')
  const [microphoneTestLevel, setMicrophoneTestLevel] = useState(0)
  const [lifecycle, setLifecycle] = useState<PracticeLifecycle>('idle')
  const [archiveDirectory, setArchiveDirectory] = useState('')
  const [microphone, setMicrophone] = useState<MicrophoneGateState>(defaultMicrophone)
  const [shortcutDraft, setShortcutDraft] = useState(defaultMicrophone.shortcut)
  const [shortcutError, setShortcutError] = useState<string>()
  const [speechAssets, setSpeechAssets] = useState<SpeechAssetState>(defaultSpeechAssets)
  const [speechInstallInfo, setSpeechInstallInfo] = useState<SpeechAssetInstallInfo>()
  const [speechUsage, setSpeechUsage] = useState<SpeechUsageState>(defaultSpeechUsage)
  const [aliyunHelpOpen, setAliyunHelpOpen] = useState(false)
  const [mimoHelpOpen, setMimoHelpOpen] = useState(false)
  const [kokoroRemovalOpen, setKokoroRemovalOpen] = useState(false)
  const [kokoroRemovalBusy, setKokoroRemovalBusy] = useState(false)
  const [kokoroRemovalError, setKokoroRemovalError] = useState('')
  const [communitySupportOpen, setCommunitySupportOpen] = useState(false)
  const [groupCopyStatus, setGroupCopyStatus] = useState('')
  const [voicePhase, setVoicePhase] = useState<VoiceTurnPhase>('idle')
  const [appVersion, setAppVersion] = useState('')
  const updates = useAppUpdates()
  const capture = useRef(new LocalSpeechAudioCapture())
  const microphoneTestCapture = useRef<LocalSpeechAudioCapture | undefined>(undefined)
  const player = useRef(new LocalSpeechAudioPlayer())
  const previewPlayer = useRef(new LocalSpeechAudioPlayer())
  const previousMicrophoneActive = useRef(false)
  const llmCheckVersion = useRef(0)
  const aliyunCheckVersion = useRef(0)
  const mimoPreviewVersion = useRef(0)
  const ttsPreferenceSaveVersion = useRef(0)
  const ttsPreferenceSaveQueue = useRef<Promise<void>>(Promise.resolve())
  const persistedTtsProvider = useRef<SpeechSynthesisProvider>('mimo')
  const persistedMimoVoice = useRef<MimoTtsVoice>('Mia')
  const microphoneTestVersion = useRef(0)
  const microphoneTestPeak = useRef(0)
  const microphoneTestTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    void Promise.all([window.speaksub.getState(), window.speaksub.getProviderSettings(), window.speaksub.getArchiveDirectory(), window.speaksub.getPromptTemplates(), window.speaksub.getPracticePreferences(), window.speaksub.getAppVersion(), window.speaksub.getSpeechAssetInstallInfo()]).then(([state, provider, directory, promptTemplates, preferences, version, installInfo]) => {
      const selected = {
        scenario: promptTemplates.scenario.some((item) => item.id === preferences.scenarioTemplateId) ? preferences.scenarioTemplateId : promptTemplates.scenario[0].id,
        difficulty: promptTemplates.difficulty.some((item) => item.id === preferences.difficultyTemplateId) ? preferences.difficultyTemplateId : promptTemplates.difficulty[0].id,
        correction: promptTemplates.correction.some((item) => item.id === preferences.correctionTemplateId) ? preferences.correctionTemplateId : promptTemplates.correction[1]?.id ?? promptTemplates.correction[0].id
      }
      const savedTtsProvider = provider.ttsProvider ?? 'mimo'
      const savedMimoVoice = provider.mimoTtsVoice ?? 'Mia'
      persistedTtsProvider.current = savedTtsProvider
      persistedMimoVoice.current = savedMimoVoice
      setSettings(state.settings); setConnection(state.connection); setAutomation(state.automation); setSession(state.session?.id); setEvents(state.events); setProviders(provider); setTtsProvider(savedTtsProvider); setMimoVoice(savedMimoVoice); setSource(preferences.source); setMode(preferences.mode); setLifecycle(state.lifecycle); setArchiveDirectory(directory); setMicrophone(state.microphone); setShortcutDraft(state.microphone.shortcut); setSpeechAssets(state.speechAssets); setSpeechInstallInfo(installInfo); setSpeechUsage(state.speechUsage); setVoicePhase(state.voicePhase); setTemplates(promptTemplates); setSelectedTemplates(selected); setFocus(preferences.focus); setFocusEnabled(preferences.focusEnabled); setAppVersion(version)
    })
    const removeTranscript = window.speaksub.onTranscript((event) => setEvents((current) => {
      const index = current.findIndex((item) => item.sourceMessageId === event.sourceMessageId)
      if (index === -1) return [...current, event]
      const next = [...current]; next[index] = { ...next[index], ...event, id: next[index].id }; return next
    }))
    const removeSettings = window.speaksub.onSubtitleSettings(setSettings)
    const removeAutomation = window.speaksub.onAutomationStatus(setAutomation)
    const removePracticeEnded = window.speaksub.onPracticeEnded((result) => {
      capture.current.stop(); player.current.stop(); setSession(undefined); setReview(result.review); setLifecycle('idle')
      if (result.error) setAutomation({ phase: 'failed', message: result.error, recoverable: true })
      else if (result.voiceWarning) setAutomation({ phase: 'failed', message: result.voiceWarning, recoverable: true })
    })
    const removeConnection = window.speaksub.onConnectionState(setConnection)
    const removeVoiceAudio = window.speaksub.onVoiceAudio((chunk) => player.current.play(chunk, () => void window.speaksub.notifyVoicePlaybackEnded(chunk.id)))
    const removeVoiceInterrupt = window.speaksub.onVoiceInterrupt((generation) => player.current.interrupt(generation))
    const removeSpeechAssets = window.speaksub.onSpeechAssetState(setSpeechAssets)
    const removeSpeechUsage = window.speaksub.onSpeechUsage(setSpeechUsage)
    const removeVoicePhase = window.speaksub.onVoicePhase(setVoicePhase)
    const removeMicrophone = window.speaksub.onMicrophoneGateState((next) => {
      if (next.available && next.active !== previousMicrophoneActive.current) playMicrophoneToggleTone(next.active)
      previousMicrophoneActive.current = next.active
      setMicrophone(next); setShortcutDraft(next.shortcut)
    })
    return () => { capture.current.stop(); microphoneTestCapture.current?.stop(); if (microphoneTestTimer.current !== undefined) window.clearTimeout(microphoneTestTimer.current); player.current.stop(); mimoPreviewVersion.current += 1; previewPlayer.current.stop(); void window.speaksub.cancelMimoTtsPreview(); removeTranscript(); removeSettings(); removeAutomation(); removePracticeEnded(); removeConnection(); removeVoiceAudio(); removeVoiceInterrupt(); removeSpeechAssets(); removeSpeechUsage(); removeVoicePhase(); removeMicrophone() }
  }, [])

  const latestAssistantEvent = useMemo(() => [...events].reverse().find((event) => event.speaker === 'assistant'), [events])
  const latestAssistant = latestAssistantEvent?.text ?? ''
  const latestUser = useMemo(() => [...events].reverse().find((event) => event.speaker === 'user')?.text ?? '', [events])
  const updateSubtitle = (input: Partial<SubtitlePreferences>) => void window.speaksub.updateSubtitle(input)
  const isWebSource = source !== 'api-direct'
  const transitionBusy = isPracticeTransitionBusy(lifecycle)
  const apiConfigured = Boolean(providers?.llmBaseUrl?.trim() && providers.llmModel?.trim() && providers.hasLlmKey)
  const recognitionConfigured = Boolean(providers?.hasAliyunAsrKey)
  const usesLocalTts = ttsProvider === 'kokoro'
  const requiredAssets: Array<keyof SpeechAssetState> = usesLocalTts ? ['vad', 'tts'] : ['vad']
  const speechModelsReady = requiredAssets.every((asset) => speechAssets[asset].status === 'ready')
  const speechModelsDownloading = requiredAssets.some((asset) => speechAssets[asset].status === 'downloading')
  const speechDownloadButton = speechDownloadAction(speechAssets, usesLocalTts, requiredAssets.some((asset) => speechAssets[asset].status === 'error'))
  const speechRemainingBytes = requiredAssets.reduce((sum, asset) => sum + remainingBytes(speechAssets[asset]), 0)
  const speechRemainingMegabytes = speechRemainingBytes > 0 ? Math.max(1, Math.round(speechRemainingBytes / 1_000_000)) : 0
  const apiVoiceSummary = ttsProvider === 'mimo'
    ? `文本 API + 阿里双语识别 + MiMo ${mimoVoice} 朗读；音色可在设置中切换`
    : '文本 API + 阿里双语识别 + Kokoro 朗读；可在设置中改用 MiMo 音色'
  function savePracticePreferences(next: Partial<PracticePreferences> = {}): void {
    const preferences: PracticePreferences = {
      source, mode, scenarioTemplateId: selectedTemplates.scenario, difficultyTemplateId: selectedTemplates.difficulty, correctionTemplateId: selectedTemplates.correction, focus, focusEnabled,
      ...next
    }
    void window.speaksub.savePracticePreferences(preferences).catch((error) => setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法保存练习配置。', recoverable: true }))
  }

  useEffect(() => {
    if (!session || source !== 'api-direct' || mode !== 'voice' || lifecycle !== 'active') { capture.current.stop(); return }
    if (!microphone.active) { capture.current.stop(); void window.speaksub.stopVoiceCapture(); return }
    let disposed = false
    void (async () => {
      try {
        await window.speaksub.startVoiceCapture()
        const status = await capture.current.start((chunk) => void window.speaksub.sendVoiceAudio(chunk))
        if (!disposed) await window.speaksub.reportVoiceCaptureStatus(status)
      } catch (error) {
        if (disposed) return
        capture.current.stop(); void window.speaksub.setMicrophoneGate(false)
        setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法开启本地麦克风。', recoverable: true })
      }
    })()
    return () => { disposed = true }
  }, [session, source, mode, lifecycle, microphone.active])

  async function enterPractice(): Promise<void> { try { setConnection(await window.speaksub.completeConnection()) } catch (error) { setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法确认登录状态。', recoverable: true }) } }
  async function startBrowserWebLogin(): Promise<void> {
    setConnectionLoginBusy(true)
    setAutomation({ phase: 'idle', message: '请在刚打开的 Chrome 或 Edge 中完成 ChatGPT 的 Google 登录；成功后窗口会自动关闭。' })
    try {
      const next = await window.speaksub.importWebConnectionLogin()
      setConnection(next)
      setAutomation({
        phase: 'idle',
        message: next.ready
          ? 'Google 登录已传回 SpeakHub 并保存；以后重新认证会记住这个账号。'
          : '登录会话已传回 SpeakHub；请等待右侧 ChatGPT 加载完成后检查状态。'
      })
    } catch (error) {
      setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法把 ChatGPT 登录传回 SpeakHub。', recoverable: true })
    } finally {
      setConnectionLoginBusy(false)
    }
  }
  async function openConnection(): Promise<void> { if (source === 'api-direct') return; await window.speaksub.showConnectionPage() }
  async function skipWebConnection(): Promise<void> {
    setSource('api-direct')
    setMode('voice')
    setConnection(await window.speaksub.hideConnectionPage())
    requireApiVoiceSetup('api-direct', 'voice')
  }
  async function clearPendingCleanup(): Promise<void> { if (source === 'api-direct') return; await window.speaksub.clearPendingCleanup(); setAutomation({ phase: 'idle', message: '已清除上一条练习记录；现在可以重新开始。' }) }
  async function copyCommunityGroupNumber(): Promise<void> {
    try {
      await window.speaksub.copyCommunityGroupNumber()
      setGroupCopyStatus('QQ群号已复制，可直接到 QQ 搜索加入。')
      window.setTimeout(() => setGroupCopyStatus(''), 3_000)
    } catch {
      setGroupCopyStatus('复制失败，请手动搜索群号 1091142340。')
    }
  }
  function requireApiVoiceSetup(nextSource: PracticeSource, nextMode: PracticeMode): boolean {
    if (nextSource !== 'api-direct') return true
    if (!apiConfigured) {
      setTab('settings')
      setAutomation({ phase: 'failed', message: '请先在设置中填写文本 API 的 Base URL、模型名和 API Key。', recoverable: true })
      return false
    }
    if (nextMode === 'voice' && !recognitionConfigured) {
      setTab('settings')
      setAutomation({ phase: 'failed', message: '已选择阿里云识别，请先填写 DashScope API Key。', recoverable: true })
      return false
    }
    if (nextMode === 'voice' && ttsProvider === 'mimo' && !providers?.hasMimoTtsKey) {
      setTab('settings')
      setAutomation({ phase: 'failed', message: '已选择云端 MiMo 朗读，请先填写 Xiaomi MiMo API Key。', recoverable: true })
      return false
    }
    if (nextMode === 'voice' && !speechModelsReady) {
      setTab('settings')
      setAutomation({ phase: 'failed', message: `语音工作流还缺少本地辅助组件。请${speechDownloadAction(speechAssets, usesLocalTts)}。`, recoverable: true })
      return false
    }
    return true
  }
  function selectSource(next: PracticeSource): void {
    setSource(next)
    savePracticePreferences({ source: next })
    requireApiVoiceSetup(next, mode)
  }
  function selectMode(next: PracticeMode): void {
    setMode(next)
    savePracticePreferences({ mode: next })
    requireApiVoiceSetup(source, next)
  }
  async function startPractice(): Promise<void> {
    if (lifecycle === 'starting' || lifecycle === 'ending') return
    if (!requireApiVoiceSetup(source, mode)) return
    setLifecycle('starting')
    try {
      setAutomation({ phase: 'filling-prompt', message: source === 'api-direct' ? '正在创建 API 直连练习…' : `正在启动 ${sourceLabels[source]} 练习…` })
      const scenario = templates?.scenario.find((item) => item.id === selectedTemplates.scenario)
      const difficulty = templates?.difficulty.find((item) => item.id === selectedTemplates.difficulty)
      const correction = templates?.correction.find((item) => item.id === selectedTemplates.correction)
      const selectedPrompt = [scenario?.prompt, difficulty?.prompt, correction?.prompt].filter(Boolean).join('\n\n')
      if (!scenario || !difficulty || !correction || !selectedPrompt) throw new Error('请先为场景、难度和纠错各选择一个提示词。')
      const prompt = source === 'chatgpt-web'
        ? buildChatGptWebPrompt(scenario.name, difficulty.name, selectedPrompt)
        : selectedPrompt
      const correctionStrength: CorrectionStrength = ['light', 'normal', 'strict'].includes(correction.id) ? correction.id as CorrectionStrength : 'normal'
      const cefrLevel = ['A1', 'A2', 'B1', 'B2', 'C1'].includes(difficulty.name) ? difficulty.name : 'B1'
      const result = await window.speaksub.startPractice(scenario.name, cefrLevel, correctionStrength, source, mode, focusEnabled ? focus || undefined : undefined, prompt, source === 'api-direct' ? templates?.systemPrompt : undefined)
      setSession(result.session.id); setEvents([]); setReview(undefined); setLifecycle('active')
      if (result.warning) setAutomation({ phase: 'failed', message: result.warning, recoverable: true })
    } catch (error) { capture.current.stop(); player.current.stop(); await window.speaksub.cancelPracticeStart().catch(() => undefined); setSession(undefined); setLifecycle('error'); setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法开始练习。', recoverable: true }) }
  }
  async function sendApiMessage(): Promise<void> {
    if (!apiMessage.trim() || apiBusy) return
    const outgoing = apiMessage; setApiMessage(''); setApiBusy(true)
    try { await window.speaksub.sendApiMessage(outgoing) } catch (error) { setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : 'API 请求失败。', recoverable: true }) } finally { setApiBusy(false) }
  }
  async function endPractice(): Promise<void> { if (lifecycle === 'ending') return; setLifecycle('ending'); capture.current.stop(); player.current.stop(); await window.speaksub.stopVoiceCapture(); try { const result = await window.speaksub.endPractice(); setSession(undefined); setReview(result.review); setLifecycle('idle'); if (result.error) setAutomation({ phase: 'failed', message: result.error, recoverable: true }); else if (result.voiceWarning) setAutomation({ phase: 'failed', message: result.voiceWarning, recoverable: true }) } catch (error) { setLifecycle('error'); setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法结束练习。', recoverable: true }) } }
  async function toggleMicrophone(): Promise<void> { try { await window.speaksub.toggleMicrophoneGate() } catch (error) { setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法切换麦克风。', recoverable: true }) } }
  function clearMicrophoneTestTimer(): void {
    if (microphoneTestTimer.current !== undefined) window.clearTimeout(microphoneTestTimer.current)
    microphoneTestTimer.current = undefined
  }
  function cancelMicrophoneTest(): void {
    microphoneTestVersion.current += 1
    clearMicrophoneTestTimer()
    microphoneTestCapture.current?.stop()
    microphoneTestCapture.current = undefined
    setMicrophoneTestState('idle'); setMicrophoneTestMessage(''); setMicrophoneTestLevel(0)
  }
  function finishMicrophoneTest(version: number, testCapture: LocalSpeechAudioCapture): void {
    if (version !== microphoneTestVersion.current) return
    clearMicrophoneTestTimer()
    testCapture.stop()
    if (microphoneTestCapture.current === testCapture) microphoneTestCapture.current = undefined
    if (microphoneTestPeak.current >= microphoneSignalThreshold) {
      setMicrophoneTestState('success'); setMicrophoneTestMessage('麦克风正常，已检测到声音。')
    } else {
      setMicrophoneTestState('error'); setMicrophoneTestMessage('已获得麦克风权限，但没有检测到声音。请对着麦克风说话，并检查系统输入设备。')
    }
  }
  function microphoneTestError(error: unknown): string {
    if (error instanceof Error && error.name === 'NotAllowedError') return '麦克风权限被拒绝，请在 Windows 隐私设置中允许 SpeakHub 使用麦克风。'
    if (error instanceof Error && error.name === 'NotFoundError') return '没有找到可用麦克风，请连接或启用输入设备后重试。'
    if (error instanceof Error && error.name === 'NotReadableError') return '麦克风暂时无法读取，可能正被其他应用独占。'
    return error instanceof Error ? `无法检测麦克风：${error.message}` : '无法检测麦克风。'
  }
  async function testMicrophone(): Promise<void> {
    const version = ++microphoneTestVersion.current
    clearMicrophoneTestTimer()
    microphoneTestCapture.current?.stop()
    const testCapture = new LocalSpeechAudioCapture()
    microphoneTestCapture.current = testCapture
    microphoneTestPeak.current = 0
    setMicrophoneTestLevel(0); setMicrophoneTestState('checking'); setMicrophoneTestMessage('正在监听，请对着麦克风说一句话…')
    try {
      await testCapture.start((chunk) => {
        if (version !== microphoneTestVersion.current) return
        const level = microphoneSignalLevel(new Float32Array(chunk.samples))
        microphoneTestPeak.current = Math.max(microphoneTestPeak.current, level)
        setMicrophoneTestLevel(Math.min(1, level / (microphoneSignalThreshold * 4)))
      })
      if (version !== microphoneTestVersion.current) { testCapture.stop(); return }
      microphoneTestTimer.current = window.setTimeout(() => finishMicrophoneTest(version, testCapture), microphoneTestDurationMs)
    } catch (error) {
      if (version !== microphoneTestVersion.current) { testCapture.stop(); return }
      clearMicrophoneTestTimer(); testCapture.stop()
      if (microphoneTestCapture.current === testCapture) microphoneTestCapture.current = undefined
      setMicrophoneTestState('error'); setMicrophoneTestMessage(microphoneTestError(error)); setMicrophoneTestLevel(0)
    }
  }
  async function recordMicrophoneShortcut(event: React.KeyboardEvent<HTMLInputElement>): Promise<void> {
    event.preventDefault()
    const shortcut = shortcutFromKeyboardEvent(event.nativeEvent)
    if (!shortcut) { setShortcutError('请按 F1–F24，或带 Ctrl、Alt、Shift 的字母/数字组合。'); return }
    try { const saved = await window.speaksub.saveMicrophoneShortcut(shortcut); setShortcutDraft(saved); setShortcutError(undefined) }
    catch (error) { setShortcutError(error instanceof Error ? error.message : '该快捷键不可用。') }
  }
  async function saveProviders(form: HTMLFormElement): Promise<void> {
    try {
      const data = new FormData(form)
      const saved = await window.speaksub.saveProviderSettings({
      llmBaseUrl: String(data.get('llmBaseUrl') || ''),
      llmModel: String(data.get('llmModel') || ''),
      llmApiKey: String(data.get('llmApiKey') || ''),
      clearLlmApiKey: data.get('clearLlmApiKey') === 'on',
      aliyunAsrApiKey: String(data.get('aliyunAsrApiKey') || ''),
      clearAliyunAsrApiKey: data.get('clearAliyunAsrApiKey') === 'on',
      ttsProvider: String(data.get('ttsProvider') || 'mimo') as ProviderSettings['ttsProvider'],
      mimoTtsVoice: String(data.get('mimoTtsVoice') || 'Mia') as MimoTtsVoice,
      mimoTtsApiKey: String(data.get('mimoTtsApiKey') || ''),
      clearMimoTtsApiKey: data.get('clearMimoTtsApiKey') === 'on'
    })
      const savedTtsProvider = saved.ttsProvider ?? 'mimo'
      const savedMimoVoice = saved.mimoTtsVoice ?? 'Mia'
      persistedTtsProvider.current = savedTtsProvider
      persistedMimoVoice.current = savedMimoVoice
      setProviders(saved); setTtsProvider(savedTtsProvider); setMimoVoice(savedMimoVoice); setTtsPreferenceSave({ state: 'idle', message: '' })
      resetLlmCheck(); resetAliyunCheck()
      const configured = Boolean(saved.llmBaseUrl?.trim() && saved.llmModel?.trim() && saved.hasLlmKey)
      const savedUsesLocalTts = saved.ttsProvider !== 'mimo'
      const savedAssetsReady = (savedUsesLocalTts ? ['vad', 'tts'] as const : ['vad'] as const).every((asset) => speechAssets[asset].status === 'ready')
      if (configured && !saved.hasAliyunAsrKey) setAutomation({ phase: 'failed', message: '文本 API 已配置；请继续填写阿里云 DashScope API Key。', recoverable: true })
      else if (configured && saved.ttsProvider === 'mimo' && !saved.hasMimoTtsKey) setAutomation({ phase: 'failed', message: '已选择云端 MiMo 朗读；请继续填写 Xiaomi MiMo API Key。', recoverable: true })
      else if (configured && source === 'api-direct' && mode === 'voice' && !savedAssetsReady) setAutomation({ phase: 'failed', message: `API 已配置。继续${speechDownloadAction(speechAssets, savedUsesLocalTts)}。`, recoverable: true })
      else setAutomation({ phase: 'idle', message: configured ? '对话、识别与朗读设置已保存。' : 'API 设置已保存，但信息尚未填写完整。' })
    } catch (error) {
      setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法保存 API 设置。', recoverable: true })
    }
  }
  async function probeProviderModels(form: HTMLFormElement): Promise<void> {
    const values = new FormData(form); const baseUrl = String(values.get('llmBaseUrl') ?? ''); const apiKey = String(values.get('llmApiKey') ?? '')
    setModelProbeState('probing'); setModelProbeMessage('正在探测可用模型…'); setDiscoveredModels([])
    try { const models = await window.speaksub.discoverProviderModels({ llmBaseUrl: baseUrl, llmApiKey: apiKey || undefined }); setDiscoveredModels(models); setModelProbeState('idle'); setModelProbeMessage(`找到 ${models.length} 个模型，点击即可填入。`) }
    catch (error) { setModelProbeState('error'); setModelProbeMessage(error instanceof Error ? error.message : '模型探测失败。') }
  }
  function providerCheckError(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message : fallback
    return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
  }
  function resetLlmCheck(): void {
    llmCheckVersion.current += 1
    setLlmCheckState('idle'); setLlmCheckMessage('')
  }
  function resetAliyunCheck(): void {
    aliyunCheckVersion.current += 1
    setAliyunCheckState('idle'); setAliyunCheckMessage('')
  }
  function cancelMimoPreview(): void {
    mimoPreviewVersion.current += 1
    previewPlayer.current.stop()
    setMimoPreview({ state: 'idle', message: '' })
    void window.speaksub.cancelMimoTtsPreview()
  }
  function autoSaveTtsPreference(input: Pick<ProviderSettingsInput, 'ttsProvider' | 'mimoTtsVoice'>): Promise<void> {
    const version = ++ttsPreferenceSaveVersion.current
    setTtsPreferenceSave({ state: 'saving', message: '正在自动保存…' })
    const operation = ttsPreferenceSaveQueue.current.then(async () => {
      const saved = await window.speaksub.saveProviderSettings(input)
      persistedTtsProvider.current = saved.ttsProvider ?? 'mimo'
      persistedMimoVoice.current = saved.mimoTtsVoice ?? 'Mia'
      if (version !== ttsPreferenceSaveVersion.current) return
      setTtsProvider(persistedTtsProvider.current)
      setMimoVoice(persistedMimoVoice.current)
      setTtsPreferenceSave({ state: 'saved', message: '已自动保存' })
    }).catch((error) => {
      if (version !== ttsPreferenceSaveVersion.current) return
      setTtsProvider(persistedTtsProvider.current)
      setMimoVoice(persistedMimoVoice.current)
      setTtsPreferenceSave({ state: 'error', message: providerCheckError(error, '自动保存失败，请重试。') })
    })
    ttsPreferenceSaveQueue.current = operation
    return operation
  }
  function changeTtsProvider(next: SpeechSynthesisProvider): void {
    setTtsProvider(next)
    void autoSaveTtsPreference({ ttsProvider: next })
  }
  async function previewMimoVoice(voice: MimoTtsVoice, form: HTMLFormElement): Promise<void> {
    const keyInput = form.elements.namedItem('mimoTtsApiKey')
    const apiKey = keyInput instanceof HTMLInputElement ? keyInput.value : ''
    const version = ++mimoPreviewVersion.current
    setMimoVoice(voice)
    void autoSaveTtsPreference({ mimoTtsVoice: voice })
    previewPlayer.current.stop()
    setMimoPreview({ state: 'checking', voice, message: `正在生成 ${voice} 的试听声音…` })
    try {
      const audio = await window.speaksub.previewMimoTtsVoice({ voice, mimoTtsApiKey: apiKey || undefined })
      if (version !== mimoPreviewVersion.current) return
      setMimoPreview({ state: 'playing', voice, message: `正在播放 ${voice}…` })
      previewPlayer.current.play({
        id: `mimo-preview-${version}`,
        messageId: 'mimo-preview',
        index: 0,
        generation: version,
        sampleRate: audio.sampleRate,
        format: 'float32',
        samples: audio.samples,
        final: true
      }, () => {
        if (version === mimoPreviewVersion.current) setMimoPreview({ state: 'success', voice, message: `${voice} 试听完成。` })
      })
    } catch (error) {
      if (version !== mimoPreviewVersion.current) return
      setMimoPreview({ state: 'error', voice, message: providerCheckError(error, 'MiMo 音色试听失败。') })
    }
  }
  async function testLlmConnection(form: HTMLFormElement): Promise<void> {
    const values = new FormData(form)
    const version = ++llmCheckVersion.current
    setLlmCheckState('checking'); setLlmCheckMessage('正在发送一条极小的测试消息…')
    try {
      const result = await window.speaksub.checkLlmConnection({
        llmBaseUrl: String(values.get('llmBaseUrl') ?? ''),
        llmModel: String(values.get('llmModel') ?? ''),
        llmApiKey: String(values.get('llmApiKey') ?? '') || undefined
      })
      if (version !== llmCheckVersion.current) return
      setLlmCheckState('success'); setLlmCheckMessage(result.message)
    } catch (error) {
      if (version !== llmCheckVersion.current) return
      setLlmCheckState('error'); setLlmCheckMessage(providerCheckError(error, '大模型检测失败。'))
    }
  }
  async function testAliyunConnection(form: HTMLFormElement): Promise<void> {
    const values = new FormData(form)
    const version = ++aliyunCheckVersion.current
    setAliyunCheckState('checking'); setAliyunCheckMessage('正在连接阿里 Fun-ASR…')
    try {
      const result = await window.speaksub.checkAliyunConnection({
        aliyunAsrApiKey: String(values.get('aliyunAsrApiKey') ?? '') || undefined
      })
      if (version !== aliyunCheckVersion.current) return
      setAliyunCheckState('success'); setAliyunCheckMessage(result.message)
    } catch (error) {
      if (version !== aliyunCheckVersion.current) return
      setAliyunCheckState('error'); setAliyunCheckMessage(providerCheckError(error, '阿里识别检测失败。'))
    }
  }
  async function downloadSpeechModels(): Promise<void> {
    try {
      setSpeechAssets(await window.speaksub.downloadSpeechAssets(usesLocalTts))
      setAutomation({ phase: 'idle', message: usesLocalTts ? 'VAD 与 Kokoro 已下载完成。' : 'VAD 已下载完成，可以搭配 MiMo 云端朗读。' })
    } catch (error) {
      setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '模型下载失败。', recoverable: true })
    }
  }
  async function openSpeechAssetDirectory(): Promise<void> {
    try {
      await window.speaksub.openSpeechAssetDirectory()
    } catch (error) {
      setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法打开模型文件夹。', recoverable: true })
    }
  }
  async function removeKokoroModel(): Promise<void> {
    setKokoroRemovalBusy(true)
    setKokoroRemovalError('')
    try {
      const next = await window.speaksub.removeKokoroModel()
      setSpeechAssets(next)
      setKokoroRemovalOpen(false)
      setAutomation({ phase: 'idle', message: 'Kokoro 本地模型已删除；VAD 与 MiMo 设置保持不变。' })
    } catch (error) {
      setKokoroRemovalError(providerCheckError(error, '无法删除 Kokoro 模型。'))
    } finally {
      setKokoroRemovalBusy(false)
    }
  }
  async function chooseArchiveDirectory(): Promise<void> { try { const directory = await window.speaksub.chooseArchiveDirectory(); if (!directory) return; setArchiveDirectory(directory) } catch (error) { setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法切换归档文件夹。', recoverable: true }) } }
  function useNextPracticeDraft(draft: NextPracticeDraft): void {
    const nextFocus = draft.focus ?? ''
    const nextFocusEnabled = Boolean(draft.focus)
    const mapped = templates ? templateSelectionForDraft(draft, templates) : {}
    const nextSelection = {
      scenario: mapped.scenario ?? selectedTemplates.scenario,
      difficulty: mapped.difficulty ?? selectedTemplates.difficulty,
      correction: mapped.correction ?? selectedTemplates.correction
    }
    setSelectedTemplates(nextSelection)
    setSource(draft.source)
    setMode(draft.mode)
    setFocus(nextFocus)
    setFocusEnabled(nextFocusEnabled)
    savePracticePreferences({
      source: draft.source,
      mode: draft.mode,
      scenarioTemplateId: nextSelection.scenario,
      difficultyTemplateId: nextSelection.difficulty,
      correctionTemplateId: nextSelection.correction,
      focus: nextFocus,
      focusEnabled: nextFocusEnabled
    })
    setTab('practice')
    setAutomation({ phase: 'idle', message: '已根据上次薄弱点准备好练习，请确认后开始。' })
  }
  const selected = (category: PromptTemplateCategory) => templates?.[category].find((item) => item.id === selectedTemplates[category])
  const composedPrompt = templates ? [selected('scenario')?.prompt, selected('difficulty')?.prompt, selected('correction')?.prompt].filter(Boolean).join('\n\n') : ''
  const selectedPromptWithFocus = `${composedPrompt}${focusEnabled && focus.trim() ? `\n\n本次重点：\n${focus.trim()}` : ''}`
  const promptPreview = source === 'api-direct'
    ? buildDirectChatSystemPrompt(selected('scenario')?.name ?? '日常聊天', selected('difficulty')?.name ?? 'B1', selectedPromptWithFocus, templates?.systemPrompt)
    : buildChatGptWebPrompt(selected('scenario')?.name ?? '日常聊天', selected('difficulty')?.name ?? 'B1', selectedPromptWithFocus)
  function openTemplateEditor(category: PromptTemplateCategory): void { if (!templates) return; setTemplateDraft(structuredClone(templates)); setTemplateEditor(category) }
  function closeTemplateEditor(): void { setTemplateEditor(undefined); setTemplateDraft(undefined) }
  async function saveTemplates(): Promise<void> {
    if (!templateDraft) return
    const saved = await window.speaksub.savePromptTemplates(templateDraft)
    const nextSelected = {
      scenario: saved.scenario.some((item) => item.id === selectedTemplates.scenario) ? selectedTemplates.scenario : saved.scenario[0].id,
      difficulty: saved.difficulty.some((item) => item.id === selectedTemplates.difficulty) ? selectedTemplates.difficulty : saved.difficulty[0].id,
      correction: saved.correction.some((item) => item.id === selectedTemplates.correction) ? selectedTemplates.correction : saved.correction[0].id
    }
    setTemplates(saved); setSelectedTemplates(nextSelected)
    savePracticePreferences({ scenarioTemplateId: nextSelected.scenario, difficultyTemplateId: nextSelected.difficulty, correctionTemplateId: nextSelected.correction })
    setTemplateEditor(undefined); setTemplateDraft(undefined)
  }
  function openSystemPromptEditor(): void {
    if (!templates) return
    setSystemPromptDraft(templates.systemPrompt)
    setSystemPromptEditorOpen(true)
  }
  async function saveSystemPrompt(): Promise<void> {
    if (!templates || !systemPromptDraft.trim()) return
    const saved = await window.speaksub.savePromptTemplates({ ...templates, systemPrompt: systemPromptDraft.trim() })
    setTemplates(saved)
    setSystemPromptEditorOpen(false)
  }
  function resetSystemPromptDraft(): void { setSystemPromptDraft(defaultDirectChatSystemPrompt) }

  const updateDialog = updates.showPrompt && updates.available
    ? <UpdatePromptDialog
        update={updates.available}
        status={updates.status}
        downloading={updates.downloading}
        progress={updates.progress}
        showReleaseFallback={updates.showReleaseFallback}
        onDownload={() => void updates.downloadAndInstall()}
        onOpenRelease={() => void updates.openRelease()}
        onRemindLater={updates.remindLater}
        onSkipVersion={updates.skipVersion}
      />
    : null

  const mimoHelpDialog = mimoHelpOpen
    ? <div className="confirm-layer aliyun-help-dialog mimo-help-dialog" role="dialog" aria-modal="true" aria-labelledby="mimo-help-title">
        <div>
          <header className="aliyun-help-header">
            <div>
              <p className="kicker">XIAOMI MIMO API</p>
              <h2 id="mimo-help-title">如何开通 MiMo 云端朗读</h2>
              <p>第一次配置照着下面四步做即可。</p>
            </div>
            <button className="template-editor-close" type="button" aria-label="关闭 MiMo API 帮助" title="关闭" onClick={() => setMimoHelpOpen(false)}>×</button>
          </header>
          <ol>
            <li><strong>登录 Xiaomi MiMo 开放平台</strong><span>使用小米账号登录；没有账号时可在开放平台按提示注册。</span></li>
            <li><strong>创建按量付费 API Key</strong><span>进入 API Keys 页面创建标准 Key，格式通常为 <code>sk-…</code>。SpeakHub 当前使用标准 API 地址，不要填写 Token Plan 的 <code>tp-…</code> Key。</span></li>
            <li><strong>立即复制并妥善保存</strong><span>不要把 Key 发给他人。复制后回到设置页，粘贴到 MiMo API Key 输入框。</span></li>
            <li><strong>选择音色并试听</strong><span>朗读方式选择“云端 Xiaomi MiMo V2.5 TTS”，点击任一音色按钮试听，确认后再点击“保存设置”。</span></li>
          </ol>
          <div className="aliyun-help-actions">
            <a className="primary-action" href={MIMO_HELP_LINKS.console} target="_blank" rel="noreferrer">打开 MiMo 开放平台 ↗</a>
            <a className="quiet-action" href={MIMO_HELP_LINKS.apiKeyGuide} target="_blank" rel="noreferrer">查看 Key 官方教程 ↗</a>
            <a className="quiet-action" href={MIMO_HELP_LINKS.ttsGuide} target="_blank" rel="noreferrer">查看 TTS 官方文档 ↗</a>
          </div>
          <p className="aliyun-help-note"><strong>费用提醒：</strong>音色试听和正式朗读都会真实调用 MiMo。免费额度、价格和有效期可能调整，请以开放平台显示为准。</p>
        </div>
      </div>
    : null

  const kokoroRemovalDialog = kokoroRemovalOpen
    ? <div className="confirm-layer kokoro-removal-dialog" role="dialog" aria-modal="true" aria-labelledby="kokoro-removal-title">
        <div>
          <h2 id="kokoro-removal-title">删除 Kokoro 本地模型？</h2>
          <p>将永久删除 SpeakHub 模型目录中的 Kokoro 文件和下载缓存，释放本地空间。Silero VAD、MiMo API Key、音色设置和练习记录不会受到影响。</p>
          <p>以后需要离线朗读时，可以重新下载 Kokoro。</p>
          {kokoroRemovalError && <small role="alert">{kokoroRemovalError}</small>}
          <footer>
            <button className="quiet-action" type="button" disabled={kokoroRemovalBusy} onClick={() => { setKokoroRemovalOpen(false); setKokoroRemovalError('') }}>取消</button>
            <button className="danger-action kokoro-removal-confirm" type="button" disabled={kokoroRemovalBusy} onClick={() => void removeKokoroModel()}>{kokoroRemovalBusy ? '正在删除…' : '确认删除'}</button>
          </footer>
        </div>
      </div>
    : null

  if (connection.pageVisible) return <><main className="connection-shell"><WindowControls/><section className="connection-panel">
    <div className="brand-lockup"><img className="brand-icon" src={brandIcon} alt="" /><span className="brand-copy"><strong>SpeakHub</strong><em>personal practice</em></span></div><p className="kicker">WEB MODEL CONNECTION</p>
    <h1>{connection.ready ? '连接页面已打开' : '先登录你的 ChatGPT'}</h1>
    <p>右侧页面用于登录和恢复网页模式。完成登录后回到 SpeakSub，选择难度并开始对话。</p>
    <p role="status" aria-live="polite">{automation.message}</p>
    <div className="connection-steps"><span>01 登录 ChatGPT</span><span>02 确认账号状态</span><span>03 进入练习台</span></div>
    <button className="primary-action" disabled={connectionLoginBusy} onClick={() => void startBrowserWebLogin()}>{connectionLoginBusy ? '等待浏览器登录…' : '使用 Google 登录 ChatGPT'}</button>
    {!connection.ready && <button className="quiet-action" onClick={() => void enterPractice()}>我已在右侧登录，检查状态</button>}
    <button className="quiet-action" onClick={() => void window.speaksub.hideConnectionPage()}>返回主界面</button><button className="quiet-action connection-skip" onClick={() => void skipWebConnection()}>先使用 API 直连</button>
  </section></main>{updateDialog}</>

  return <>{mimoHelpDialog}{kokoroRemovalDialog}<main className="studio-shell"><header className="studio-topbar">
    <div className="brand-lockup"><img className="brand-icon" src={brandIcon} alt="" /><span className="brand-copy"><strong>SpeakHub</strong><em>personal practice</em></span></div><span className="brand-credit">Made By Ajin</span>{appVersion && <span className="brand-version" aria-label={`应用版本 v${appVersion}`} title={`SpeakHub v${appVersion}`}>v{appVersion}</span>}<div className="top-actions">
      <button className={settings.visible ? 'subtitle-toggle active' : 'subtitle-toggle'} onClick={() => void window.speaksub.toggleOverlay()}>{settings.visible ? '隐藏字幕' : '显示字幕'}</button>
      {settings.locked && <button className="subtitle-unlock-action" onClick={() => updateSubtitle({ locked: false })}>解锁字幕</button>}
      {isWebSource && <button className="quiet-action" onClick={() => void openConnection()}>连接页</button>}
    </div><WindowControls/>
  </header><aside className="studio-nav"><button className={tab === 'practice' ? 'active' : ''} onClick={() => { cancelMicrophoneTest(); cancelMimoPreview(); setTab('practice') }}>练习</button><button className={tab === 'learning' ? 'active' : ''} onClick={() => { cancelMicrophoneTest(); cancelMimoPreview(); setTab('learning') }}>学习</button><button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>设置</button></aside>
  <section className="studio-content">
    {tab === 'practice' && <>
      <section className="practice-stage"><div className="stage-copy"><p className="kicker">SPEAKING SESSION</p><h1>{session ? '正在对话…' : '准备开口。'}</h1><p>{session ? (source === 'api-direct' ? `阿里中英识别与${ttsProvider === 'mimo' ? ` MiMo ${mimoVoice} 云端朗读` : ' Kokoro 本地朗读'}已接入流式 API、字幕和归档。` : `${sourceLabels[source]} 在后台保持运行，字幕可随时显示。`) : '选择来源、场景和难度，然后开始一次练习。'}</p></div><div className="automation-card"><span className={`status-dot ${automation.phase}`}></span><div><small>{source === 'api-direct' && mode === 'voice' ? voicePhase : automation.phase.replaceAll('-', ' ')}</small><strong>{automation.message}</strong></div>{automation.recoverable && isWebSource && <button onClick={() => void openConnection()}>打开连接页</button>}{automation.recoverable && isWebSource && <button onClick={() => void clearPendingCleanup()}>已处理旧对话</button>}</div></section>
      <section className="template-workbench"><div className="workbench-heading"><h2>选择一次对话</h2><span>{source === 'api-direct' ? apiVoiceSummary : `${sourceLabels[source]} 在后台执行`}</span></div>
        <div className="source-picker">{(Object.keys(sourceLabels) as PracticeSource[]).map((item) => <button key={item} disabled={Boolean(session) || transitionBusy} className={source === item ? 'active' : ''} onClick={() => selectSource(item)}>{sourceLabels[item]}</button>)}</div>
        <div className="source-picker" aria-label="交流方式"><button disabled={Boolean(session) || transitionBusy} className={mode === 'voice' ? 'active' : ''} onClick={() => selectMode('voice')}>语音交流</button><button disabled={Boolean(session) || transitionBusy} className={mode === 'text' ? 'active' : ''} onClick={() => selectMode('text')}>文字交流</button></div>
        {templates && <><div className="prompt-category"><div><strong>情景</strong><button className="quiet-action" disabled={Boolean(session) || transitionBusy} onClick={() => openTemplateEditor('scenario')}>管理提示词</button>{source === 'api-direct' && <button className="quiet-action" disabled={Boolean(session) || transitionBusy} onClick={openSystemPromptEditor}>管理系统提示词</button>}</div><div className="topic-grid">{templates.scenario.map((item) => <button key={item.id} disabled={Boolean(session) || transitionBusy} className={selectedTemplates.scenario === item.id ? 'topic active' : 'topic'} onClick={() => { setSelectedTemplates((value) => ({ ...value, scenario: item.id })); savePracticePreferences({ scenarioTemplateId: item.id }) }}>{item.name}</button>)}</div></div>
        <div className="session-config"><div className="level-picker"><span>难度</span>{templates.difficulty.map((item) => <button key={item.id} disabled={Boolean(session) || transitionBusy} className={selectedTemplates.difficulty === item.id ? 'active' : ''} onClick={() => { setSelectedTemplates((value) => ({ ...value, difficulty: item.id })); savePracticePreferences({ difficultyTemplateId: item.id }) }}>{item.name}</button>)}</div><div className="correction-picker"><span>纠错</span>{templates.correction.map((item) => <button key={item.id} disabled={Boolean(session) || transitionBusy} className={selectedTemplates.correction === item.id ? 'active' : ''} onClick={() => { setSelectedTemplates((value) => ({ ...value, correction: item.id })); savePracticePreferences({ correctionTemplateId: item.id }) }}>{item.name}</button>)}</div><button className="quiet-action" disabled={Boolean(session) || transitionBusy} onClick={() => openTemplateEditor('difficulty')}>管理难度</button><button className="quiet-action" disabled={Boolean(session) || transitionBusy} onClick={() => openTemplateEditor('correction')}>管理纠错</button>{session ? <button className="finish-action" disabled={transitionBusy} onClick={() => void endPractice()}>{lifecycle === 'ending' ? '正在生成复盘…' : '结束并生成复盘'}</button> : <button className="primary-action" disabled={transitionBusy} onClick={() => void startPractice()}>{lifecycle === 'starting' ? '正在启动…' : '确认并开始'}</button>}</div>
        <section className="prompt-preview"><strong>{source === 'api-direct' ? '将作为 system 发送给 AI 的完整提示词' : '将发送给 ChatGPT 的完整提示词'}</strong><p>{promptPreview}</p></section>{systemPromptEditorOpen && <div className="confirm-layer template-editor" role="dialog" aria-modal="true" aria-labelledby="system-prompt-editor-title"><div><header className="template-editor-header"><div><p className="kicker">SYSTEM PROMPT</p><h2 id="system-prompt-editor-title">管理系统提示词</h2><p>系统提示词会先与情景、难度和纠错提示词组合，再作为 API 直连的完整 system 提示词发送。</p></div><button className="template-editor-close" type="button" aria-label="关闭系统提示词管理" title="关闭" onClick={() => setSystemPromptEditorOpen(false)}>×</button></header><textarea value={systemPromptDraft} aria-label="系统提示词内容" rows={12} onChange={(event) => setSystemPromptDraft(event.target.value)}/><footer><button className="quiet-action" onClick={resetSystemPromptDraft}>恢复默认</button><button className="quiet-action" onClick={() => setSystemPromptEditorOpen(false)}>取消</button><button className="primary-action" disabled={!systemPromptDraft.trim()} onClick={() => void saveSystemPrompt()}>保存</button></footer></div></div>}
        {!session && focus && <label className="practice-focus"><span><input type="checkbox" checked={focusEnabled} onChange={(event) => { setFocusEnabled(event.target.checked); savePracticePreferences({ focusEnabled: event.target.checked }) }}/> 带入上次复盘重点</span><textarea disabled={!focusEnabled} value={focus} onChange={(event) => { setFocus(event.target.value); savePracticePreferences({ focus: event.target.value }) }} rows={3}/><small>重点来自所选历史对话的薄弱点和“下一次练习”建议；勾选后会追加到最终提示词。</small></label>}</>}
        {session && source === 'api-direct' && mode === 'text' && <div className="api-composer"><textarea value={apiMessage} disabled={apiBusy} onChange={(event) => setApiMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendApiMessage() } }} placeholder="用英语输入你的回答…" rows={3}/><button className="primary-action" disabled={apiBusy || !apiMessage.trim()} onClick={() => void sendApiMessage()}>{apiBusy ? '正在回复…' : '发送'}</button></div>}
        {session && mode === 'voice' && <div className="api-composer microphone-control"><div><strong>{microphone.active ? (source === 'api-direct' && voicePhase === 'listening' ? '正在听你说' : '麦克风已开启，可随时打断 AI') : '麦克风已暂停'}</strong><span>按 {microphone.shortcut} 开启或暂停；API 语音在 AI 思考和朗读时也会持续监听。</span></div><button className={microphone.active ? 'finish-action' : 'primary-action'} type="button" onClick={() => void toggleMicrophone()}>{microphone.active ? `暂停麦克风 · ${microphone.shortcut}` : `开启麦克风 · ${microphone.shortcut}`}</button></div>}
      </section>
      <section className="support-row"><div className="compact-panel"><div><p className="kicker">LIVE SUBTITLES</p><h3>{settings.visible ? '悬浮字幕已显示' : '悬浮字幕暂未显示'}</h3><p>主页面和悬浮窗使用同一组字幕事件。</p></div><button className="quiet-action" onClick={() => void window.speaksub.toggleOverlay()}>{settings.visible ? '隐藏' : '显示'}</button></div><div className="compact-panel transcript-preview dual-transcript"><div><p className="kicker">我</p><p>{latestUser || '开始说话后，中英混合识别字幕会显示在这里。'}</p></div><div><p className="kicker">AI {latestAssistantEvent?.interrupted && <span>· 已打断</span>}</p><p>{latestAssistant || 'DeepSeek 的流式回复会逐步显示在这里。'}</p></div></div></section>
      {review && <section className="review-panel"><p className="kicker">SESSION REVIEW</p><h2>{review.topic}</h2><p>{review.summary}</p>{review.issues.slice(0, 3).map((issue, index) => <div className="review-issue" key={index}><span>{issue.original}</span><strong>{issue.improved}</strong><small>{issue.reason}</small></div>)}</section>}
    </>}
    {tab === 'learning' && <LearningCenter onUseDraft={useNextPracticeDraft}/>}
    {tab === 'settings' && <section className="utility-page settings-page"><p className="kicker">SPEAKSUB CONTROLS</p><h1>设置</h1><section className="community-support-card" aria-labelledby="community-support-title"><div className="community-support-copy"><p className="kicker">SPEAKHUB COMMUNITY</p><h2 id="community-support-title">免费开源，欢迎交流学习 AI</h2><p>加入 QQ 交流群 <strong>1091142340</strong>，一起交流 SpeakHub 的使用体验、AI 学习心得和改进建议。</p></div><div className="community-support-actions"><button className="community-primary-action" type="button" onClick={() => void copyCommunityGroupNumber()}>加入 QQ 群 1091142340</button><button className="community-support-action" type="button" onClick={() => setCommunitySupportOpen(true)}>请作者喝杯咖啡</button>{groupCopyStatus && <small role="status" aria-live="polite">{groupCopyStatus}</small>}</div></section>{automation.recoverable && <div className="settings-guidance" role="alert">{automation.message}</div>}<div className="settings-grid"><label>字幕内容<select value={settings.mode} onChange={(event) => updateSubtitle({ mode: event.target.value as SubtitlePreferences['mode'] })}><option value="assistant">只显示 AI</option><option value="user">只显示我</option><option value="both">显示双方</option></select></label><label>背景<select value={settings.background} onChange={(event) => updateSubtitle({ background: event.target.value as SubtitlePreferences['background'] })}><option value="glass">半透明磨砂</option><option value="solid">纯色底板</option><option value="transparent">完全透明</option></select></label><label>背景颜色<input type="color" value={settings.backgroundColor} onChange={(event) => updateSubtitle({ backgroundColor: event.target.value })}/></label><label>背景透明度 <output>{Math.round(settings.backgroundOpacity * 100)}%</output><input type="range" min="0.1" max="1" step="0.05" value={settings.backgroundOpacity} onChange={(event) => updateSubtitle({ backgroundOpacity: Number(event.target.value) })}/></label><label>持续显示行数<select value={settings.maxLines} onChange={(event) => updateSubtitle({ maxLines: Number(event.target.value) })}>{[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 行</option>)}</select></label><label>字号 <output>{settings.fontSize}px</output><input type="range" min="18" max="38" value={settings.fontSize} onChange={(event) => updateSubtitle({ fontSize: Number(event.target.value) })}/></label><label>整体透明度 <output>{Math.round(settings.opacity * 100)}%</output><input type="range" min="0.55" max="1" step="0.05" value={settings.opacity} onChange={(event) => updateSubtitle({ opacity: Number(event.target.value) })}/></label><label>AI 字幕颜色<input type="color" value={settings.assistantColor} onChange={(event) => updateSubtitle({ assistantColor: event.target.value })}/></label><label>我的字幕颜色<input type="color" value={settings.userColor} onChange={(event) => updateSubtitle({ userColor: event.target.value })}/></label><label className="check-label"><input type="checkbox" checked={settings.locked} onChange={(event) => updateSubtitle({ locked: event.target.checked })}/>锁定字幕位置和操作</label></div>
      <section className="archive-directory microphone-settings-card">
        <h2>麦克风与快捷键</h2>
        <p>先检测电脑能否收到你的声音；检测只在本机运行，不调用阿里或大模型 API。</p>
        <div className={`microphone-test ${microphoneTestState}`}>
          <button className="quiet-action microphone-test-trigger" type="button" disabled={Boolean(session) || microphoneTestState === 'checking'} onClick={() => void testMicrophone()}>{microphoneTestState === 'checking' ? '正在检测麦克风…' : '检测麦克风'}</button>
          <progress aria-label="麦克风输入强度" max={1} value={microphoneTestLevel}/>
          {microphoneTestMessage && <small className="microphone-test-result" role={microphoneTestState === 'error' ? 'alert' : 'status'} aria-live="polite">{microphoneTestMessage}</small>}
        </div>
        <p>点击输入框后直接按下按键组合。它是系统全局快捷键，在 ChatGPT 网页获得焦点时也会生效。</p>
        <input className="shortcut-input" aria-label="麦克风快捷键" value={shortcutDraft} readOnly onKeyDown={(event) => void recordMicrophoneShortcut(event)}/>
        {shortcutError && <small role="alert">{shortcutError}</small>}
      </section>
      <section className="archive-directory"><h2>本地归档</h2><p>练习中会持续写入此文件夹根目录的 current-practice.md；复盘完成后，它会改名为一份包含对话、收藏词和复盘的 Markdown。</p><output title={archiveDirectory}>{archiveDirectory || '正在读取…'}</output><button className="quiet-action" disabled={Boolean(session) || transitionBusy} onClick={() => void chooseArchiveDirectory()}>选择文件夹</button>{(session || transitionBusy) && <small>请先结束当前练习再切换。</small>}</section>
      <section className="archive-directory app-update-card"><h2>应用更新</h2><p>{updates.available ? `当前版本 ${updates.available.currentVersion}，最新版本 ${updates.available.latestVersion}` : '启动后会自动检查 GitHub Release，也可以在这里手动检查。'}</p>{updates.status && <small role="status">{updates.status}</small>}<button className="quiet-action" type="button" disabled={updates.checking || updates.downloading} onClick={() => void updates.check(true)}>{updates.checking ? '正在检查…' : '检查更新'}</button></section>
      <section className="archive-directory speech-assets">
        <h2>语音朗读辅助组件</h2>
        <p>推荐使用 Xiaomi MiMo 云端朗读，音色更加自然；本地只需安装 Silero VAD。Kokoro 是本地备用方案，仅建议在离线或不希望文本发送到云端时使用。</p>
        {(['vad', 'tts'] as const).map((asset) => <div key={asset}><strong className="speech-asset-name"><span>{asset === 'vad' ? 'Silero VAD · 语音检测与抢话（语音对话必需）' : 'Kokoro · 本地备用朗读（非推荐）'}</span>{asset === 'tts' && <span className="mimo-recommendation-badge">推荐使用 MiMo</span>}</strong><span>{speechAssetStatus(speechAssets[asset])}</span><progress max={1} value={speechAssets[asset].progress}/>{speechAssets[asset].error && <small role="alert">{speechAssets[asset].error}</small>}{asset === 'tts' && speechAssets.tts.status === 'ready' && <div className="speech-asset-actions"><button className="danger-action kokoro-remove-trigger" type="button" disabled={Boolean(session) || usesLocalTts || ttsPreferenceSave.state === 'saving'} title={usesLocalTts ? '请先在下方切换到 MiMo' : ttsPreferenceSave.state === 'saving' ? '正在保存朗读方式' : undefined} onClick={() => { setKokoroRemovalError(''); setKokoroRemovalOpen(true) }}>删除 Kokoro 模型</button>{usesLocalTts && <small>当前正在使用 Kokoro；请先在下方切换到 MiMo，再删除本地模型。</small>}</div>}</div>)}
        {speechModelsReady ? <small>{usesLocalTts ? '当前语音方案所需的本地组件已就绪。' : 'MiMo 云端朗读所需的本地组件已就绪；Kokoro 仅作为本地备用。'}</small> : <>{speechRemainingMegabytes > 0 && <small>还需下载约 {speechRemainingMegabytes} MB。</small>}<button className="quiet-action" disabled={speechModelsDownloading} onClick={() => void downloadSpeechModels()}>{speechModelsDownloading ? '正在下载语音组件…' : speechDownloadButton}</button></>}
        <SpeechInstallHelp info={speechInstallInfo} onOpenDirectory={() => void openSpeechAssetDirectory()}/>
      </section>
      <form key={JSON.stringify(providers)} className="provider-form" onSubmit={(event) => { event.preventDefault(); void saveProviders(event.currentTarget) }}>
        <h2>对话大模型</h2>
        <p>DeepSeek 或其他 OpenAI-compatible 文本接口负责生成回复和练习复盘，不负责麦克风识别。</p>
        <label>兼容接口 Base URL<input name="llmBaseUrl" defaultValue={providers?.llmBaseUrl} placeholder="https://api.deepseek.com/v1" onChange={resetLlmCheck}/></label>
        <label>模型名<input name="llmModel" defaultValue={providers?.llmModel} placeholder="deepseek-chat" onChange={resetLlmCheck}/></label>
        <label>LLM API Key<input name="llmApiKey" type="password" placeholder={providers?.hasLlmKey ? '已保存' : '填写 API Key'} onChange={resetLlmCheck}/></label>
        <div className="model-probe">
          <button className="quiet-action" type="button" disabled={modelProbeState === 'probing'} onClick={(event) => { const form = event.currentTarget.form; if (form) void probeProviderModels(form) }}>{modelProbeState === 'probing' ? '正在探测…' : '探测可用模型'}</button>
          {modelProbeMessage && <small role={modelProbeState === 'error' ? 'alert' : 'status'}>{modelProbeMessage}</small>}
          {discoveredModels.length > 0 && <div className="model-options" aria-label="可用模型">{discoveredModels.map((model) => <button key={model} type="button" onClick={(event) => { const input = event.currentTarget.form?.elements.namedItem('llmModel'); if (input instanceof HTMLInputElement) { input.value = model; input.focus(); resetLlmCheck() } }}>{model}</button>)}</div>}
        </div>
        <div className={`provider-check ${llmCheckState}`}>
          <button className="quiet-action llm-check-trigger" type="button" disabled={Boolean(session) || llmCheckState === 'checking'} onClick={(event) => { const form = event.currentTarget.form; if (form) void testLlmConnection(form) }}>{llmCheckState === 'checking' ? '正在检测大模型…' : '检测大模型'}</button>
          <small>会发送一次最多几个 Token 的真实测试消息，不会保存当前输入。</small>
          {llmCheckMessage && <small className="provider-check-result" role={llmCheckState === 'error' ? 'alert' : 'status'} aria-live="polite">{llmCheckMessage}</small>}
        </div>
        <label className="check-label"><input name="clearLlmApiKey" type="checkbox" onChange={resetLlmCheck}/>清除已保存的 LLM Key</label>
        <h2>AI 朗读（TTS）</h2>
        <p>Kokoro 在电脑本地合成，不消耗云端额度；Xiaomi MiMo V2.5 TTS 使用云端 24 kHz 流式合成，声音更自然，但会把待朗读文本发送到 MiMo。</p>
        <label>朗读方式<select name="ttsProvider" value={ttsProvider} disabled={Boolean(session)} onChange={(event) => changeTtsProvider(event.target.value as SpeechSynthesisProvider)}>
          <option value="mimo">云端 Xiaomi MiMo V2.5 TTS（推荐）</option>
          <option value="kokoro">本地 Kokoro（备用）</option>
        </select></label>
        <small className={`tts-preference-save ${ttsPreferenceSave.state}`} role={ttsPreferenceSave.state === 'error' ? 'alert' : 'status'} aria-live="polite">{ttsPreferenceSave.message || '朗读方式和音色选择后会自动保存。'}</small>
        <div className="aliyun-key-row mimo-key-row">
          <label>MiMo API Key<input name="mimoTtsApiKey" type="password" placeholder={providers?.hasMimoTtsKey ? '已保存' : '云端朗读时填写'} onChange={() => { if (mimoPreview.state === 'error') setMimoPreview({ state: 'idle', message: '' }) }}/></label>
          <button className="quiet-action aliyun-help-trigger mimo-help-trigger" type="button" onClick={() => setMimoHelpOpen(true)}>如何获取</button>
        </div>
        <div className="mimo-voice-settings">
          <input type="hidden" name="mimoTtsVoice" value={mimoVoice}/>
          <div className="mimo-voice-heading"><strong>MiMo 音色</strong><small>点击即可选择、试听并自动保存</small></div>
          {mimoVoiceGroups.map((group) => <section key={group.label} className="mimo-voice-group" aria-label={group.label}>
            <span>{group.label}</span>
            <div>{group.voices.map((voice) => {
              const busy = mimoPreview.state === 'checking' && mimoPreview.voice === voice.id
              const playing = mimoPreview.state === 'playing' && mimoPreview.voice === voice.id
              return <button key={voice.id} type="button" className={`mimo-voice-button${mimoVoice === voice.id ? ' active' : ''}${playing ? ' playing' : ''}`} aria-pressed={mimoVoice === voice.id} aria-label={`选择并试听 ${voice.id}`} disabled={Boolean(session)} onClick={(event) => { const form = event.currentTarget.form; if (form) void previewMimoVoice(voice.id, form) }}>
                <span><strong>{voice.id}</strong><small>{voice.description}</small></span>
                <em aria-hidden="true">{busy ? '…' : playing ? '■' : '▶'}</em>
              </button>
            })}</div>
          </section>)}
          {mimoPreview.message && <small className={`mimo-preview-result ${mimoPreview.state}`} role={mimoPreview.state === 'error' ? 'alert' : 'status'} aria-live="polite">{mimoPreview.message}</small>}
        </div>
        <small>当前调用模型固定为 <code>mimo-v2.5-tts</code>；旧版 <code>mimo-v2-tts</code> 已下线。</small>
        <label className="check-label"><input name="clearMimoTtsApiKey" type="checkbox"/>清除已保存的 MiMo Key</label>
        <h2>阿里语音识别</h2>
        <p>声音转字幕固定使用阿里 Fun-ASR，与上面的 Kokoro / MiMo 朗读选择互不影响。</p>
        <div className="aliyun-key-row">
          <label>阿里 DashScope API Key<input name="aliyunAsrApiKey" type="password" placeholder={providers?.hasAliyunAsrKey ? '已保存' : '填写阿里语音识别 Key'} onChange={resetAliyunCheck}/></label>
          <button className="quiet-action aliyun-help-trigger" type="button" onClick={() => setAliyunHelpOpen(true)}>如何获取</button>
        </div>
        <div className={`provider-check ${aliyunCheckState}`}>
          <button className="quiet-action aliyun-check-trigger" type="button" disabled={Boolean(session) || aliyunCheckState === 'checking'} onClick={(event) => { const form = event.currentTarget.form; if (form) void testAliyunConnection(form) }}>{aliyunCheckState === 'checking' ? '正在检测阿里识别…' : '检测阿里识别'}</button>
          <small>只验证 Key、网络和服务连接，不测试麦克风或扬声器。</small>
          {aliyunCheckMessage && <small className="provider-check-result" role={aliyunCheckState === 'error' ? 'alert' : 'status'} aria-live="polite">{aliyunCheckMessage}</small>}
        </div>
        <label className="check-label"><input name="clearAliyunAsrApiKey" type="checkbox" onChange={resetAliyunCheck}/>清除已保存的阿里 Key</label>
        <div className="speech-usage"><strong>阿里识别用量</strong><span>本次 {speechUsage.sessionSeconds} 秒 · {speechUsage.month || '本月'}累计 {speechUsage.monthlySeconds} 秒</span><small>按目录价估算 ¥{speechUsage.estimatedCny.toFixed(2)}；实际账单以阿里控制台为准。</small></div>
        {session && <small>请先结束当前练习，再修改 API 或语音识别设置。</small>}
        <button className="primary-action" type="submit" disabled={Boolean(session)}>保存设置</button>
      </form>
    </section>}
  </section>{communitySupportOpen && <div className="confirm-layer community-support-dialog" role="dialog" aria-modal="true" aria-labelledby="community-support-dialog-title"><div><header><div><p className="kicker">SUPPORT SPEAKHUB</p><h2 id="community-support-dialog-title">请作者喝杯咖啡</h2><p>SpeakHub 免费开源，支持与否都欢迎使用。若它恰好帮到了你，欢迎请作者喝杯咖啡或补充一点 Token，支持后续开发与维护。</p></div><button className="template-editor-close" type="button" aria-label="关闭赞助弹窗" title="关闭" onClick={() => setCommunitySupportOpen(false)}>×</button></header><img src={supportPaymentCode} alt="微信赞助收款码"/><small>微信扫一扫即可赞助，感谢你的支持。</small></div></div>}{aliyunHelpOpen && <div className="confirm-layer aliyun-help-dialog" role="dialog" aria-modal="true" aria-labelledby="aliyun-help-title"><div><header className="aliyun-help-header"><div><p className="kicker">DASHSCOPE API</p><h2 id="aliyun-help-title">如何开通阿里语音识别</h2><p>第一次配置照着下面四步做即可。</p></div><button className="template-editor-close" type="button" aria-label="关闭阿里 API 帮助" title="关闭" onClick={() => setAliyunHelpOpen(false)}>×</button></header><ol><li><strong>注册或登录阿里云</strong><span>打开百炼控制台，按提示开通模型服务；区域选择“华北 2（北京）”。</span></li><li><strong>创建通用 API Key</strong><span>进入 API Key 页面，在默认业务空间创建按量付费 Key。不要使用 Token Plan / Coding Plan 的 <code>sk-sp-</code> 专属 Key。</span></li><li><strong>立即复制保存</strong><span>完整 Key 只在创建成功时显示一次。复制后粘贴到上面的输入框。</span></li><li><strong>回到这里保存</strong><span>识别服务选择“阿里 Fun-ASR”，再点击“保存设置”。</span></li></ol><div className="aliyun-help-actions"><a className="primary-action" href={ALIYUN_HELP_LINKS.console} target="_blank" rel="noreferrer">打开百炼控制台 ↗</a><a className="quiet-action" href={ALIYUN_HELP_LINKS.apiKeyGuide} target="_blank" rel="noreferrer">查看官方教程 ↗</a><a className="quiet-action" href={ALIYUN_HELP_LINKS.freeQuotaGuide} target="_blank" rel="noreferrer">查看免费额度 ↗</a></div><p className="aliyun-help-note"><strong>费用提醒：</strong>新用户通常有免费额度，具体额度和有效期以阿里控制台为准。担心超额时，可在百炼控制台开启“免费额度用完即停”。</p></div></div>}{templateEditor && templateDraft && <div className="confirm-layer template-editor" role="dialog" aria-modal="true" aria-labelledby="template-editor-title"><div><header className="template-editor-header"><div><p className="kicker">PROMPT LIBRARY</p><h2 id="template-editor-title">管理提示词</h2><p>名称显示在练习台；提示词会原样以中文发送给 AI。</p></div><button className="template-editor-close" type="button" aria-label="关闭提示词管理" title="关闭" onClick={closeTemplateEditor}>×</button></header><div className="template-editor-list">{templateDraft[templateEditor].map((item, index) => <div key={item.id}><input value={item.name} aria-label="提示词名称" onChange={(event) => setTemplateDraft((current) => current && ({ ...current, [templateEditor]: current[templateEditor].map((value, position) => position === index ? { ...value, name: event.target.value } : value) }))}/><textarea value={item.prompt} aria-label="提示词内容" rows={4} onChange={(event) => setTemplateDraft((current) => current && ({ ...current, [templateEditor]: current[templateEditor].map((value, position) => position === index ? { ...value, prompt: event.target.value } : value) }))}/><button className="danger-action" disabled={templateDraft[templateEditor].length === 1} onClick={() => setTemplateDraft((current) => current && ({ ...current, [templateEditor]: current[templateEditor].filter((_, position) => position !== index) }))}>删除</button></div>)}</div><button className="quiet-action" onClick={() => setTemplateDraft((current) => current && ({ ...current, [templateEditor]: [...current[templateEditor], { id: `${templateEditor}-${Date.now()}`, name: '新提示词', prompt: '请填写中文提示词。' }] }))}>添加自定义提示词</button><footer><button className="quiet-action" onClick={closeTemplateEditor}>取消</button><button className="primary-action" onClick={() => void saveTemplates()}>保存</button></footer></div></div>}</main>{updateDialog}</>
}
