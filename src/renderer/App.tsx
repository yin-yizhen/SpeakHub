import { useEffect, useMemo, useRef, useState } from 'react'
import type { AutomationStatus, ConnectionState, CorrectionStrength, MicrophoneGateState, NextPracticeDraft, PracticeLifecycle, PracticeMode, PracticePreferences, PracticeSource, PromptTemplateCategory, PromptTemplates, ProviderSettings, ReviewResult, SpeechAssetState, SpeechUsageState, SubtitlePreferences, TranscriptEvent, VoiceTurnPhase } from '../shared/types'
import { defaultSubtitlePreferences } from '../shared/defaults'
import { LocalSpeechAudioCapture, LocalSpeechAudioPlayer, playMicrophoneToggleTone } from './local-speech-audio'
import { isPracticeTransitionBusy, templateSelectionForDraft } from './app-state'
import { LearningCenter } from './LearningCenter'
import { shortcutFromKeyboardEvent } from '../main/microphone-shortcut'
import { ALIYUN_HELP_LINKS } from '../shared/help-links'

const brandIcon = new URL('./assets/app-icon-transparent.png', import.meta.url).href

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

function remainingBytes(asset: SpeechAssetState[keyof SpeechAssetState]): number {
  return asset.status === 'ready' ? 0 : Math.max(0, asset.totalBytes - asset.downloadedBytes)
}

const requiredSpeechAssets: Array<keyof SpeechAssetState> = ['vad', 'tts']

function speechDownloadAction(assets: SpeechAssetState, retry = false): string {
  const vadRemaining = remainingBytes(assets.vad)
  const ttsRemaining = remainingBytes(assets.tts)
  const megabytes = Math.max(1, Math.round((vadRemaining + ttsRemaining) / 1_000_000))
  return `${retry ? '重试下载' : '下载'}VAD 与 Kokoro（约 ${megabytes} MB）`
}

function speechAssetStatus(asset: SpeechAssetState[keyof SpeechAssetState]): string {
  if (asset.status === 'downloading') return `${Math.round(asset.progress * 100)}%`
  if (asset.status === 'ready') return '已就绪'
  if (asset.status === 'error') return '下载失败'
  return asset.downloadedBytes > 0 ? `需补全 · 已有 ${Math.round(asset.progress * 100)}%` : '未下载'
}

export function App() {
  const [settings, setSettings] = useState<SubtitlePreferences>(defaultSubtitlePreferences)
  const [connection, setConnection] = useState<ConnectionState>({ ready: false, pageVisible: true, activeProvider: 'chatgpt-web', providers: { 'chatgpt-web': false } })
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
  const [apiMessage, setApiMessage] = useState('')
  const [apiBusy, setApiBusy] = useState(false)
  const [tab, setTab] = useState<'practice' | 'learning' | 'settings'>('practice')
  const [review, setReview] = useState<ReviewResult>()
  const [providers, setProviders] = useState<ProviderSettings>()
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [modelProbeState, setModelProbeState] = useState<'idle' | 'probing' | 'error'>('idle')
  const [modelProbeMessage, setModelProbeMessage] = useState('')
  const [lifecycle, setLifecycle] = useState<PracticeLifecycle>('idle')
  const [archiveDirectory, setArchiveDirectory] = useState('')
  const [microphone, setMicrophone] = useState<MicrophoneGateState>(defaultMicrophone)
  const [shortcutDraft, setShortcutDraft] = useState(defaultMicrophone.shortcut)
  const [shortcutError, setShortcutError] = useState<string>()
  const [speechAssets, setSpeechAssets] = useState<SpeechAssetState>(defaultSpeechAssets)
  const [speechUsage, setSpeechUsage] = useState<SpeechUsageState>(defaultSpeechUsage)
  const [aliyunHelpOpen, setAliyunHelpOpen] = useState(false)
  const [voicePhase, setVoicePhase] = useState<VoiceTurnPhase>('idle')
  const capture = useRef(new LocalSpeechAudioCapture())
  const player = useRef(new LocalSpeechAudioPlayer())
  const previousMicrophoneActive = useRef(false)

  useEffect(() => {
    void Promise.all([window.speaksub.getState(), window.speaksub.getProviderSettings(), window.speaksub.getArchiveDirectory(), window.speaksub.getPromptTemplates(), window.speaksub.getPracticePreferences()]).then(([state, provider, directory, promptTemplates, preferences]) => {
      const selected = {
        scenario: promptTemplates.scenario.some((item) => item.id === preferences.scenarioTemplateId) ? preferences.scenarioTemplateId : promptTemplates.scenario[0].id,
        difficulty: promptTemplates.difficulty.some((item) => item.id === preferences.difficultyTemplateId) ? preferences.difficultyTemplateId : promptTemplates.difficulty[0].id,
        correction: promptTemplates.correction.some((item) => item.id === preferences.correctionTemplateId) ? preferences.correctionTemplateId : promptTemplates.correction[1]?.id ?? promptTemplates.correction[0].id
      }
      setSettings(state.settings); setConnection(state.connection); setAutomation(state.automation); setSession(state.session?.id); setEvents(state.events); setProviders(provider); setSource(preferences.source); setMode(preferences.mode); setLifecycle(state.lifecycle); setArchiveDirectory(directory); setMicrophone(state.microphone); setShortcutDraft(state.microphone.shortcut); setSpeechAssets(state.speechAssets); setSpeechUsage(state.speechUsage); setVoicePhase(state.voicePhase); setTemplates(promptTemplates); setSelectedTemplates(selected); setFocus(preferences.focus); setFocusEnabled(preferences.focusEnabled)
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
    return () => { capture.current.stop(); player.current.stop(); removeTranscript(); removeSettings(); removeAutomation(); removePracticeEnded(); removeConnection(); removeVoiceAudio(); removeVoiceInterrupt(); removeSpeechAssets(); removeSpeechUsage(); removeVoicePhase(); removeMicrophone() }
  }, [])

  const latestAssistantEvent = useMemo(() => [...events].reverse().find((event) => event.speaker === 'assistant'), [events])
  const latestAssistant = latestAssistantEvent?.text ?? ''
  const latestUser = useMemo(() => [...events].reverse().find((event) => event.speaker === 'user')?.text ?? '', [events])
  const updateSubtitle = (input: Partial<SubtitlePreferences>) => void window.speaksub.updateSubtitle(input)
  const isWebSource = source !== 'api-direct'
  const transitionBusy = isPracticeTransitionBusy(lifecycle)
  const apiConfigured = Boolean(providers?.llmBaseUrl?.trim() && providers.llmModel?.trim() && providers.hasLlmKey)
  const recognitionConfigured = Boolean(providers?.hasAliyunAsrKey)
  const requiredAssets = requiredSpeechAssets
  const speechModelsReady = requiredAssets.every((asset) => speechAssets[asset].status === 'ready')
  const speechModelsDownloading = requiredAssets.some((asset) => speechAssets[asset].status === 'downloading')
  const speechDownloadButton = speechDownloadAction(speechAssets, requiredAssets.some((asset) => speechAssets[asset].status === 'error'))
  const speechRemainingBytes = requiredAssets.reduce((sum, asset) => sum + remainingBytes(speechAssets[asset]), 0)
  const speechRemainingMegabytes = speechRemainingBytes > 0 ? Math.max(1, Math.round(speechRemainingBytes / 1_000_000)) : 0
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
  async function openConnection(): Promise<void> { if (source === 'api-direct') return; await window.speaksub.showConnectionPage() }
  async function skipWebConnection(): Promise<void> {
    setSource('api-direct')
    setMode('voice')
    setConnection(await window.speaksub.hideConnectionPage())
    requireApiVoiceSetup('api-direct', 'voice')
  }
  async function clearPendingCleanup(): Promise<void> { if (source === 'api-direct') return; await window.speaksub.clearPendingCleanup(); setAutomation({ phase: 'idle', message: '已清除上一条练习记录；现在可以重新开始。' }) }
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
    if (nextMode === 'voice' && !speechModelsReady) {
      setTab('settings')
      setAutomation({ phase: 'failed', message: `阿里语音工作流还缺少本地辅助组件。请${speechDownloadAction(speechAssets)}。`, recoverable: true })
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
      const prompt = [scenario?.prompt, difficulty?.prompt, correction?.prompt].filter(Boolean).join('\n\n')
      if (!scenario || !difficulty || !correction || !prompt) throw new Error('请先为场景、难度和纠错各选择一个提示词。')
      const correctionStrength: CorrectionStrength = ['light', 'normal', 'strict'].includes(correction.id) ? correction.id as CorrectionStrength : 'normal'
      const cefrLevel = ['A1', 'A2', 'B1', 'B2', 'C1'].includes(difficulty.name) ? difficulty.name : 'B1'
      const result = await window.speaksub.startPractice(scenario.name, cefrLevel, correctionStrength, source, mode, focusEnabled ? focus || undefined : undefined, prompt)
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
      clearAliyunAsrApiKey: data.get('clearAliyunAsrApiKey') === 'on'
    })
      setProviders(saved)
      const configured = Boolean(saved.llmBaseUrl?.trim() && saved.llmModel?.trim() && saved.hasLlmKey)
      const savedAssetsReady = requiredSpeechAssets.every((asset) => speechAssets[asset].status === 'ready')
      if (configured && !saved.hasAliyunAsrKey) setAutomation({ phase: 'failed', message: '文本 API 已配置；请继续填写阿里云 DashScope API Key。', recoverable: true })
      else if (configured && source === 'api-direct' && mode === 'voice' && !savedAssetsReady) setAutomation({ phase: 'failed', message: `API 已配置。继续${speechDownloadAction(speechAssets)}。`, recoverable: true })
      else setAutomation({ phase: 'idle', message: configured ? '对话 API 与语音识别设置已保存。' : 'API 设置已保存，但信息尚未填写完整。' })
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
  async function downloadSpeechModels(): Promise<void> {
    try {
      setSpeechAssets(await window.speaksub.downloadSpeechAssets())
      setAutomation({ phase: 'idle', message: 'VAD 与 Kokoro 已下载完成，可以使用阿里云识别。' })
    } catch (error) {
      setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '模型下载失败。', recoverable: true })
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

  if (connection.pageVisible) return <main className="connection-shell"><WindowControls/><section className="connection-panel">
    <div className="brand-lockup"><img className="brand-icon" src={brandIcon} alt="" /><span className="brand-copy"><strong>SpeakHub</strong><em>personal practice</em></span></div><p className="kicker">WEB MODEL CONNECTION</p>
    <h1>{connection.ready ? '连接页面已打开' : '先登录你的 ChatGPT'}</h1>
    <p>右侧页面用于登录和恢复网页模式。完成登录后回到 SpeakSub，选择难度并开始对话。</p>
    <div className="connection-steps"><span>01 登录 ChatGPT</span><span>02 确认账号状态</span><span>03 进入练习台</span></div>
    {connection.ready ? <button className="primary-action" onClick={() => void window.speaksub.hideConnectionPage()}>返回练习台</button> : <button className="primary-action" onClick={() => void enterPractice()}>我已登录，进入练习台</button>}<button className="quiet-action connection-skip" onClick={() => void skipWebConnection()}>先使用 API 直连</button>
  </section></main>

  return <main className="studio-shell"><header className="studio-topbar">
    <div className="brand-lockup"><img className="brand-icon" src={brandIcon} alt="" /><span className="brand-copy"><strong>SpeakHub</strong><em>personal practice</em></span></div><span className="brand-credit">Made By Ajin</span><div className="top-actions">
      <button className={settings.visible ? 'subtitle-toggle active' : 'subtitle-toggle'} onClick={() => void window.speaksub.toggleOverlay()}>{settings.visible ? '隐藏字幕' : '显示字幕'}</button>
      {settings.locked && <button className="subtitle-unlock-action" onClick={() => updateSubtitle({ locked: false })}>解锁字幕</button>}
      {isWebSource && <button className="quiet-action" onClick={() => void openConnection()}>连接页</button>}
    </div><WindowControls/>
  </header><aside className="studio-nav"><button className={tab === 'practice' ? 'active' : ''} onClick={() => setTab('practice')}>练习</button><button className={tab === 'learning' ? 'active' : ''} onClick={() => setTab('learning')}>学习</button><button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>设置</button></aside>
  <section className="studio-content">
    {tab === 'practice' && <>
      <section className="practice-stage"><div className="stage-copy"><p className="kicker">SPEAKING SESSION</p><h1>{session ? '正在对话…' : '准备开口。'}</h1><p>{session ? (source === 'api-direct' ? '阿里中英识别与本地朗读已接入流式 API、字幕和归档。' : `${sourceLabels[source]} 在后台保持运行，字幕可随时显示。`) : '选择来源、场景和难度，然后开始一次练习。'}</p></div><div className="automation-card"><span className={`status-dot ${automation.phase}`}></span><div><small>{source === 'api-direct' && mode === 'voice' ? voicePhase : automation.phase.replaceAll('-', ' ')}</small><strong>{automation.message}</strong></div>{automation.recoverable && isWebSource && <button onClick={() => void openConnection()}>打开连接页</button>}{automation.recoverable && isWebSource && <button onClick={() => void clearPendingCleanup()}>已处理旧对话</button>}</div></section>
      <section className="template-workbench"><div className="workbench-heading"><h2>选择一次对话</h2><span>{source === 'api-direct' ? '文本 API + 本地双语语音，双方进入同一字幕流' : `${sourceLabels[source]} 在后台执行`}</span></div>
        <div className="source-picker">{(Object.keys(sourceLabels) as PracticeSource[]).map((item) => <button key={item} disabled={Boolean(session) || transitionBusy} className={source === item ? 'active' : ''} onClick={() => selectSource(item)}>{sourceLabels[item]}</button>)}</div>
        <div className="source-picker" aria-label="交流方式"><button disabled={Boolean(session) || transitionBusy} className={mode === 'voice' ? 'active' : ''} onClick={() => selectMode('voice')}>语音交流</button><button disabled={Boolean(session) || transitionBusy} className={mode === 'text' ? 'active' : ''} onClick={() => selectMode('text')}>文字交流</button></div>
        {templates && <><div className="prompt-category"><div><strong>情景</strong><button className="quiet-action" disabled={Boolean(session) || transitionBusy} onClick={() => openTemplateEditor('scenario')}>管理提示词</button></div><div className="topic-grid">{templates.scenario.map((item) => <button key={item.id} disabled={Boolean(session) || transitionBusy} className={selectedTemplates.scenario === item.id ? 'topic active' : 'topic'} onClick={() => { setSelectedTemplates((value) => ({ ...value, scenario: item.id })); savePracticePreferences({ scenarioTemplateId: item.id }) }}>{item.name}</button>)}</div></div>
        <div className="session-config"><div className="level-picker"><span>难度</span>{templates.difficulty.map((item) => <button key={item.id} disabled={Boolean(session) || transitionBusy} className={selectedTemplates.difficulty === item.id ? 'active' : ''} onClick={() => { setSelectedTemplates((value) => ({ ...value, difficulty: item.id })); savePracticePreferences({ difficultyTemplateId: item.id }) }}>{item.name}</button>)}</div><div className="correction-picker"><span>纠错</span>{templates.correction.map((item) => <button key={item.id} disabled={Boolean(session) || transitionBusy} className={selectedTemplates.correction === item.id ? 'active' : ''} onClick={() => { setSelectedTemplates((value) => ({ ...value, correction: item.id })); savePracticePreferences({ correctionTemplateId: item.id }) }}>{item.name}</button>)}</div><button className="quiet-action" disabled={Boolean(session) || transitionBusy} onClick={() => openTemplateEditor('difficulty')}>管理难度</button><button className="quiet-action" disabled={Boolean(session) || transitionBusy} onClick={() => openTemplateEditor('correction')}>管理纠错</button>{session ? <button className="finish-action" disabled={transitionBusy} onClick={() => void endPractice()}>{lifecycle === 'ending' ? '正在生成复盘…' : '结束并生成复盘'}</button> : <button className="primary-action" disabled={transitionBusy} onClick={() => void startPractice()}>{lifecycle === 'starting' ? '正在启动…' : '确认并开始'}</button>}</div>
        <section className="prompt-preview"><strong>将发送给 AI 的提示词</strong><p>{composedPrompt}</p></section>
        {!session && focus && <label className="practice-focus"><span><input type="checkbox" checked={focusEnabled} onChange={(event) => { setFocusEnabled(event.target.checked); savePracticePreferences({ focusEnabled: event.target.checked }) }}/> 带入上次复盘重点</span><textarea disabled={!focusEnabled} value={focus} onChange={(event) => { setFocus(event.target.value); savePracticePreferences({ focus: event.target.value }) }} rows={3}/><small>重点来自所选历史对话的薄弱点和“下一次练习”建议；勾选后会追加到最终提示词。</small></label>}</>}
        {session && source === 'api-direct' && mode === 'text' && <div className="api-composer"><textarea value={apiMessage} disabled={apiBusy} onChange={(event) => setApiMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendApiMessage() } }} placeholder="用英语输入你的回答…" rows={3}/><button className="primary-action" disabled={apiBusy || !apiMessage.trim()} onClick={() => void sendApiMessage()}>{apiBusy ? '正在回复…' : '发送'}</button></div>}
        {session && mode === 'voice' && <div className="api-composer microphone-control"><div><strong>{microphone.active ? (source === 'api-direct' && voicePhase === 'listening' ? '正在听你说' : '麦克风已开启，可随时打断 AI') : '麦克风已暂停'}</strong><span>按 {microphone.shortcut} 开启或暂停；API 语音在 AI 思考和朗读时也会持续监听。</span></div><button className={microphone.active ? 'finish-action' : 'primary-action'} type="button" onClick={() => void toggleMicrophone()}>{microphone.active ? `暂停麦克风 · ${microphone.shortcut}` : `开启麦克风 · ${microphone.shortcut}`}</button></div>}
      </section>
      <section className="support-row"><div className="compact-panel"><div><p className="kicker">LIVE SUBTITLES</p><h3>{settings.visible ? '悬浮字幕已显示' : '悬浮字幕暂未显示'}</h3><p>主页面和悬浮窗使用同一组字幕事件。</p></div><button className="quiet-action" onClick={() => void window.speaksub.toggleOverlay()}>{settings.visible ? '隐藏' : '显示'}</button></div><div className="compact-panel transcript-preview dual-transcript"><div><p className="kicker">我</p><p>{latestUser || '开始说话后，中英混合识别字幕会显示在这里。'}</p></div><div><p className="kicker">AI {latestAssistantEvent?.interrupted && <span>· 已打断</span>}</p><p>{latestAssistant || 'DeepSeek 的流式回复会逐步显示在这里。'}</p></div></div></section>
      {review && <section className="review-panel"><p className="kicker">SESSION REVIEW</p><h2>{review.topic}</h2><p>{review.summary}</p>{review.issues.slice(0, 3).map((issue, index) => <div className="review-issue" key={index}><span>{issue.original}</span><strong>{issue.improved}</strong><small>{issue.reason}</small></div>)}</section>}
    </>}
    {tab === 'learning' && <LearningCenter onUseDraft={useNextPracticeDraft}/>}
    {tab === 'settings' && <section className="utility-page settings-page"><p className="kicker">SPEAKSUB CONTROLS</p><h1>设置</h1>{automation.recoverable && <div className="settings-guidance" role="alert">{automation.message}</div>}<div className="settings-grid"><label>字幕内容<select value={settings.mode} onChange={(event) => updateSubtitle({ mode: event.target.value as SubtitlePreferences['mode'] })}><option value="assistant">只显示 AI</option><option value="user">只显示我</option><option value="both">显示双方</option></select></label><label>双方布局<select value={settings.layout} onChange={(event) => updateSubtitle({ layout: event.target.value as SubtitlePreferences['layout'] })}><option value="split">AI 左、我右</option><option value="same-side">同侧显示</option></select></label><label>背景<select value={settings.background} onChange={(event) => updateSubtitle({ background: event.target.value as SubtitlePreferences['background'] })}><option value="glass">半透明磨砂</option><option value="solid">纯色底板</option><option value="transparent">完全透明</option></select></label><label>背景颜色<input type="color" value={settings.backgroundColor} onChange={(event) => updateSubtitle({ backgroundColor: event.target.value })}/></label><label>背景透明度 <output>{Math.round(settings.backgroundOpacity * 100)}%</output><input type="range" min="0.1" max="1" step="0.05" value={settings.backgroundOpacity} onChange={(event) => updateSubtitle({ backgroundOpacity: Number(event.target.value) })}/></label><label>持续显示行数<select value={settings.maxLines} onChange={(event) => updateSubtitle({ maxLines: Number(event.target.value) })}>{[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 行</option>)}</select></label><label>字号 <output>{settings.fontSize}px</output><input type="range" min="18" max="38" value={settings.fontSize} onChange={(event) => updateSubtitle({ fontSize: Number(event.target.value) })}/></label><label>整体透明度 <output>{Math.round(settings.opacity * 100)}%</output><input type="range" min="0.55" max="1" step="0.05" value={settings.opacity} onChange={(event) => updateSubtitle({ opacity: Number(event.target.value) })}/></label><label>AI 字幕颜色<input type="color" value={settings.assistantColor} onChange={(event) => updateSubtitle({ assistantColor: event.target.value })}/></label><label>我的字幕颜色<input type="color" value={settings.userColor} onChange={(event) => updateSubtitle({ userColor: event.target.value })}/></label><label className="check-label"><input type="checkbox" checked={settings.locked} onChange={(event) => updateSubtitle({ locked: event.target.checked })}/>锁定字幕位置和操作</label></div>
      <section className="archive-directory"><h2>麦克风快捷键</h2><p>点击输入框后直接按下按键组合。它是系统全局快捷键，在 ChatGPT 网页获得焦点时也会生效。</p><input className="shortcut-input" aria-label="麦克风快捷键" value={shortcutDraft} readOnly onKeyDown={(event) => void recordMicrophoneShortcut(event)}/>{shortcutError && <small role="alert">{shortcutError}</small>}</section>
      <section className="archive-directory"><h2>本地归档</h2><p>练习中会持续写入此文件夹根目录的 current-practice.md；复盘完成后，它会改名为一份包含对话、收藏词和复盘的 Markdown。</p><output title={archiveDirectory}>{archiveDirectory || '正在读取…'}</output><button className="quiet-action" disabled={Boolean(session) || transitionBusy} onClick={() => void chooseArchiveDirectory()}>选择文件夹</button>{(session || transitionBusy) && <small>请先结束当前练习再切换。</small>}</section>
      <section className="archive-directory speech-assets"><h2>阿里语音辅助组件</h2><p>声音识别固定由阿里 Fun-ASR 完成；本地只保留小型 Silero VAD 负责开口检测和抢话，Kokoro 负责 AI 朗读。组件不会放进安装包，下载后保存在应用安装目录。</p>{(['vad', 'tts'] as const).map((asset) => <div key={asset}><strong>{asset === 'vad' ? 'Silero VAD · 开口检测与抢话' : 'Kokoro · 本地中英朗读'}</strong><span>{speechAssetStatus(speechAssets[asset])}</span><progress max={1} value={speechAssets[asset].progress}/>{speechAssets[asset].error && <small role="alert">{speechAssets[asset].error}</small>}</div>)}{speechModelsReady ? <small>阿里语音工作流所需组件已就绪。</small> : <>{speechRemainingMegabytes > 0 && <small>还需下载约 {speechRemainingMegabytes} MB。</small>}<button className="quiet-action" disabled={speechModelsDownloading} onClick={() => void downloadSpeechModels()}>{speechModelsDownloading ? '正在下载语音组件…' : speechDownloadButton}</button></>}</section>
      <form key={JSON.stringify(providers)} className="provider-form" onSubmit={(event) => { event.preventDefault(); void saveProviders(event.currentTarget) }}><h2>对话大模型</h2><p>DeepSeek 或其他 OpenAI-compatible 文本接口负责生成回复和练习复盘，不负责麦克风识别。</p><label>兼容接口 Base URL<input name="llmBaseUrl" defaultValue={providers?.llmBaseUrl} placeholder="https://api.deepseek.com/v1"/></label><label>模型名<input name="llmModel" defaultValue={providers?.llmModel} placeholder="deepseek-chat"/></label><label>LLM API Key<input name="llmApiKey" type="password" placeholder={providers?.hasLlmKey ? '已保存' : '填写 API Key'}/></label><div className="model-probe"><button className="quiet-action" type="button" disabled={modelProbeState === 'probing'} onClick={(event) => { const form = event.currentTarget.form; if (form) void probeProviderModels(form) }}>{modelProbeState === 'probing' ? '正在探测…' : '探测可用模型'}</button>{modelProbeMessage && <small role={modelProbeState === 'error' ? 'alert' : 'status'}>{modelProbeMessage}</small>}{discoveredModels.length > 0 && <div className="model-options" aria-label="可用模型">{discoveredModels.map((model) => <button key={model} type="button" onClick={(event) => { const input = event.currentTarget.form?.elements.namedItem('llmModel'); if (input instanceof HTMLInputElement) { input.value = model; input.focus() } }}>{model}</button>)}</div>}</div><label className="check-label"><input name="clearLlmApiKey" type="checkbox"/>清除已保存的 LLM Key</label><h2>阿里语音识别</h2><p>声音转字幕固定使用阿里 Fun-ASR；DeepSeek 对话和本地 Kokoro 朗读保持不变。</p><div className="aliyun-key-row"><label>阿里 DashScope API Key<input name="aliyunAsrApiKey" type="password" placeholder={providers?.hasAliyunAsrKey ? '已保存' : '填写阿里语音识别 Key'}/></label><button className="quiet-action aliyun-help-trigger" type="button" onClick={() => setAliyunHelpOpen(true)}>如何获取</button></div><label className="check-label"><input name="clearAliyunAsrApiKey" type="checkbox"/>清除已保存的阿里 Key</label><div className="speech-usage"><strong>阿里识别用量</strong><span>本次 {speechUsage.sessionSeconds} 秒 · {speechUsage.month || '本月'}累计 {speechUsage.monthlySeconds} 秒</span><small>按目录价估算 ¥{speechUsage.estimatedCny.toFixed(2)}；实际账单以阿里控制台为准。</small></div>{session && <small>请先结束当前练习，再修改 API 或语音识别设置。</small>}<button className="primary-action" type="submit" disabled={Boolean(session)}>保存设置</button></form>
    </section>}
  </section>{aliyunHelpOpen && <div className="confirm-layer aliyun-help-dialog" role="dialog" aria-modal="true" aria-labelledby="aliyun-help-title"><div><header className="aliyun-help-header"><div><p className="kicker">DASHSCOPE API</p><h2 id="aliyun-help-title">如何开通阿里语音识别</h2><p>第一次配置照着下面四步做即可。</p></div><button className="template-editor-close" type="button" aria-label="关闭阿里 API 帮助" title="关闭" onClick={() => setAliyunHelpOpen(false)}>×</button></header><ol><li><strong>注册或登录阿里云</strong><span>打开百炼控制台，按提示开通模型服务；区域选择“华北 2（北京）”。</span></li><li><strong>创建通用 API Key</strong><span>进入 API Key 页面，在默认业务空间创建按量付费 Key。不要使用 Token Plan / Coding Plan 的 <code>sk-sp-</code> 专属 Key。</span></li><li><strong>立即复制保存</strong><span>完整 Key 只在创建成功时显示一次。复制后粘贴到上面的输入框。</span></li><li><strong>回到这里保存</strong><span>识别服务选择“阿里 Fun-ASR”，再点击“保存设置”。</span></li></ol><div className="aliyun-help-actions"><a className="primary-action" href={ALIYUN_HELP_LINKS.console} target="_blank" rel="noreferrer">打开百炼控制台 ↗</a><a className="quiet-action" href={ALIYUN_HELP_LINKS.apiKeyGuide} target="_blank" rel="noreferrer">查看官方教程 ↗</a><a className="quiet-action" href={ALIYUN_HELP_LINKS.freeQuotaGuide} target="_blank" rel="noreferrer">查看免费额度 ↗</a></div><p className="aliyun-help-note"><strong>费用提醒：</strong>新用户通常有免费额度，具体额度和有效期以控制台为准。担心超额时，可在百炼控制台开启“免费额度用完即停”。</p></div></div>}{templateEditor && templateDraft && <div className="confirm-layer template-editor" role="dialog" aria-modal="true" aria-labelledby="template-editor-title"><div><header className="template-editor-header"><div><p className="kicker">PROMPT LIBRARY</p><h2 id="template-editor-title">管理提示词</h2><p>名称显示在练习台；提示词会原样以中文发送给 AI。</p></div><button className="template-editor-close" type="button" aria-label="关闭提示词管理" title="关闭" onClick={closeTemplateEditor}>×</button></header><div className="template-editor-list">{templateDraft[templateEditor].map((item, index) => <div key={item.id}><input value={item.name} aria-label="提示词名称" onChange={(event) => setTemplateDraft((current) => current && ({ ...current, [templateEditor]: current[templateEditor].map((value, position) => position === index ? { ...value, name: event.target.value } : value) }))}/><textarea value={item.prompt} aria-label="提示词内容" rows={4} onChange={(event) => setTemplateDraft((current) => current && ({ ...current, [templateEditor]: current[templateEditor].map((value, position) => position === index ? { ...value, prompt: event.target.value } : value) }))}/><button className="danger-action" disabled={templateDraft[templateEditor].length === 1} onClick={() => setTemplateDraft((current) => current && ({ ...current, [templateEditor]: current[templateEditor].filter((_, position) => position !== index) }))}>删除</button></div>)}</div><button className="quiet-action" onClick={() => setTemplateDraft((current) => current && ({ ...current, [templateEditor]: [...current[templateEditor], { id: `${templateEditor}-${Date.now()}`, name: '新提示词', prompt: '请填写中文提示词。' }] }))}>添加自定义提示词</button><footer><button className="quiet-action" onClick={closeTemplateEditor}>取消</button><button className="primary-action" onClick={() => void saveTemplates()}>保存</button></footer></div></div>}</main>
}
