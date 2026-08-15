import { useEffect, useState } from 'react'
import type { CefrLevel, HistorySearchQuery, LearningDashboard, LearningPeriod, NextPracticeDraft, PracticeMode, PracticeSource, SavedSentenceItem, SentenceLearningStatus, SessionArchiveDetail, SessionArchiveSummary, VocabularyFamiliarity, VocabularyItem, VocabularyReviewRating } from '../shared/types'

type LearningView = 'overview' | 'history' | 'vocabulary' | 'sentences'

const familiarityLabels: Record<VocabularyFamiliarity, string> = { unfamiliar: '陌生', learning: '学习中', mastered: '已掌握' }
const sourceLabels = { 'chatgpt-web': 'ChatGPT 网页', 'api-direct': 'API 直连' }
const errorLabels: Record<string, string> = { grammar: '语法', 'word-choice': '用词', tense: '时态', articles: '冠词', prepositions: '介词', fluency: '流畅度', coherence: '连贯性', interaction: '互动', other: '其他' }
const localDateBoundary = (value: string, end = false): string | undefined => value ? new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}`).toISOString() : undefined
const REVIEW_ISSUES_COLLAPSE_THRESHOLD = 5

function ActivityChart({ dashboard }: { dashboard: LearningDashboard }) {
  const max = Math.max(1, ...dashboard.activity.map((item) => item.minutes))
  const points = dashboard.activity.map((item, index) => `${dashboard.activity.length === 1 ? 50 : (index / (dashboard.activity.length - 1)) * 100},${36 - (item.minutes / max) * 30}`).join(' ')
  return <div className="activity-chart" aria-label={`${dashboard.period === 'week' ? '本周' : '本月'}练习时长趋势`}>
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img"><path d="M0 36H100"/><polyline points={points || '0,36 100,36'}/>{dashboard.activity.map((item, index) => <circle key={item.date} cx={dashboard.activity.length === 1 ? 50 : (index / (dashboard.activity.length - 1)) * 100} cy={36 - (item.minutes / max) * 30} r="1.2"/>)}</svg>
    <div><span>{dashboard.from.slice(5, 10)}</span><span>{dashboard.to.slice(5, 10)}</span></div>
  </div>
}

function ReviewIssues({ issues, expanded, onToggle, controlId }: { issues: NonNullable<SessionArchiveDetail['review']>['issues']; expanded: boolean; onToggle: () => void; controlId: string }) {
  const collapsible = issues.length > REVIEW_ISSUES_COLLAPSE_THRESHOLD
  const visible = !collapsible || expanded
  return <section className="review-issues-section">
    <div className="review-issues-heading">
      <h3>全部纠错 <span>{issues.length} 条</span></h3>
      {collapsible && <button type="button" aria-expanded={expanded} aria-controls={controlId} onClick={onToggle}>{expanded ? '收起纠错' : '展开全部'}</button>}
    </div>
    {visible && <div id={controlId}>{issues.map((issue, index) => <div className="review-issue" key={`${issue.original}:${issue.improved}:${index}`}><span>{issue.original}</span><strong>{issue.improved}</strong><small>{issue.reason}</small></div>)}</div>}
  </section>
}

export function LearningCenter({ onUseDraft }: { onUseDraft: (draft: NextPracticeDraft) => void }) {
  const [view, setView] = useState<LearningView>('overview')
  const [period, setPeriod] = useState<LearningPeriod>('week')
  const [dashboard, setDashboard] = useState<LearningDashboard>()
  const [sessions, setSessions] = useState<SessionArchiveSummary[]>([])
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([])
  const [sentences, setSentences] = useState<SavedSentenceItem[]>([])
  const [sentenceStatus, setSentenceStatus] = useState<SentenceLearningStatus>('learning')
  const [selectedSentence, setSelectedSentence] = useState<SavedSentenceItem>()
  const [updatingSentenceStatus, setUpdatingSentenceStatus] = useState(false)
  const [sentenceError, setSentenceError] = useState<string>()
  const [selected, setSelected] = useState<SessionArchiveDetail>()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<HistorySearchQuery['status']>()
  const [source, setSource] = useState<PracticeSource>()
  const [mode, setMode] = useState<PracticeMode>()
  const [level, setLevel] = useState<CefrLevel>()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [familiarity, setFamiliarity] = useState<VocabularyFamiliarity>()
  const [dueOnly, setDueOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [deleteTarget, setDeleteTarget] = useState<SessionArchiveSummary>()
  const [reviewQueue, setReviewQueue] = useState<VocabularyItem[]>()
  const [reviewIndex, setReviewIndex] = useState(0)
  const [reviewRevealed, setReviewRevealed] = useState(false)
  const [reviewedCount, setReviewedCount] = useState(0)
  const [generatingReview, setGeneratingReview] = useState(false)
  const [reviewIssuesExpanded, setReviewIssuesExpanded] = useState(false)

  const refresh = async () => {
    setLoading(true); setError(undefined)
    try {
      const [nextDashboard, nextSessions, nextVocabulary, nextSentences] = await Promise.all([
        window.speaksub.getLearningDashboard(period),
        window.speaksub.searchSessions({ text: query || undefined, status, source, mode, level, dateFrom: localDateBoundary(dateFrom), dateTo: localDateBoundary(dateTo, true) }),
        window.speaksub.listVocabulary({ familiarity, dueOnly, text: view === 'vocabulary' ? query || undefined : undefined }),
        window.speaksub.listSavedSentences({ text: view === 'sentences' ? query || undefined : undefined })
      ])
      setDashboard(nextDashboard); setSessions(nextSessions); setVocabulary(nextVocabulary); setSentences(nextSentences)
      if (selected && !nextSessions.some((item) => item.id === selected.id)) setSelected(undefined)
      if (selectedSentence) setSelectedSentence(nextSentences.find((item) => item.id === selectedSentence.id))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '学习数据加载失败。') }
    finally { setLoading(false) }
  }

  useEffect(() => { const timer = setTimeout(() => void refresh(), 180); return () => clearTimeout(timer) }, [period, query, status, source, mode, level, dateFrom, dateTo, familiarity, dueOnly, view])

  const recent = sessions.slice(0, 4)
  const openSession = async (id: string) => {
    try { setSelected(await window.speaksub.getSessionDetail(id)); setReviewIssuesExpanded(false); setError(undefined) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法读取这次练习。') }
  }
  const useDraft = async (id: string) => {
    try { onUseDraft(await window.speaksub.createNextPracticeDraft(id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法准备下一次练习。') }
  }
  const regenerateReview = async (id: string) => {
    setGeneratingReview(true); setError(undefined)
    try {
      const detail = await window.speaksub.regenerateSessionReview(id)
      setSelected(detail)
      setReviewIssuesExpanded(false)
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '复盘生成失败，请检查大模型连接后重试。') }
    finally { setGeneratingReview(false) }
  }
  const deleteSession = async () => {
    if (!deleteTarget) return
    try { await window.speaksub.deleteSession(deleteTarget.id); setDeleteTarget(undefined); setSelected(undefined); await refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除练习失败。') }
  }
  const startReview = async () => {
    try { const queue = await window.speaksub.listVocabulary({ dueOnly: true }); setReviewQueue(queue); setReviewIndex(0); setReviewRevealed(false); setReviewedCount(0); setError(undefined) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法加载复习队列。') }
  }
  const rateReview = async (rating: VocabularyReviewRating) => {
    const item = reviewQueue?.[reviewIndex]
    if (!item || reviewRevealed) return
    try { await window.speaksub.reviewVocabulary(item.id, rating); setReviewRevealed(true); setReviewedCount((count) => count + 1); setError(undefined) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '词汇复习结果保存失败。') }
  }
  const nextReviewCard = () => { setReviewIndex((index) => index + 1); setReviewRevealed(false) }
  const exitReview = () => { setReviewQueue(undefined); setReviewIndex(0); setReviewRevealed(false); void refresh() }
  const openSentence = (item: SavedSentenceItem) => {
    setSelectedSentence(item); setSentenceError(undefined)
  }
  const updateSentenceStatus = async (learningStatus: SentenceLearningStatus) => {
    if (!selectedSentence || updatingSentenceStatus) return
    setUpdatingSentenceStatus(true); setSentenceError(undefined)
    try {
      const updated = await window.speaksub.updateSavedSentenceStatus(selectedSentence.id, learningStatus)
      setSentences((current) => current.map((item) => item.id === updated.id ? updated : item))
      setSelectedSentence(updated)
    } catch (reason) { setSentenceError(reason instanceof Error ? reason.message : '句子学习状态保存失败，请重试。') }
    finally { setUpdatingSentenceStatus(false) }
  }

  const learningSentenceCount = sentences.filter((item) => item.learningStatus === 'learning').length
  const masteredSentenceCount = sentences.filter((item) => item.learningStatus === 'mastered').length
  const visibleSentences = sentences.filter((item) => item.learningStatus === sentenceStatus)

  return <section className="learning-center">
    <header className="learning-header"><div><p className="kicker">LOCAL LEARNING LOOP</p><h1>学习中心</h1><p>把每次开口留下的错误、词汇、句子和进步，变成下一次练习的起点。</p></div><nav aria-label="学习中心页面">{(['overview', 'history', 'vocabulary', 'sentences'] as LearningView[]).map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => { setView(item); setQuery('') }}>{item === 'overview' ? '总览' : item === 'history' ? '历史' : item === 'vocabulary' ? '词汇' : '句子'}</button>)}</nav></header>
    {error && <div className="learning-error" role="alert"><span>{error}</span><button onClick={() => void refresh()}>重试</button></div>}
    {loading && <div className="learning-skeleton" aria-label="正在加载"><span/><span/><span/></div>}

    {!loading && view === 'overview' && dashboard && <>
      <div className="period-switch"><button className={period === 'week' ? 'active' : ''} onClick={() => setPeriod('week')}>最近 7 天</button><button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>最近 30 天</button></div>
      <div className="learning-overview">
        <section className="trend-panel"><div className="metric-lead"><small>练习时长</small><strong>{dashboard.totalMinutes}</strong><span>分钟 · {dashboard.sessionCount} 次练习</span></div><ActivityChart dashboard={dashboard}/></section>
        <section className="metric-strip"><div><small>连续练习</small><strong>{dashboard.streakDays}<em>天</em></strong></div><div><small>待复习</small><strong>{dashboard.dueVocabulary}<em>词</em></strong></div><div><small>已掌握</small><strong>{dashboard.masteredVocabulary}<em>词</em></strong></div><div><small>练习天数</small><strong>{dashboard.practiceDays}<em>天</em></strong></div></section>
        <section className="ability-panel"><div><p className="kicker">AI ESTIMATE</p><h2>表达能力</h2><small>根据练习文本估算，不代表正式 CEFR 认证。</small></div>{dashboard.averageScores ? <div className="ability-bars">{Object.entries(dashboard.averageScores).map(([key, value]) => <label key={key}><span>{key === 'accuracy' ? '准确度' : key === 'vocabulary' ? '词汇' : key === 'fluency' ? '流畅度' : '互动'}</span><i><b style={{ width: `${value}%` }}/></i><output>{value}</output></label>)}</div> : <p className="empty-copy">完成带评分的练习后，这里会显示能力趋势。</p>}</section>
        <section className="overview-columns"><div><div className="section-title"><h2>最近练习</h2><button onClick={() => setView('history')}>查看全部</button></div>{recent.length ? recent.map((item) => <button className="recent-row" key={item.id} onClick={() => { setView('history'); void openSession(item.id) }}><span>{new Date(item.startedAt).toLocaleDateString()}</span><strong>{item.topic}</strong><small>{item.estimatedCefr ?? item.level ?? '未评分'}</small></button>) : <p className="learning-empty">完成第一场练习后，复盘会出现在这里。</p>}</div><div><div className="section-title"><h2>常见错误</h2></div>{dashboard.topErrors.length ? dashboard.topErrors.map((item) => <div className="error-rank" key={item.category}><span>{errorLabels[item.category] ?? item.category}</span><i/><strong>{item.count}</strong></div>) : <p className="learning-empty">还没有足够的纠错数据。</p>}</div></section>
      </div>
    </>}

    {!loading && view === 'history' && <div className="history-layout">
      <aside className="history-browser"><div className="learning-search"><input aria-label="搜索历史练习" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对话、复盘、错误或收藏词"/><select aria-label="练习状态" value={status ?? ''} onChange={(event) => setStatus((event.target.value || undefined) as HistorySearchQuery['status'])}><option value="">全部状态</option><option value="completed">已完成</option><option value="interrupted">未完成</option></select></div><div className="history-filters"><select aria-label="练习来源" value={source ?? ''} onChange={(event) => setSource((event.target.value || undefined) as PracticeSource | undefined)}><option value="">全部来源</option><option value="chatgpt-web">ChatGPT</option><option value="api-direct">API</option></select><select aria-label="交流方式" value={mode ?? ''} onChange={(event) => setMode((event.target.value || undefined) as PracticeMode | undefined)}><option value="">全部方式</option><option value="text">文字</option><option value="voice">语音</option></select><select aria-label="CEFR 等级" value={level ?? ''} onChange={(event) => setLevel((event.target.value || undefined) as CefrLevel | undefined)}><option value="">全部等级</option>{['A1','A2','B1','B2','C1'].map((item) => <option key={item}>{item}</option>)}</select><input aria-label="开始日期" title="开始日期" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}/><input aria-label="结束日期" title="结束日期" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)}/></div>{sessions.length ? sessions.map((item) => <article className={selected?.id === item.id ? 'history-row active' : 'history-row'} key={item.id}><button onClick={() => void openSession(item.id)}><small>{new Date(item.startedAt).toLocaleString()} · {item.status === 'interrupted' ? '未完成' : `${Math.max(1, Math.round(item.durationSeconds / 60))} 分钟`}</small><strong>{item.topic}</strong><p>{item.summary ?? `${item.favoriteWords.length} 个收藏词 · ${item.hasReview ? '已有复盘' : '暂无复盘'}`}</p></button><button className="row-delete" title="删除练习" onClick={() => setDeleteTarget(item)}>删除</button></article>) : <p className="learning-empty">没有匹配的练习记录。</p>}</aside>
      <section className="session-detail">{selected ? <><header><div><p className="kicker">FULL SESSION REVIEW</p><h2>{selected.topic}</h2><span>{new Date(selected.startedAt).toLocaleString()} · {selected.source ? sourceLabels[selected.source] : '旧记录'} · {selected.level ?? '未记录等级'}</span></div>{selected.status === 'completed' ? <div className="session-detail-actions">{selected.review && <button className="quiet-action" disabled={generatingReview} onClick={() => void regenerateReview(selected.id)}>{generatingReview ? '正在重新生成…' : '重新生成复盘'}</button>}{selected.review ? <button className="primary-action" onClick={() => void useDraft(selected.id)}>准备下一次练习</button> : <button className="primary-action" disabled={generatingReview} onClick={() => void regenerateReview(selected.id)}>{generatingReview ? '正在生成复盘…' : '重新生成复盘'}</button>}</div> : null}</header>{selected.review?.assessment && <div className="assessment-line"><strong>{selected.review.assessment.estimatedCefr}</strong>{Object.entries(selected.review.assessment.scores).map(([key, value]) => <span key={key}>{key} {value}</span>)}</div>}<section><h3>复盘总结</h3><p>{selected.review?.summary ?? '这次练习没有生成模型复盘。可以点击右上角重新生成；成功后能力趋势会自动更新。'}</p></section>{selected.review?.issues.length ? <ReviewIssues issues={selected.review.issues} expanded={reviewIssuesExpanded} onToggle={() => setReviewIssuesExpanded((value) => !value)} controlId={`review-issues-${selected.id}`}/> : null}{selected.favoriteWords.length ? <section><h3>收藏词汇</h3><div className="word-chips">{selected.favoriteWords.map((word) => <span key={word}>{word}</span>)}</div></section> : null}<section><h3>完整对话</h3><div className="full-transcript">{selected.transcript.length ? selected.transcript.map((line, index) => <p className={line.speaker} key={index}><b>{line.speaker === 'assistant' ? 'AI' : 'Me'}</b><span>{line.text}</span></p>) : <p className="learning-empty">没有捕获到对话文本。</p>}</div></section>{selected.review?.nextPractice && <section className="next-practice-note"><h3>下一次重点</h3><p>{selected.review.nextPractice}</p></section>}</> : <div className="detail-placeholder"><span>选择一条练习</span><p>这里会显示完整对话、所有纠错、收藏词和下一次建议。</p></div>}</section>
    </div>}

    {!loading && view === 'vocabulary' && <div className="vocabulary-view">{reviewQueue ? (() => {
      const item = reviewQueue[reviewIndex]
      if (!item) return <div className="vocabulary-review-complete"><p className="kicker">REVIEW COMPLETE</p><h2>本轮复习完成</h2><p>你完成了 {reviewedCount} 个待复习词。</p><button className="primary-action" onClick={exitReview}>返回词汇列表</button></div>
      return <section className="vocabulary-card" aria-label="词汇复习卡片"><header><button className="quiet-action" onClick={exitReview}>退出复习</button><span>{reviewIndex + 1} / {reviewQueue.length}</span></header><div className="vocabulary-card-body"><p className="kicker">RECALL THE WORD</p><h2>{item.term}</h2>{reviewRevealed ? <div className="vocabulary-answer"><p>{item.meaning ?? '暂无中文释义'}</p>{item.example && <blockquote>{item.example}</blockquote>}</div> : <p className="vocabulary-card-hint">先回忆中文意思，再选择你的记忆程度。</p>}</div>{reviewRevealed ? <footer><button className="primary-action" onClick={nextReviewCard}>下一个单词</button></footer> : <footer className="review-ratings">{([{ rating: 'again', label: '重来' }, { rating: 'hard', label: '困难' }, { rating: 'good', label: '一般' }, { rating: 'easy', label: '简单' }] as Array<{ rating: VocabularyReviewRating; label: string }>).map(({ rating, label }) => <button key={rating} onClick={() => void rateReview(rating)}>{label}</button>)}</footer>}</section>
    })() : <><div className="vocabulary-toolbar"><input aria-label="搜索收藏词" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索单词或释义"/><div><button className="vocabulary-all" onClick={() => { setDueOnly(false); setFamiliarity(undefined); setQuery('') }}>所有收藏</button><button className={dueOnly ? 'active' : ''} onClick={() => setDueOnly(!dueOnly)}>待复习 {dashboard?.dueVocabulary ?? 0}</button><button className="primary-action vocabulary-start" disabled={!dashboard?.dueVocabulary} onClick={() => void startReview()}>开始复习</button>{(['unfamiliar', 'learning', 'mastered'] as VocabularyFamiliarity[]).map((item) => <button key={item} className={familiarity === item ? 'active' : ''} onClick={() => setFamiliarity(familiarity === item ? undefined : item)}>{familiarityLabels[item]}</button>)}</div></div>{vocabulary.length ? <div className="vocabulary-list">{vocabulary.map((item, index) => <article key={item.id} style={{ '--row-index': index } as React.CSSProperties}><div className="word-index">{String(index + 1).padStart(2, '0')}</div><div className="word-copy"><small>{familiarityLabels[item.familiarity]} · 收藏 {item.occurrenceCount} 次</small><h2>{item.term}</h2><p>{item.meaning ?? '暂无中文释义'}</p>{item.example && <blockquote>{item.example}</blockquote>}<span>下次复习：{new Date(item.nextReviewAt).toLocaleDateString()}</span></div></article>)}</div> : <div className="vocabulary-empty"><h2>{dueOnly ? '今天没有待复习词汇' : '词汇本还是空的'}</h2><p>{dueOnly ? '继续练习，新的复习任务会按熟悉度自动安排。' : '在悬浮字幕里点击单词并收藏，它会出现在这里。'}</p></div>}</>}</div>}

    {!loading && view === 'sentences' && <div className="sentence-view">
      <div className="sentence-toolbar"><input aria-label="搜索收藏句子" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索收藏的句子"/><span>{sentences.length} 个收藏句子</span></div>
      <div className="sentence-status-tabs" role="tablist" aria-label="句子学习状态">
        <button role="tab" aria-selected={sentenceStatus === 'learning'} className={sentenceStatus === 'learning' ? 'active' : ''} onClick={() => setSentenceStatus('learning')}>正在学 <span>{learningSentenceCount}</span></button>
        <button role="tab" aria-selected={sentenceStatus === 'mastered'} className={sentenceStatus === 'mastered' ? 'active' : ''} onClick={() => setSentenceStatus('mastered')}>已学会 <span>{masteredSentenceCount}</span></button>
      </div>
      {visibleSentences.length ? <div className="sentence-list">{visibleSentences.map((item, index) => <article key={item.id} style={{ '--row-index': index } as React.CSSProperties}>
        <div className="sentence-index">{String(index + 1).padStart(2, '0')}</div>
        <button className="sentence-row-button" type="button" onClick={() => openSentence(item)}>
          <small>{item.speaker === 'assistant' ? 'AI' : '我'} · {item.mode === 'voice' ? '语音对话' : item.mode === 'text' ? '文字对话' : '历史对话'} · {item.source ? sourceLabels[item.source] : '旧记录'} · {new Date(item.savedAt).toLocaleString()}</small>
          <blockquote>{item.text}</blockquote>
          {item.analysis ? <div className="sentence-analysis-preview" aria-label="句子分析摘要"><p><b>句型</b><span>{item.analysis.structure}</span></p><p><b>复用</b><span>{item.analysis.reusablePattern}</span></p><p><b>表达</b><span>{item.analysis.expressions.map((expression) => expression.phrase).join(' · ') || '暂无提取'}</span></p></div> : <p className="sentence-analysis-prompt">本次复盘暂未生成句子分析</p>}
          <span className="sentence-row-foot"><i>{item.learningStatus === 'mastered' ? '已学会' : '正在学'}</i><b>查看详细分析</b></span>
        </button>
      </article>)}</div> : <div className="sentence-empty"><h2>{sentenceStatus === 'learning' ? '还没有正在学习的句子' : '还没有已学会的句子'}</h2><p>{sentenceStatus === 'learning' ? '在语音或文字对话的字幕末尾点击“收藏句子”，它会先进入正在学。' : '打开正在学习的句子，掌握后点击“标记为已学会”。'}</p></div>}
    </div>}

    {selectedSentence && <div className="sentence-detail-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedSentence(undefined) }}>
      <aside className="sentence-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="sentence-detail-title">
        <header><div><p className="kicker">SENTENCE NOTES</p><span className={`sentence-status-badge ${selectedSentence.learningStatus}`}>{selectedSentence.learningStatus === 'mastered' ? '已学会' : '正在学'}</span></div><button className="sentence-drawer-close" type="button" onClick={() => setSelectedSentence(undefined)}>关闭</button></header>
        <blockquote id="sentence-detail-title">{selectedSentence.text}</blockquote>
        <button className="sentence-status-action" type="button" disabled={updatingSentenceStatus} onClick={() => void updateSentenceStatus(selectedSentence.learningStatus === 'mastered' ? 'learning' : 'mastered')}>{updatingSentenceStatus ? '保存中…' : selectedSentence.learningStatus === 'mastered' ? '移回正在学' : '标记为已学会'}</button>
        {sentenceError && <div className="sentence-analysis-error" role="alert"><span>{sentenceError}</span></div>}
        {!selectedSentence.analysis && <div className="sentence-analysis-missing"><h3>暂无句子分析</h3><p>这条句子来自未完成复盘或旧记录。可以在历史记录中重新生成整场复盘，句子会随复盘一起分析。</p></div>}
        {selectedSentence.analysis && <div className="sentence-analysis-detail">
          <section><h3>自然意思</h3><p>{selectedSentence.analysis.translation}</p></section>
          <section><h3>句型结构</h3><p>{selectedSentence.analysis.structure}</p></section>
          <section><h3>可复用句型</h3><code>{selectedSentence.analysis.reusablePattern}</code>{selectedSentence.analysis.examples.length ? <div className="sentence-examples">{selectedSentence.analysis.examples.map((example) => <p key={example}>{example}</p>)}</div> : null}</section>
          {selectedSentence.analysis.expressions.length ? <section><h3>常用表达</h3>{selectedSentence.analysis.expressions.map((expression) => <div className="sentence-expression" key={expression.phrase}><strong>{expression.phrase}</strong><span>{expression.meaning}</span></div>)}</section> : null}
          {selectedSentence.analysis.breakdown.length ? <section><h3>句子拆解</h3>{selectedSentence.analysis.breakdown.map((part) => <div className="sentence-breakdown" key={`${part.part}:${part.explanation}`}><strong>{part.part}</strong><span>{part.explanation}</span></div>)}</section> : null}
          {selectedSentence.analysis.tip && <section><h3>使用提醒</h3><p>{selectedSentence.analysis.tip}</p></section>}
        </div>}
      </aside>
    </div>}

    {deleteTarget && <div className="confirm-layer" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div><p className="kicker">PERMANENT DELETE</p><h2 id="delete-title">永久删除这次练习？</h2><p>{deleteTarget.topic} · {new Date(deleteTarget.startedAt).toLocaleString()}</p><small>对应 Markdown、复盘和词汇关联会被删除，此操作无法撤销。</small><footer><button className="quiet-action" onClick={() => setDeleteTarget(undefined)}>取消</button><button className="danger-action" onClick={() => void deleteSession()}>永久删除</button></footer></div></div>}
  </section>
}
