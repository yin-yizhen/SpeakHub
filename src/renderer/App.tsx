import { useEffect, useMemo, useRef, useState } from 'react'
import type { AutomationStatus, ConnectionState, CorrectionStrength, MicrophoneGateState, NextPracticeDraft, PracticeLifecycle, PracticeMode, PracticePreferences, PracticeSource, PromptTemplateCategory, PromptTemplates, ProviderSettings, ReviewResult, SpeechAssetState, SubtitlePreferences, TranscriptEvent, VoiceTurnPhase } from '../shared/types'
import { LocalSpeechAudioCapture, LocalSpeechAudioPlayer, playMicrophoneToggleTone } from './local-speech-audio'
import { isPracticeTransitionBusy } from './app-state'
import { LearningCenter } from './LearningCenter'
import { shortcutFromKeyboardEvent } from '../main/microphone-shortcut'

const brandIcon = new URL('./assets/app-icon.png', import.meta.url).href

const sourceLabels: Record<PracticeSource, string> = { 'chatgpt-web': 'ChatGPT 网页', 'api-direct': 'API 直连' }
const defaultSubtitleSettings: SubtitlePreferences = { mode: 'assistant', layout: 'split', background: 'glass', backgroundColor: '#0e1713', backgroundOpacity: 0.86, assistantColor: '#f1f6f3', userColor: '#fff1c9', fontSize: 25, opacity: 0.94, locked: false, visible: false, maxLines: 4 }
const defaultMicrophone: MicrophoneGateState = { active: false, available: false, shortcut: 'F8' }
const defaultSpeechAssets: SpeechAssetState = {
  asr: { status: 'missing', downloadedBytes: 0, totalBytes: 0, progress: 0 },
  tts: { status: 'missing', downloadedBytes: 0, totalBytes: 0, progress: 0 }
}

function remainingBytes(asset: SpeechAssetState['asr']): number {
  return asset.status === 'ready' ? 0 : Math.max(0, asset.totalBytes - asset.downloadedBytes)
}

function speechDownloadAction(assets: SpeechAssetState, retry = false): string {
  const asrRemaining = remainingBytes(assets.asr)
  const ttsRemaining = remainingBytes(assets.tts)
  const megabytes = Math.max(1, Math.round((asrRemaining + ttsRemaining) / 1_000_000))
  const whisperOnly = asrRemaining > 0 && assets.asr.downloadedBytes > 0 && ttsRemaining === 0
  if (whisperOnly) return `${retry ? '重试补下载' : '补下载'} Whisper 校正与 VAD（约 ${megabytes} MB）`
  return `${retry ? '重试下载' : '下载'}缺失语音模型（约 ${megabytes} MB）`
}

function speechAssetStatus(asset: SpeechAssetState['asr']): string {
  if (asset.status === 'downloading') return `${Math.round(asset.progress * 100)}%`
  if (asset.status === 'ready') return '已就绪'
  if (asset.status === 'error') return '下载失败'
  return asset.downloadedBytes > 0 ? `需补全 · 已有 ${Math.round(asset.progress * 100)}%` : '未下载'
}

export function App() {
  const [settings, setSettings] = useState<SubtitlePreferences>(defaultSubtitleSettings)
  const [connection, setConnection] = useState<ConnectionState>({ ready: false, pageVisible: true, activeProvider: 'chatgpt-web', providers: { 'chatgpt-web': false } })
  const [automation, setAutomation] = useState<AutomationStatus>({ phase: 'idle', message: '正在准备练习。' })
  const [session, setSession] = useState<string>()
  const [events, setEvents] = useState<TranscriptEvent[]>([])
  const [source, setSource] = useState<PracticeSource>('chatgpt-web')
  const [mode, setMode] = useState<PracticeMode>('voice')
  const [strength, setStrength] = useState<CorrectionStrength>('normal')
  const [topic, setTopic] = useState('日常聊天')
  const [level, setLevel] = useState('A1')
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
      setSettings(state.settings); setConnection(state.connection); setAutomation(state.automation); setSession(state.session?.id); setEvents(state.events); setProviders(provider); setSource(preferences.source); setMode(preferences.mode); setLifecycle(state.lifecycle); setArchiveDirectory(directory); setMicrophone(state.microphone); setShortcutDraft(state.microphone.shortcut); setSpeechAssets(state.speechAssets); setVoicePhase(state.voicePhase); setTemplates(promptTemplates); setSelectedTemplates(selected); setFocus(preferences.focus); setFocusEnabled(preferences.focusEnabled)
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
    const removeVoicePhase = window.speaksub.onVoicePhase(setVoicePhase)
    const removeMicrophone = window.speaksub.onMicrophoneGateState((next) => {
      if (next.available && next.active !== previousMicrophoneActive.current) playMicrophoneToggleTone(next.active)
      previousMicrophoneActive.current = next.active
      setMicrophone(next); setShortcutDraft(next.shortcut)
    })
    return () => { capture.current.stop(); player.current.stop(); removeTranscript(); removeSettings(); removeAutomation(); removePracticeEnded(); removeConnection(); removeVoiceAudio(); removeVoiceInterrupt(); removeSpeechAssets(); removeVoicePhase(); removeMicrophone() }
  }, [])

  const latestAssistantEvent = useMemo(() => [...events].reverse().find((event) => event.speaker === 'assistant'), [events])
  const latestAssistant = latestAssistantEvent?.text ?? ''
  const latestUser = useMemo(() => [...events].reverse().find((event) => event.speaker === 'user')?.text ?? '', [events])
  const updateSubtitle = (input: Partial<SubtitlePreferences>) => void window.speaksub.updateSubtitle(input)
  const isWebSource = source !== 'api-direct'
  const transitionBusy = isPracticeTransitionBusy(lifecycle)
  const apiConfigured = Boolean(providers?.llmBaseUrl?.trim() && providers.llmModel?.trim() && providers.hasLlmKey)
  const speechModelsReady = speechAssets.asr.status === 'ready' && speechAssets.tts.status === 'ready'
  const speechModelsDownloading = speechAssets.asr.status === 'downloading' || speechAssets.tts.status === 'downloading'
  const speechDownloadButton = speechDownloadAction(speechAssets, speechAssets.asr.status === 'error' || speechAssets.tts.status === 'error')
  const speechRemainingBytes = remainingBytes(speechAssets.asr) + remainingBytes(speechAssets.tts)
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
    if (nextMode === 'voice' && !speechModelsReady) {
      setTab('settings')
      setAutomation({ phase: 'failed', message: `文字 API 需要本地语音模型才能进行语音交流。请${speechDownloadAction(speechAssets)}。`, recoverable: true })
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
    const data = new FormData(form)
    const saved = await window.speaksub.saveProviderSettings({ llmBaseUrl: String(data.get('llmBaseUrl') || ''), llmModel: String(data.get('llmModel') || ''), llmApiKey: String(data.get('llmApiKey') || ''), clearLlmApiKey: data.get('clearLlmApiKey') === 'on' })
    setProviders(saved)
    const configured = Boolean(saved.llmBaseUrl?.trim() && saved.llmModel?.trim() && saved.hasLlmKey)
    if (configured && source === 'api-direct' && mode === 'voice' && !speechModelsReady) setAutomation({ phase: 'failed', message: `文本 API 已配置。继续点击上方按钮${speechDownloadAction(speechAssets)}。`, recoverable: true })
    else setAutomation({ phase: 'idle', message: configured ? '文本 API 已配置。' : 'API 设置已保存，但信息尚未填写完整。' })
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
      setAutomation({ phase: 'idle', message: '本地双语语音模型已下载完成，可以使用 API 语音交流。' })
    } catch (error) {
      setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '模型下载失败。', recoverable: true })
    }
  }
  async function chooseArchiveDirectory(): Promise<void> { try { const directory = await window.speaksub.chooseArchiveDirectory(); if (!directory) return; setArchiveDirectory(directory) } catch (error) { setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法切换归档文件夹。', recoverable: true }) } }
  function useNextPracticeDraft(draft: NextPracticeDraft): void { const nextFocus = draft.focus ?? ''; const nextFocusEnabled = Boolean(draft.focus); setTopic(draft.topic); setLevel(draft.level); setStrength(draft.correctionStrength); setSource(draft.source); setMode(draft.mode); setFocus(nextFocus); setFocusEnabled(nextFocusEnabled); savePracticePreferences({ source: draft.source, mode: draft.mode, focus: nextFocus, focusEnabled: nextFocusEnabled }); setTab('practice'); setAutomation({ phase: 'idle', message: '已根据上次薄弱点准备好练习，请确认后开始。' }) }
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

  if (connection.pageVisible) return <main className="connection-shell"><section className="connection-panel">
    <div className="brand-lockup"><img className="brand-icon" src={brandIcon} alt="" /><span className="brand-copy"><strong>SpeakHub</strong><em>personal practice</em></span></div><p className="kicker">WEB MODEL CONNECTION</p>
    <h1>{connection.ready ? '连接页面已打开' : '先登录你的 ChatGPT'}</h1>
    <p>右侧页面用于登录和恢复网页模式。完成登录后回到 SpeakSub，选择难度并开始对话。</p>
    <div className="connection-steps"><span>01 登录 ChatGPT</span><span>02 确认账号状态</span><span>03 进入练习台</span></div>
    {connection.ready ? <button className="primary-action" onClick={() => void window.speaksub.hideConnectionPage()}>返回练习台</button> : <button className="primary-action" onClick={() => void enterPractice()}>我已登录，进入练习台</button>}<button className="quiet-action connection-skip" onClick={() => void skipWebConnection()}>先使用 API 直连</button>
  </section></main>

  return <main className="studio-shell"><header className="studio-topbar">
    <div className="brand-lockup"><img className="brand-icon" src={brandIcon} alt="" /><span className="brand-copy"><strong>SpeakHub</strong><em>personal practice</em></span></div><div className="top-actions">
      <button className={settings.visible ? 'subtitle-toggle active' : 'subtitle-toggle'} onClick={() => void window.speaksub.toggleOverlay()}>{settings.visible ? '隐藏字幕' : '显示字幕'}</button>
      {settings.locked && <button className="subtitle-unlock-action" onClick={() => updateSubtitle({ locked: false })}>解锁字幕</button>}
      {isWebSource && <button className="quiet-action" onClick={() => void openConnection()}>连接页</button>}
    </div>
  </header><aside className="studio-nav"><button className={tab === 'practice' ? 'active' : ''} onClick={() => setTab('practice')}>练习</button><button className={tab === 'learning' ? 'active' : ''} onClick={() => setTab('learning')}>学习</button><button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>设置</button></aside>
  <section className="studio-content">
    {tab === 'practice' && <>
      <section className="practice-stage"><div className="stage-copy"><p className="kicker">SPEAKING SESSION</p><h1>{session ? '正在对话…' : '准备开口。'}</h1><p>{session ? (source === 'api-direct' ? '本地识别与朗读已接入流式 API、字幕和归档。' : `${sourceLabels[source]} 在后台保持运行，字幕可随时显示。`) : '选择来源、场景和难度，然后开始一次练习。'}</p></div><div className="automation-card"><span className={`status-dot ${automation.phase}`}></span><div><small>{source === 'api-direct' && mode === 'voice' ? voicePhase : automation.phase.replaceAll('-', ' ')}</small><strong>{automation.message}</strong></div>{automation.recoverable && isWebSource && <button onClick={() => void openConnection()}>打开连接页</button>}{automation.recoverable && isWebSource && <button onClick={() => void clearPendingCleanup()}>已处理旧对话</button>}</div></section>
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
      <section className="archive-directory speech-assets"><h2>本地双语语音模型</h2><p>语音模型不会包含在安装包中。全新下载约 406 MB，解压后占用约 476 MB；应用会自动复用已校验文件，只下载当前缺失部分。</p>{(['asr', 'tts'] as const).map((asset) => <div key={asset}><strong>{asset === 'asr' ? '流式识别 + Whisper 校正 + 本地 VAD' : 'Kokoro 中英朗读'}</strong><span>{speechAssetStatus(speechAssets[asset])}</span><progress max={1} value={speechAssets[asset].progress}/>{speechAssets[asset].error && <small role="alert">{speechAssets[asset].error}</small>}</div>)}{speechModelsReady ? <small>模型已就绪，API 和模型配置完整后可以直接使用。</small> : <>{speechRemainingMegabytes > 0 && <small>本机还需下载约 {speechRemainingMegabytes} MB。</small>}<button className="quiet-action" disabled={speechModelsDownloading} onClick={() => void downloadSpeechModels()}>{speechModelsDownloading ? '正在下载语音模型…' : speechDownloadButton}</button></>}</section>
      <form key={JSON.stringify(providers)} className="provider-form" onSubmit={(event) => { event.preventDefault(); void saveProviders(event.currentTarget) }}><h2>API 直连与复盘</h2><p>只需填写 DeepSeek 或其他 OpenAI-compatible 文本接口；本地语音识别与朗读不需要第二个云端账号。</p><label>兼容接口 Base URL<input name="llmBaseUrl" defaultValue={providers?.llmBaseUrl} placeholder="https://api.deepseek.com/v1"/></label><label>模型名<input name="llmModel" defaultValue={providers?.llmModel} placeholder="deepseek-chat"/></label><label>LLM API Key<input name="llmApiKey" type="password" placeholder={providers?.hasLlmKey ? '已保存' : '填写 API Key'}/></label><div className="model-probe"><button className="quiet-action" type="button" disabled={modelProbeState === 'probing'} onClick={(event) => { const form = event.currentTarget.form; if (form) void probeProviderModels(form) }}>{modelProbeState === 'probing' ? '正在探测…' : '探测可用模型'}</button>{modelProbeMessage && <small role={modelProbeState === 'error' ? 'alert' : 'status'}>{modelProbeMessage}</small>}{discoveredModels.length > 0 && <div className="model-options" aria-label="可用模型">{discoveredModels.map((model) => <button key={model} type="button" onClick={(event) => { const input = event.currentTarget.form?.elements.namedItem('llmModel'); if (input instanceof HTMLInputElement) { input.value = model; input.focus() } }}>{model}</button>)}</div>}</div><label className="check-label"><input name="clearLlmApiKey" type="checkbox"/>清除已保存的 API Key</label><button className="primary-action" type="submit">保存设置</button></form>
    </section>}
  </section>{templateEditor && templateDraft && <div className="confirm-layer template-editor" role="dialog" aria-modal="true" aria-labelledby="template-editor-title"><div><header className="template-editor-header"><div><p className="kicker">PROMPT LIBRARY</p><h2 id="template-editor-title">管理提示词</h2><p>名称显示在练习台；提示词会原样以中文发送给 AI。</p></div><button className="template-editor-close" type="button" aria-label="关闭提示词管理" title="关闭" onClick={closeTemplateEditor}>×</button></header><div className="template-editor-list">{templateDraft[templateEditor].map((item, index) => <div key={item.id}><input value={item.name} aria-label="提示词名称" onChange={(event) => setTemplateDraft((current) => current && ({ ...current, [templateEditor]: current[templateEditor].map((value, position) => position === index ? { ...value, name: event.target.value } : value) }))}/><textarea value={item.prompt} aria-label="提示词内容" rows={4} onChange={(event) => setTemplateDraft((current) => current && ({ ...current, [templateEditor]: current[templateEditor].map((value, position) => position === index ? { ...value, prompt: event.target.value } : value) }))}/><button className="danger-action" disabled={templateDraft[templateEditor].length === 1} onClick={() => setTemplateDraft((current) => current && ({ ...current, [templateEditor]: current[templateEditor].filter((_, position) => position !== index) }))}>删除</button></div>)}</div><button className="quiet-action" onClick={() => setTemplateDraft((current) => current && ({ ...current, [templateEditor]: [...current[templateEditor], { id: `${templateEditor}-${Date.now()}`, name: '新提示词', prompt: '请填写中文提示词。' }] }))}>添加自定义提示词</button><footer><button className="quiet-action" onClick={closeTemplateEditor}>取消</button><button className="primary-action" onClick={() => void saveTemplates()}>保存</button></footer></div></div>}</main>
}
