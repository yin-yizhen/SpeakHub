import { useEffect, useMemo, useState } from 'react'
import type { AutomationStatus, ConnectionState, CorrectionStrength, DictionaryResult, PracticeSource, ProviderSettings, ReviewResult, SavedStudyItem, SubtitlePreferences, TranscriptEvent } from '../shared/types'

const topics = ['日常聊天', '旅行英语', '面试英语', '职场会议', '雅思口语', '自由闲聊', '情景角色扮演']
const levels = ['A1', 'A2', 'B1', 'B2', 'C1']
const sourceLabels: Record<PracticeSource, string> = { 'chatgpt-web': 'ChatGPT 网页', 'gemini-web': 'Gemini 网页', 'api-direct': 'API 直连' }
const defaultSubtitleSettings: SubtitlePreferences = { mode: 'assistant', layout: 'split', background: 'glass', backgroundColor: '#0e1713', backgroundOpacity: 0.86, assistantColor: '#f1f6f3', userColor: '#fff1c9', fontSize: 25, opacity: 0.94, locked: false, visible: false, maxLines: 4 }

export function App() {
  const [settings, setSettings] = useState<SubtitlePreferences>(defaultSubtitleSettings)
  const [connection, setConnection] = useState<ConnectionState>({ ready: false, pageVisible: true })
  const [automation, setAutomation] = useState<AutomationStatus>({ phase: 'idle', message: '正在准备练习。' })
  const [session, setSession] = useState<string>()
  const [events, setEvents] = useState<TranscriptEvent[]>([])
  const [source, setSource] = useState<PracticeSource>('chatgpt-web')
  const [strength, setStrength] = useState<CorrectionStrength>('normal')
  const [topic, setTopic] = useState('日常聊天')
  const [level, setLevel] = useState('B1')
  const [apiMessage, setApiMessage] = useState('')
  const [apiBusy, setApiBusy] = useState(false)
  const [tab, setTab] = useState<'practice' | 'library' | 'settings'>('practice')
  const [selection, setSelection] = useState('')
  const [lookup, setLookup] = useState<DictionaryResult>()
  const [review, setReview] = useState<ReviewResult>()
  const [items, setItems] = useState<SavedStudyItem[]>([])
  const [providers, setProviders] = useState<ProviderSettings>()

  useEffect(() => {
    void Promise.all([window.speaksub.getState(), window.speaksub.listStudyItems(), window.speaksub.getProviderSettings()]).then(([state, saved, provider]) => {
      setSettings(state.settings); setConnection(state.connection); setAutomation(state.automation); setSession(state.session?.id); setEvents(state.events); setItems(saved); setProviders(provider)
    })
    const removeTranscript = window.speaksub.onTranscript((event) => setEvents((current) => {
      const index = current.findIndex((item) => item.sourceMessageId === event.sourceMessageId)
      if (index === -1) return [...current, event]
      const next = [...current]; next[index] = { ...next[index], ...event, id: next[index].id }; return next
    }))
    const removeSettings = window.speaksub.onSubtitleSettings(setSettings)
    const removeAutomation = window.speaksub.onAutomationStatus(setAutomation)
    const removeConnection = window.speaksub.onConnectionState(setConnection)
    return () => { removeTranscript(); removeSettings(); removeAutomation(); removeConnection() }
  }, [])

  const latestAssistant = useMemo(() => [...events].reverse().find((event) => event.speaker === 'assistant')?.text ?? '', [events])
  const updateSubtitle = (input: Partial<SubtitlePreferences>) => void window.speaksub.updateSubtitle(input)
  const isWebSource = source !== 'api-direct'

  async function enterPractice(): Promise<void> { setConnection(await window.speaksub.completeConnection()) }
  async function openConnection(): Promise<void> { if (source === 'api-direct') return; await window.speaksub.showConnectionPage(source) }
  async function startPractice(): Promise<void> {
    try {
      setAutomation({ phase: 'filling-prompt', message: source === 'api-direct' ? '正在创建 API 直连练习…' : `正在启动 ${sourceLabels[source]} 练习…` })
      const result = await window.speaksub.startPractice(topic, level, strength, source)
      setSession(result.session.id); setEvents([]); setReview(undefined)
      if (result.warning) setAutomation({ phase: 'failed', message: result.warning, recoverable: true })
    } catch (error) { setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '无法开始练习。', recoverable: true }) }
  }
  async function sendApiMessage(): Promise<void> {
    if (!apiMessage.trim() || apiBusy) return
    const outgoing = apiMessage; setApiMessage(''); setApiBusy(true)
    try { await window.speaksub.sendApiMessage(outgoing) } catch (error) { setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : 'API 请求失败。', recoverable: true }) } finally { setApiBusy(false) }
  }
  async function endPractice(): Promise<void> { const result = await window.speaksub.endPractice(); setSession(undefined); setReview(result.review); if (result.error) setAutomation({ phase: 'failed', message: result.error, recoverable: true }); else if (result.voiceWarning) setAutomation({ phase: 'failed', message: result.voiceWarning, recoverable: true }) }
  async function querySelection(): Promise<void> { if (!selection.trim()) return; try { setLookup(await window.speaksub.lookup(selection, latestAssistant)) } catch (error) { setAutomation({ phase: 'failed', message: error instanceof Error ? error.message : '解释生成失败。', recoverable: true }) } }
  async function saveProviders(form: HTMLFormElement): Promise<void> { const data = new FormData(form); setProviders(await window.speaksub.saveProviderSettings({ llmBaseUrl: String(data.get('llmBaseUrl') || ''), llmModel: String(data.get('llmModel') || ''), llmApiKey: String(data.get('llmApiKey') || '') })) }

  if (connection.pageVisible) return <main className="connection-shell"><section className="connection-panel">
    <div className="brand-lockup"><span>S</span><strong>SpeakSub</strong></div><p className="kicker">WEB MODEL CONNECTION</p>
    <h1>{connection.ready ? '连接页面已打开' : `先登录你的 ${source === 'gemini-web' ? 'Gemini' : 'ChatGPT'}`}</h1>
    <p>右侧页面用于登录和恢复网页模式。完成登录后回到 SpeakSub，选择难度并开始对话。</p>
    <div className="connection-steps"><span>01 登录网页模型</span><span>02 确认账号状态</span><span>03 进入练习台</span></div>
    {connection.ready ? <button className="primary-action" onClick={() => void window.speaksub.hideConnectionPage()}>返回练习台</button> : <button className="primary-action" onClick={() => void enterPractice()}>我已登录，进入练习台</button>}
  </section></main>

  return <main className="studio-shell"><header className="studio-topbar">
    <div className="brand-lockup"><span>S</span><strong>SpeakSub</strong><em>personal practice</em></div><div className="top-actions">
      <span className={automation.phase === 'voice-started' ? 'connection-pill live' : 'connection-pill'}>{session ? `${sourceLabels[source]} 练习中` : sourceLabels[source]}</span>
      <button className={settings.visible ? 'subtitle-toggle active' : 'subtitle-toggle'} onClick={() => void window.speaksub.toggleOverlay()}>{settings.visible ? '隐藏字幕' : '显示字幕'}</button>
      {isWebSource && <button className="quiet-action" onClick={() => void openConnection()}>连接页</button>}
    </div>
  </header><aside className="studio-nav"><button className={tab === 'practice' ? 'active' : ''} onClick={() => setTab('practice')}>练习</button><button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>学习本</button><button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>设置</button></aside>
  <section className="studio-content">
    {tab === 'practice' && <>
      <section className="practice-stage"><div className="stage-copy"><p className="kicker">SPEAKING SESSION</p><h1>{session ? '正在对话…' : '准备开口。'}</h1><p>{session ? (source === 'api-direct' ? '应用内文字对话已接入字幕与归档。' : `${sourceLabels[source]} 在后台保持运行，字幕可随时显示。`) : '选择来源、场景和难度，然后开始一次练习。'}</p></div><div className="automation-card"><span className={`status-dot ${automation.phase}`}></span><div><small>{automation.phase.replaceAll('-', ' ')}</small><strong>{automation.message}</strong></div>{automation.recoverable && isWebSource && <button onClick={() => void openConnection()}>打开连接页</button>}</div></section>
      <section className="template-workbench"><div className="workbench-heading"><h2>选择一次对话</h2><span>{source === 'api-direct' ? '应用内文字交流，双方进入字幕流' : `${sourceLabels[source]} 在后台执行`}</span></div>
        <div className="source-picker">{(Object.keys(sourceLabels) as PracticeSource[]).map((item) => <button key={item} disabled={Boolean(session)} className={source === item ? 'active' : ''} onClick={() => setSource(item)}>{sourceLabels[item]}</button>)}</div>
        <div className="topic-grid">{topics.map((item) => <button key={item} disabled={Boolean(session)} className={topic === item ? 'topic active' : 'topic'} onClick={() => setTopic(item)}>{item}</button>)}</div>
        <div className="session-config"><div className="level-picker"><span>难度</span>{levels.map((item) => <button key={item} disabled={Boolean(session)} className={level === item ? 'active' : ''} onClick={() => setLevel(item)}>{item}</button>)}</div><label>纠错<select value={strength} disabled={Boolean(session)} onChange={(event) => setStrength(event.target.value as CorrectionStrength)}><option value="light">轻度</option><option value="normal">普通</option><option value="strict">严格</option></select></label>{session ? <button className="finish-action" onClick={() => void endPractice()}>结束并生成复盘</button> : <button className="primary-action" onClick={() => void startPractice()}>确认并开始</button>}</div>
        {session && source === 'api-direct' && <div className="api-composer"><textarea value={apiMessage} disabled={apiBusy} onChange={(event) => setApiMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendApiMessage() } }} placeholder="用英语输入你的回答…" rows={3}/><button className="primary-action" disabled={apiBusy || !apiMessage.trim()} onClick={() => void sendApiMessage()}>{apiBusy ? '正在回复…' : '发送'}</button></div>}
      </section>
      <section className="support-row"><div className="compact-panel"><div><p className="kicker">LIVE SUBTITLES</p><h3>{settings.visible ? '字幕已显示' : '字幕暂未显示'}</h3><p>对话双方都会进入统一字幕流。</p></div><button className="quiet-action" onClick={() => void window.speaksub.toggleOverlay()}>{settings.visible ? '隐藏' : '显示'}</button></div><div className="compact-panel transcript-preview"><p className="kicker">LATEST CAPTURE</p><p>{latestAssistant || '开始后，最新 AI 回复会显示在这里。'}</p></div></section>
      {review && <section className="review-panel"><p className="kicker">SESSION REVIEW</p><h2>{review.topic}</h2><p>{review.summary}</p>{review.issues.slice(0, 3).map((issue, index) => <div className="review-issue" key={index}><span>{issue.original}</span><strong>{issue.improved}</strong><small>{issue.reason}</small></div>)}</section>}
    </>}
    {tab === 'library' && <section className="utility-page"><p className="kicker">LOCAL MARKDOWN ARCHIVE</p><h1>学习本</h1><div className="lookup-bar"><textarea value={selection} onChange={(event) => setSelection(event.target.value)} placeholder="输入想复习的单词、短语或句子" rows={2}/><button className="primary-action" onClick={() => void querySelection()}>查询解释</button></div>{lookup && <article className="lookup-result"><h2>{lookup.query}</h2><p>{lookup.definitions.join('；') || lookup.contextualMeaning}</p>{lookup.naturalAlternative && <p>更自然：{lookup.naturalAlternative}</p>}<button className="quiet-action" onClick={() => void window.speaksub.saveStudyItem({ kind: selection.includes(' ') ? 'sentence' : 'word', sourceText: selection, note: lookup.naturalAlternative })}>收藏</button></article>}<div className="study-stream">{items.length ? items.map((item) => <article key={item.id}><span>{item.kind === 'word' ? 'WORD' : 'SENTENCE'}</span><strong>{item.sourceText}</strong><p>{item.note}</p></article>) : <p className="empty-copy">你的收藏会以 Markdown 文档保存在本机。</p>}</div></section>}
    {tab === 'settings' && <section className="utility-page settings-page"><p className="kicker">SPEAKSUB CONTROLS</p><h1>设置</h1><div className="settings-grid"><label>字幕内容<select value={settings.mode} onChange={(event) => updateSubtitle({ mode: event.target.value as SubtitlePreferences['mode'] })}><option value="assistant">只显示 AI</option><option value="user">只显示我</option><option value="both">显示双方</option></select></label><label>双方布局<select value={settings.layout} onChange={(event) => updateSubtitle({ layout: event.target.value as SubtitlePreferences['layout'] })}><option value="split">AI 左、我右</option><option value="same-side">同侧显示</option></select></label><label>背景<select value={settings.background} onChange={(event) => updateSubtitle({ background: event.target.value as SubtitlePreferences['background'] })}><option value="glass">半透明磨砂</option><option value="solid">纯色底板</option><option value="transparent">完全透明</option></select></label><label>背景颜色<input type="color" value={settings.backgroundColor} onChange={(event) => updateSubtitle({ backgroundColor: event.target.value })}/></label><label>背景透明度 <output>{Math.round(settings.backgroundOpacity * 100)}%</output><input type="range" min="0.1" max="1" step="0.05" value={settings.backgroundOpacity} onChange={(event) => updateSubtitle({ backgroundOpacity: Number(event.target.value) })}/></label><label>持续显示行数<select value={settings.maxLines} onChange={(event) => updateSubtitle({ maxLines: Number(event.target.value) })}>{[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 行</option>)}</select></label><label>字号 <output>{settings.fontSize}px</output><input type="range" min="18" max="38" value={settings.fontSize} onChange={(event) => updateSubtitle({ fontSize: Number(event.target.value) })}/></label><label>整体透明度 <output>{Math.round(settings.opacity * 100)}%</output><input type="range" min="0.55" max="1" step="0.05" value={settings.opacity} onChange={(event) => updateSubtitle({ opacity: Number(event.target.value) })}/></label><label>AI 字幕颜色<input type="color" value={settings.assistantColor} onChange={(event) => updateSubtitle({ assistantColor: event.target.value })}/></label><label>我的字幕颜色<input type="color" value={settings.userColor} onChange={(event) => updateSubtitle({ userColor: event.target.value })}/></label><label className="check-label"><input type="checkbox" checked={settings.locked} onChange={(event) => updateSubtitle({ locked: event.target.checked })}/>锁定字幕位置和操作</label></div>
      <form className="provider-form" onSubmit={(event) => { event.preventDefault(); void saveProviders(event.currentTarget) }}><h2>API 直连与复盘</h2><p>OpenAI-compatible 配置用于应用内 API 对话、查词补充和结束后的复盘；悬浮单词释义默认使用内置离线词典。</p><label>兼容接口 Base URL<input name="llmBaseUrl" defaultValue={providers?.llmBaseUrl} placeholder="https://example.com/v1"/></label><label>模型名<input name="llmModel" defaultValue={providers?.llmModel} placeholder="your-model"/></label><label>LLM API Key<input name="llmApiKey" type="password" placeholder={providers?.hasLlmKey ? '已保存' : '选填'}/></label><button className="primary-action" type="submit">保存设置</button></form>
    </section>}
  </section></main>
}
