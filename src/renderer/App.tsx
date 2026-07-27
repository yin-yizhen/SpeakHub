import { useEffect, useMemo, useRef, useState } from 'react'
import type { AutomationStatus, ConnectionState, CorrectionStrength, MicrophoneGateState, NextPracticeDraft, PracticeLifecycle, PracticeMode, PracticeSource, ProviderSettings, ReviewResult, SpeechAssetState, SubtitlePreferences, TranscriptEvent, VoiceTurnPhase } from '../shared/types'
import { LocalSpeechAudioCapture, LocalSpeechAudioPlayer, playMicrophoneToggleTone } from './local-speech-audio'
import { isPracticeTransitionBusy } from './app-state'
import { LearningCenter } from './LearningCenter'
import { shortcutFromKeyboardEvent } from '../main/microphone-shortcut'

const topics = ['日常聊天', '旅行英语', '面试英语', '职场会议', '雅思口语', '自由闲聊', '情景角色扮演']
const levels = ['A1', 'A2', 'B1', 'B2', 'C1']
const sourceLabels: Record<PracticeSource, string> = { 'chatgpt-web': 'ChatGPT 网页', 'api-direct': 'API 直连' }
const defaultSubtitleSettings: SubtitlePreferences = { mode: 'assistant', layout: 'split', background: 'glass', backgroundColor: '#0e1713', backgroundOpacity: 0.86, assistantColor: '#f1f6f3', userColor: '#fff1c9', fontSize: 25, opacity: 0.94, locked: false, visible: false, maxLines: 4 }
const defaultMicrophone: MicrophoneGateState = { active: false, available: false, shortcut: 'F8' }
const defaultSpeechAssets: SpeechAssetState = {
  asr: { status: 'missing', downloadedBytes: 0, totalBytes: 0, progress: 0 },
  tts: { status: 'missing', downloadedBytes: 0, totalBytes: 0, progress: 0 }
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
  const [apiMessage, setApiMessage] = useState('')
  const [apiBusy, setApiBusy] = useState(false)
  const [tab, setTab] = useState<'practice' | 'learning' | 'settings'>('practice')
  const [review, setReview] = useState<ReviewResult>()
  const [providers, setProviders] = useState<ProviderSettings>()
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
    void Promise.all([window.speaksub.getState(), window.speaksub.getProviderSettings(), window.speaksub.getArchiveDirectory()]).then(([state, provider, directory]) => {
      setSettings(state.settings); setConnection(state.connection); setAutomation(state.automation); setSession(state.session?.id); setEvents(state.events); setProviders(provider); setSource(state.source); setMode(state.mode); setLifecycle(state.lifecycle); setArchiveDirectory(directory); setMicrophone(state.microphone); setShortcutDraft(state.microphone.shortcut); setSpeechAssets(state.speechAssets); setVoicePhase(state.voicePhase)
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
    const removeVoiceInterrupt = window.speaksub.onVoiceInterrupt(() => player.current.interrupt())
    const removeSpeechAssets = window.speaksub.onSpeechAssetState(setSpeechAssets)
    const removeVoicePhase = window.speaksub.onVoicePhase(setVoicePhase)
    const removeMicrophone = window.speaksub.onMicrophoneGateState((next) => {
      if (next.available && next.active !== previousMicrophoneActive.current) playMicrophoneToggleTone(next.active)
      previousMicrophoneActive.current = next.active
      setMicrophone(next); setShortcutDraft(next.shortcut)
    })
    return () => { capture.current.stop(); player.current.stop(); removeTranscript(); removeSettings(); removeAutomation(); removePracticeEnded(); removeConnection(); removeVoiceAudio(); removeVoiceInterrupt(); removeSpeechAssets(); removeVoicePhase(); removeMicrophone() }
  }, [])

  const latestAssistant = useMemo(() => [...events].reverse().find((event) => event.speaker === 'assistant')?.text ?? '', [events])
  const latestUser = useMemo(() => [...events].reverse().find((event) => event.speaker === 'user')?.text ?? '', [events])
  const updateSubtitle = (input: Partial<SubtitlePreferences>) => void window.speaksub.updateSubtitle(input)
  const isWebSource = source !== 'api-direct'
  const transitionBusy = isPracticeTransitionBusy(lifecycle)
  const apiConfigured = Boolean(providers?.llmBaseUrl?.trim() && providers.llmModel?.trim() && providers.hasLlmKey)
  const speechModelsReady = speechAssets.asr.status === 'ready' && speechAssets.tts.status === 'ready'
  const speechModelsDownloading = speechAssets.asr.status === 'downloading' || speechAssets.tts.status === 'downloading'

  useEffect(() => {
    if (!session || source !== 'api-direct' || mode !== 'voice' || lifecycle !== 'active') { capture.current.stop(); return }
    if (!microphone.active || voicePhase !== 'listening') { capture.current.stop(); void window.speaksub.stopVoiceCapture(); return }
    let disposed = false
    void (async () => {
      try {
        await window.speaksub.startVoiceCapture()
        await capture.current.start((chunk) => void window.speaksub.sendVoiceAudio(chunk))
      } catch (error) {
        if (disposed) return
        capture.current.stop(); void window.speaksub.setMicrophoneGate(false)
        setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法开启本地麦克风。', recoverable: true })
      }
    })()
    return () => { disposed = true }
  }, [session, source, mode, lifecycle, microphone.active, voicePhase])

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
      setAutomation({ phase: 'failed', message: '文字 API 需要本地语音模型才能进行语音交流。请下载约 265 MB 模型。', recoverable: true })
      return false
    }
    return true
  }
  function selectSource(next: PracticeSource): void {
    setSource(next)
    requireApiVoiceSetup(next, mode)
  }
  function selectMode(next: PracticeMode): void {
    setMode(next)
    requireApiVoiceSetup(source, next)
  }
  async function startPractice(): Promise<void> {
    if (lifecycle === 'starting' || lifecycle === 'ending') return
    if (!requireApiVoiceSetup(source, mode)) return
    setLifecycle('starting')
    try {
      setAutomation({ phase: 'filling-prompt', message: source === 'api-direct' ? '正在创建 API 直连练习…' : `正在启动 ${sourceLabels[source]} 练习…` })
      const result = await window.speaksub.startPractice(topic, level, strength, source, mode, focus || undefined)
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
    if (configured && source === 'api-direct' && mode === 'voice' && !speechModelsReady) setAutomation({ phase: 'failed', message: '文本 API 已配置。继续点击上方按钮下载约 265 MB 本地语音模型。', recoverable: true })
    else setAutomation({ phase: 'idle', message: configured ? '文本 API 已配置。' : 'API 设置已保存，但信息尚未填写完整。' })
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
  function useNextPracticeDraft(draft: NextPracticeDraft): void { setTopic(draft.topic); setLevel(draft.level); setStrength(draft.correctionStrength); setSource(draft.source); setMode(draft.mode); setFocus(draft.focus ?? ''); setTab('practice'); setAutomation({ phase: 'idle', message: '已根据上次薄弱点准备好练习，请确认后开始。' }) }

  if (connection.pageVisible) return <main className="connection-shell"><section className="connection-panel">
    <div className="brand-lockup"><span>S</span><strong>SpeakSub</strong></div><p className="kicker">WEB MODEL CONNECTION</p>
    <h1>{connection.ready ? '连接页面已打开' : '先登录你的 ChatGPT'}</h1>
    <p>右侧页面用于登录和恢复网页模式。完成登录后回到 SpeakSub，选择难度并开始对话。</p>
    <div className="connection-steps"><span>01 登录 ChatGPT</span><span>02 确认账号状态</span><span>03 进入练习台</span></div>
    {connection.ready ? <button className="primary-action" onClick={() => void window.speaksub.hideConnectionPage()}>返回练习台</button> : <button className="primary-action" onClick={() => void enterPractice()}>我已登录，进入练习台</button>}<button className="quiet-action connection-skip" onClick={() => void skipWebConnection()}>先使用 API 直连</button>
  </section></main>

  return <main className="studio-shell"><header className="studio-topbar">
    <div className="brand-lockup"><span>S</span><strong>SpeakSub</strong><em>personal practice</em></div><div className="top-actions">
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
        <div className="topic-grid">{topics.map((item) => <button key={item} disabled={Boolean(session) || transitionBusy} className={topic === item ? 'topic active' : 'topic'} onClick={() => setTopic(item)}>{item}</button>)}</div>
        <div className="session-config"><div className="level-picker"><span>难度</span>{levels.map((item) => <button key={item} disabled={Boolean(session) || transitionBusy} className={level === item ? 'active' : ''} onClick={() => setLevel(item)}>{item}</button>)}</div><label>纠错<select value={strength} disabled={Boolean(session) || transitionBusy} onChange={(event) => setStrength(event.target.value as CorrectionStrength)}><option value="light">轻度</option><option value="normal">普通</option><option value="strict">严格</option></select></label>{session ? <button className="finish-action" disabled={transitionBusy} onClick={() => void endPractice()}>{lifecycle === 'ending' ? '正在生成复盘…' : '结束并生成复盘'}</button> : <button className="primary-action" disabled={transitionBusy} onClick={() => void startPractice()}>{lifecycle === 'starting' ? '正在启动…' : '确认并开始'}</button>}</div>
        {!session && focus && <label className="practice-focus">本次重点<textarea value={focus} onChange={(event) => setFocus(event.target.value)} rows={3}/><small>来自上次复盘，可在开始前修改。</small></label>}
        {session && source === 'api-direct' && mode === 'text' && <div className="api-composer"><textarea value={apiMessage} disabled={apiBusy} onChange={(event) => setApiMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendApiMessage() } }} placeholder="用英语输入你的回答…" rows={3}/><button className="primary-action" disabled={apiBusy || !apiMessage.trim()} onClick={() => void sendApiMessage()}>{apiBusy ? '正在回复…' : '发送'}</button></div>}
        {session && mode === 'voice' && <div className="api-composer microphone-control"><div><strong>{microphone.active ? (source === 'api-direct' && voicePhase !== 'listening' ? '正在等待 AI，麦克风已临时停采' : '麦克风已开启') : '麦克风已暂停'}</strong><span>按 {microphone.shortcut} 开启或暂停；API 语音会在 AI 生成和朗读时自动半双工停采，结束后恢复。</span></div><button className={microphone.active ? 'finish-action' : 'primary-action'} type="button" onClick={() => void toggleMicrophone()}>{microphone.active ? `暂停麦克风 · ${microphone.shortcut}` : `开启麦克风 · ${microphone.shortcut}`}</button></div>}
      </section>
      <section className="support-row"><div className="compact-panel"><div><p className="kicker">LIVE SUBTITLES</p><h3>{settings.visible ? '悬浮字幕已显示' : '悬浮字幕暂未显示'}</h3><p>主页面和悬浮窗使用同一组字幕事件。</p></div><button className="quiet-action" onClick={() => void window.speaksub.toggleOverlay()}>{settings.visible ? '隐藏' : '显示'}</button></div><div className="compact-panel transcript-preview dual-transcript"><div><p className="kicker">我</p><p>{latestUser || '开始说话后，中英混合识别字幕会显示在这里。'}</p></div><div><p className="kicker">AI</p><p>{latestAssistant || 'DeepSeek 的流式回复会逐步显示在这里。'}</p></div></div></section>
      {review && <section className="review-panel"><p className="kicker">SESSION REVIEW</p><h2>{review.topic}</h2><p>{review.summary}</p>{review.issues.slice(0, 3).map((issue, index) => <div className="review-issue" key={index}><span>{issue.original}</span><strong>{issue.improved}</strong><small>{issue.reason}</small></div>)}</section>}
    </>}
    {tab === 'learning' && <LearningCenter onUseDraft={useNextPracticeDraft}/>}
    {tab === 'settings' && <section className="utility-page settings-page"><p className="kicker">SPEAKSUB CONTROLS</p><h1>设置</h1>{automation.recoverable && <div className="settings-guidance" role="alert">{automation.message}</div>}<div className="settings-grid"><label>字幕内容<select value={settings.mode} onChange={(event) => updateSubtitle({ mode: event.target.value as SubtitlePreferences['mode'] })}><option value="assistant">只显示 AI</option><option value="user">只显示我</option><option value="both">显示双方</option></select></label><label>双方布局<select value={settings.layout} onChange={(event) => updateSubtitle({ layout: event.target.value as SubtitlePreferences['layout'] })}><option value="split">AI 左、我右</option><option value="same-side">同侧显示</option></select></label><label>背景<select value={settings.background} onChange={(event) => updateSubtitle({ background: event.target.value as SubtitlePreferences['background'] })}><option value="glass">半透明磨砂</option><option value="solid">纯色底板</option><option value="transparent">完全透明</option></select></label><label>背景颜色<input type="color" value={settings.backgroundColor} onChange={(event) => updateSubtitle({ backgroundColor: event.target.value })}/></label><label>背景透明度 <output>{Math.round(settings.backgroundOpacity * 100)}%</output><input type="range" min="0.1" max="1" step="0.05" value={settings.backgroundOpacity} onChange={(event) => updateSubtitle({ backgroundOpacity: Number(event.target.value) })}/></label><label>持续显示行数<select value={settings.maxLines} onChange={(event) => updateSubtitle({ maxLines: Number(event.target.value) })}>{[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 行</option>)}</select></label><label>字号 <output>{settings.fontSize}px</output><input type="range" min="18" max="38" value={settings.fontSize} onChange={(event) => updateSubtitle({ fontSize: Number(event.target.value) })}/></label><label>整体透明度 <output>{Math.round(settings.opacity * 100)}%</output><input type="range" min="0.55" max="1" step="0.05" value={settings.opacity} onChange={(event) => updateSubtitle({ opacity: Number(event.target.value) })}/></label><label>AI 字幕颜色<input type="color" value={settings.assistantColor} onChange={(event) => updateSubtitle({ assistantColor: event.target.value })}/></label><label>我的字幕颜色<input type="color" value={settings.userColor} onChange={(event) => updateSubtitle({ userColor: event.target.value })}/></label><label className="check-label"><input type="checkbox" checked={settings.locked} onChange={(event) => updateSubtitle({ locked: event.target.checked })}/>锁定字幕位置和操作</label></div>
      <section className="archive-directory"><h2>麦克风快捷键</h2><p>点击输入框后直接按下按键组合。它是系统全局快捷键，在 ChatGPT 网页获得焦点时也会生效。</p><input className="shortcut-input" aria-label="麦克风快捷键" value={shortcutDraft} readOnly onKeyDown={(event) => void recordMicrophoneShortcut(event)}/>{shortcutError && <small role="alert">{shortcutError}</small>}</section>
      <section className="archive-directory"><h2>本地归档</h2><p>练习中会持续写入此文件夹根目录的 current-practice.md；复盘完成后，它会改名为一份包含对话、收藏词和复盘的 Markdown。</p><output title={archiveDirectory}>{archiveDirectory || '正在读取…'}</output><button className="quiet-action" disabled={Boolean(session) || transitionBusy} onClick={() => void chooseArchiveDirectory()}>选择文件夹</button>{(session || transitionBusy) && <small>请先结束当前练习再切换。</small>}</section>
      <section className="archive-directory speech-assets"><h2>本地双语语音模型</h2><p>语音模型不会包含在安装包中。点击后约下载 197 MB，解压后在应用安装目录占用约 265 MB；下载完成后可永久离线识别和朗读。</p>{(['asr', 'tts'] as const).map((asset) => <div key={asset}><strong>{asset === 'asr' ? '中英双语识别' : 'Kokoro 中英朗读'}</strong><span>{speechAssets[asset].status === 'downloading' ? `${Math.round(speechAssets[asset].progress * 100)}%` : speechAssets[asset].status}</span><progress max={1} value={speechAssets[asset].progress}/>{speechAssets[asset].error && <small role="alert">{speechAssets[asset].error}</small>}</div>)}{speechModelsReady ? <small>模型已就绪，API 和模型配置完整后可以直接使用。</small> : <button className="quiet-action" disabled={speechModelsDownloading} onClick={() => void downloadSpeechModels()}>{speechModelsDownloading ? '正在下载语音模型…' : speechAssets.asr.status === 'error' || speechAssets.tts.status === 'error' ? '重试下载（约 265 MB）' : '下载语音模型（约 265 MB）'}</button>}</section>
      <form key={JSON.stringify(providers)} className="provider-form" onSubmit={(event) => { event.preventDefault(); void saveProviders(event.currentTarget) }}><h2>API 直连与复盘</h2><p>只需填写 DeepSeek 或其他 OpenAI-compatible 文本接口；本地语音识别与朗读不需要第二个云端账号。</p><label>兼容接口 Base URL<input name="llmBaseUrl" defaultValue={providers?.llmBaseUrl} placeholder="https://api.deepseek.com/v1"/></label><label>模型名<input name="llmModel" defaultValue={providers?.llmModel} placeholder="deepseek-chat"/></label><label>LLM API Key<input name="llmApiKey" type="password" placeholder={providers?.hasLlmKey ? '已保存' : '填写 API Key'}/></label><label className="check-label"><input name="clearLlmApiKey" type="checkbox"/>清除已保存的 API Key</label><button className="primary-action" type="submit">保存设置</button></form>
    </section>}
  </section></main>
}
