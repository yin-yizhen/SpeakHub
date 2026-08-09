import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent } from 'react'
import { subtitleWordTokens } from '../shared/subtitle-words'
import { subtitleEvents } from '../shared/transcript'
import type { DictionaryResult, SubtitlePreferences, TranscriptEvent } from '../shared/types'
import { defaultSubtitlePreferences } from '../shared/defaults'
import type { ResizeDirection } from '../main/window-layout'
import { LocalSpeechAudioPlayer } from './local-speech-audio'

const defaultSettings: SubtitlePreferences = {
  ...defaultSubtitlePreferences,
  fontSize: 24,
  opacity: 0.9,
  visible: true
}

function hexToRgba(hex: string, opacity: number): string {
  const normalized = hex.replace('#', '')
  const value = /^[\da-f]{6}$/i.test(normalized) ? normalized : '0e1713'
  const red = parseInt(value.slice(0, 2), 16)
  const green = parseInt(value.slice(2, 4), 16)
  const blue = parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

type LookupState =
  | { status: 'loading'; query: string; anchor: LookupAnchor; pinned: boolean; saving: boolean; saved: boolean; saveError?: string }
  | { status: 'ready'; result: DictionaryResult; anchor: LookupAnchor; pinned: boolean; saving: boolean; saved: boolean; saveError?: string }
  | { status: 'error'; query: string; message: string; anchor: LookupAnchor; pinned: boolean; saving: boolean; saved: boolean; saveError?: string }

interface LookupAnchor {
  left: number
  top: number
  placement: 'above' | 'below'
  maxHeight: number
}

type SentenceSaveState = { status: 'saving' | 'saved' | 'error'; message?: string }

const subtitleTextGutter = 57
export const subtitleCharactersPerLine = (width: number, fontSize: number): number => Math.max(10, Math.floor((width - subtitleTextGutter * 2) / fontSize))

// AI responses may contain paragraph breaks intended for chat, not for the compact overlay.
function subtitleDisplayText(text: string): string {
  return text.replace(/[\t ]*\r?\n+[\t ]*/g, ' ')
}

export function SubtitleOverlay() {
  const [settings, setSettings] = useState<SubtitlePreferences>(defaultSettings)
  const [events, setEvents] = useState<TranscriptEvent[]>([])
  const [practiceActive, setPracticeActive] = useState(false)
  const [textPracticeActive, setTextPracticeActive] = useState(false)
  const [textTtsAvailable, setTextTtsAvailable] = useState(false)
  const [speakTextReplies, setSpeakTextReplies] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string>()
  const [endingPractice, setEndingPractice] = useState(false)
  const [hoveredToolbar, setHoveredToolbar] = useState(false)
  const [lookupState, setLookupState] = useState<LookupState>()
  const [sentenceSaveStates, setSentenceSaveStates] = useState<Record<string, SentenceSaveState>>({})
  const lookupRequest = useRef(0)
  const sendRequest = useRef(0)
  const overlayInteractive = useRef<boolean | undefined>(undefined)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const player = useRef(new LocalSpeechAudioPlayer())
  const resizeStart = useRef<{ direction: ResizeDirection; origin: NonNullable<SubtitlePreferences['bounds']>; pointerId: number; screenX: number; screenY: number } | undefined>(undefined)
  const dragStart = useRef<{ origin: NonNullable<SubtitlePreferences['bounds']>; pointerId: number; screenX: number; screenY: number } | undefined>(undefined)
  const setOverlayInteractivity = (interactive: boolean) => {
    if (overlayInteractive.current === interactive) return
    overlayInteractive.current = interactive
    void window.speaksub.setOverlayInteractive(interactive)
  }
  const syncOverlayInteractivity = (target: EventTarget | null) => {
    const interactive = target instanceof Element && Boolean(target.closest(settings.locked ? '[data-subtitle-lock-access]' : '[data-subtitle-interactive]'))
    setOverlayInteractivity(interactive)
  }

  useEffect(() => {
    const refreshPracticeState = () => void window.speaksub.getState().then((state) => {
      setSettings(state.settings)
      setEvents(state.events)
      setPracticeActive(Boolean(state.session))
      setTextPracticeActive(Boolean(state.session) && state.mode === 'text')
      setTextTtsAvailable(Boolean(state.session) && state.mode === 'text' && state.source === 'api-direct')
    })
    refreshPracticeState()
    const removeEvents = window.speaksub.onTranscript((event) => setEvents((current) => {
      const index = current.findIndex((item) => item.sourceMessageId === event.sourceMessageId)
      if (index === -1) return [...current, event]
      const next = [...current]
      next[index] = { ...next[index], ...event, id: next[index].id }
      return next
    }))
    const removeSettings = window.speaksub.onSubtitleSettings((next) => {
      setSettings(next)
    })
    const removeAutomation = window.speaksub.onAutomationStatus(refreshPracticeState)
    const removePracticeEnded = window.speaksub.onPracticeEnded(() => { player.current.stop(); setPracticeActive(false); setTextPracticeActive(false); setTextTtsAvailable(false); setSpeakTextReplies(false); setSentenceSaveStates({}); setEndingPractice(false) })
    const removeVoiceAudio = window.speaksub.onVoiceAudio((chunk) => player.current.play(chunk, () => void window.speaksub.notifyVoicePlaybackEnded(chunk.id)))
    const removeVoiceInterrupt = window.speaksub.onVoiceInterrupt((generation) => player.current.interrupt(generation))
    return () => { player.current.stop(); removeEvents(); removeSettings(); removeAutomation(); removePracticeEnded(); removeVoiceAudio(); removeVoiceInterrupt() }
  }, [])

  // Match the real grid width: shell padding plus equal label-sized gutters on
  // both sides of the subtitle text. This estimate only controls event retention;
  // the browser remains responsible for the actual word wrapping.
  const charactersPerLine = subtitleCharactersPerLine(settings.bounds?.width ?? window.innerWidth, settings.fontSize)
  const displayed = useMemo(() => subtitleEvents(events, settings.mode, settings.maxLines, charactersPerLine), [events, settings, charactersPerLine])
  useEffect(() => {
    const transcript = transcriptRef.current
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [displayed, settings.fontSize])
  useEffect(() => {
    overlayInteractive.current = undefined
    syncOverlayInteractivity(null)
  }, [settings.locked])
  const toolbarOpen = hoveredToolbar
  const shellClass = ['subtitle-shell', settings.locked ? 'locked' : '', toolbarOpen ? 'toolbar-open' : '', 'layout-same-side', `background-${settings.background}`].filter(Boolean).join(' ')
  const style = {
    opacity: settings.opacity,
    fontSize: settings.fontSize,
    background: settings.background === 'transparent' ? 'transparent' : hexToRgba(settings.backgroundColor, settings.backgroundOpacity),
    '--assistant-color': settings.assistantColor,
    '--user-color': settings.userColor
  } as CSSProperties
  const update = (input: Partial<SubtitlePreferences>) => void window.speaksub.updateSubtitle(input)
  const beginResize = (direction: ResizeDirection, event: PointerEvent<HTMLDivElement>) => {
    if (settings.locked || !settings.bounds || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeStart.current = { direction, origin: settings.bounds, pointerId: event.pointerId, screenX: event.screenX, screenY: event.screenY }
  }
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current
    if (!start || start.pointerId !== event.pointerId) return
    void window.speaksub.resizeOverlay(start.direction, start.origin, event.screenX - start.screenX, event.screenY - start.screenY)
  }
  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeStart.current?.pointerId !== event.pointerId) return
    resizeStart.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (settings.locked || !settings.bounds || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStart.current = { origin: settings.bounds, pointerId: event.pointerId, screenX: event.screenX, screenY: event.screenY }
    setOverlayInteractivity(true)
  }
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current
    if (!start || start.pointerId !== event.pointerId) return
    void window.speaksub.moveOverlay(start.origin, event.screenX - start.screenX, event.screenY - start.screenY)
  }
  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current?.pointerId !== event.pointerId) return
    dragStart.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    syncOverlayInteractivity(event.target)
  }

  const lookupWord = async (word: string, context: string, target: HTMLElement, pinned = false) => {
    if (!pinned && lookupState?.pinned) return
    const request = lookupRequest.current + 1
    lookupRequest.current = request
    const shell = target.closest<HTMLElement>('.subtitle-shell')
    if (!shell) return
    const targetBounds = target.getBoundingClientRect()
    const shellBounds = shell.getBoundingClientRect()
    const horizontalPadding = 18
    const verticalPadding = 12
    const gap = 8
    const popoverWidth = Math.min(360, shellBounds.width - horizontalPadding * 2)
    const targetTop = targetBounds.top - shellBounds.top
    const targetBottom = targetBounds.bottom - shellBounds.top
    const availableAbove = targetTop - verticalPadding - gap
    const availableBelow = shellBounds.height - targetBottom - verticalPadding - gap
    const placement: LookupAnchor['placement'] = availableAbove >= availableBelow ? 'above' : 'below'
    const availableHeight = placement === 'above' ? availableAbove : availableBelow
    const center = targetBounds.left - shellBounds.left + targetBounds.width / 2
    const anchor = {
      left: Math.min(Math.max(center, horizontalPadding + popoverWidth / 2), shellBounds.width - horizontalPadding - popoverWidth / 2),
      top: placement === 'above' ? targetTop - gap : targetBottom + gap,
      placement,
      maxHeight: Math.max(0, availableHeight)
    }
    setLookupState({ status: 'loading', query: word, anchor, pinned, saving: false, saved: false })
    try {
      const result = await window.speaksub.lookup(word, context)
      if (lookupRequest.current === request) setLookupState({ status: 'ready', result, anchor, pinned, saving: false, saved: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lookup failed. Check learning service settings.'
      if (lookupRequest.current === request) setLookupState({ status: 'error', query: word, message, anchor, pinned, saving: false, saved: false })
    }
  }
  const dismissLookup = () => {
    setLookupState((current) => {
      if (current?.pinned) return current
      lookupRequest.current += 1
      return undefined
    })
  }
  const closePinnedLookup = () => {
    setLookupState((current) => {
      if (!current?.pinned) return current
      lookupRequest.current += 1
      return undefined
    })
  }
  useEffect(() => {
    const dismissOnBlur = () => closePinnedLookup()
    window.addEventListener('blur', dismissOnBlur)
    return () => window.removeEventListener('blur', dismissOnBlur)
  }, [])
  const saveLookup = async () => {
    const current = lookupState
    if (!current || current.saving || current.saved) return
    setLookupState({ ...current, saving: true, saveError: undefined })
    try {
      await window.speaksub.saveSessionFavorite(current.status === 'ready' ? current.result.query : current.query)
      setLookupState((next) => next ? { ...next, saving: false, saved: true } : next)
    } catch (error) {
      const saveError = error instanceof Error ? error.message : 'Could not save this word.'
      setLookupState((next) => next ? { ...next, saving: false, saveError } : next)
    }
  }
  const saveSentence = async (event: TranscriptEvent) => {
    const current = sentenceSaveStates[event.sourceMessageId]
    if (current?.status === 'saving' || current?.status === 'saved') return
    setSentenceSaveStates((states) => ({ ...states, [event.sourceMessageId]: { status: 'saving' } }))
    try {
      await window.speaksub.saveSessionSentence(event.sourceMessageId)
      setSentenceSaveStates((states) => ({ ...states, [event.sourceMessageId]: { status: 'saved' } }))
    } catch (error) {
      setSentenceSaveStates((states) => ({ ...states, [event.sourceMessageId]: { status: 'error', message: error instanceof Error ? error.message : '句子收藏失败，请重试。' } }))
    }
  }
  const sendTextMessage = async () => {
    const outgoing = message.trim()
    if (!outgoing) return
    const request = ++sendRequest.current
    setMessage('')
    setSendError(undefined)
    setSending(true)
    try {
      await window.speaksub.sendPracticeMessage(outgoing, textTtsAvailable && speakTextReplies)
    } catch (error) {
      if (request === sendRequest.current) {
        setMessage((current) => current || outgoing)
        setSendError(error instanceof Error ? error.message : 'Message failed to send.')
      }
    } finally {
      if (request === sendRequest.current) setSending(false)
    }
  }
  const endPractice = async () => {
    if (!practiceActive || endingPractice) return
    setEndingPractice(true)
    try { await window.speaksub.endPractice() }
    catch { setEndingPractice(false) }
  }

  return <div className={shellClass} style={style} onMouseMove={handleMouseMove} onMouseLeave={() => { if (!dragStart.current) syncOverlayInteractivity(null) }} onPointerDown={closePinnedLookup}>
    {!settings.locked && (['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as ResizeDirection[]).map((direction) => <div key={direction} data-subtitle-interactive className={`subtitle-resize-handle ${direction}`} onPointerDown={(event) => beginResize(direction, event)} onPointerMove={resize} onPointerUp={finishResize} onPointerCancel={finishResize} onLostPointerCapture={finishResize}/>) }
    <div className="subtitle-toolbar-zone" data-subtitle-interactive data-subtitle-lock-access onMouseEnter={() => { setHoveredToolbar(true); setOverlayInteractivity(true) }} onMouseLeave={() => setHoveredToolbar(false)}>
      {settings.locked ? <><div className="subtitle-lock-handle" title="Unlock subtitles"><div className="subtitle-drag-bars"><span></span><span></span><span></span></div></div>{toolbarOpen && <button className="subtitle-unlock" data-subtitle-interactive type="button" title="Unlock subtitles" onClick={() => update({ locked: false })}>Unlock</button>}</> : <><div className="subtitle-drag-zone" title="拖动字幕" onPointerDown={beginDrag} onPointerMove={drag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}><div className="subtitle-drag-bars"><span></span><span></span><span></span></div></div>
          <div className="subtitle-controls" onClick={(event) => event.stopPropagation()}>
            <div className="subtitle-settings-row"><label>Size<input aria-label="Subtitle size" type="range" min="18" max="38" value={settings.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })}/></label><label>AI <input aria-label="AI subtitle color" type="color" value={settings.assistantColor} onChange={(event) => update({ assistantColor: event.target.value })}/></label><label>Me <input aria-label="My subtitle color" type="color" value={settings.userColor} onChange={(event) => update({ userColor: event.target.value })}/></label><button className="subtitle-lock" type="button" title="Lock subtitles" onClick={() => update({ locked: true })}>Lock</button></div>
            <div className="subtitle-action-row">{practiceActive ? <button className="subtitle-end-practice" type="button" disabled={endingPractice} onClick={() => void endPractice()}>{endingPractice ? '结束中…' : '结束对话'}</button> : <span/>}<button className="subtitle-close" type="button" title="Close subtitles" onClick={() => void window.speaksub.toggleOverlay()}>关闭字幕</button></div>
          </div></>}
    </div>
    <div className="subtitle-transcript" ref={transcriptRef}>
      {displayed.length
        ? displayed.map((event) => <p className={`subtitle-line ${event.speaker}${event.interrupted ? ' interrupted' : ''}`} key={event.id}><b>{event.speaker === 'assistant' ? `AI${event.interrupted ? ' · 已打断' : ''}` : 'Me'}</b><span className="subtitle-text">{subtitleWordTokens(subtitleDisplayText(event.text)).map((token, index) => token.clickable
          ? <button className="subtitle-word" data-subtitle-interactive key={index} onMouseEnter={(mouse) => void lookupWord(token.text, event.text, mouse.currentTarget)} onMouseLeave={dismissLookup} onFocus={(focus) => void lookupWord(token.text, event.text, focus.currentTarget)} onBlur={dismissLookup} onClick={(click) => { click.stopPropagation(); void lookupWord(token.text, event.text, click.currentTarget, true) }}>{token.text}</button>
          : <span className="subtitle-fragment" key={index}>{token.text}</span>)}{event.status === 'complete' && practiceActive && (() => {
            const saveState = sentenceSaveStates[event.sourceMessageId]
            const saved = saveState?.status === 'saved'
            const saving = saveState?.status === 'saving'
            return <button className={`subtitle-sentence-save${saved ? ' saved' : ''}${saveState?.status === 'error' ? ' error' : ''}`} data-subtitle-interactive type="button" aria-label={saved ? '句子已收藏' : '收藏句子'} title={saveState?.message ?? (saved ? '句子已收藏' : '收藏句子')} disabled={saved || saving} onPointerDown={(pointer) => pointer.stopPropagation()} onClick={(click) => { click.stopPropagation(); void saveSentence(event) }}><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4 2.5h8v11l-4-2.4-4 2.4z"/></svg><span>{saved ? '已收藏' : saving ? '收藏中…' : saveState?.status === 'error' ? '重试收藏' : '收藏句子'}</span></button>
          })()}</span></p>)
        : <p className="subtitle-empty">Start practice to show recent page text here.</p>}
    </div>
    {textPracticeActive && <form className="subtitle-composer" data-subtitle-interactive aria-busy={sending} onSubmit={(event) => { event.preventDefault(); void sendTextMessage() }}>
      <input aria-label="输入文字消息" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="输入文字，按 Enter 发送" autoComplete="off" />
      {textTtsAvailable && <label className="subtitle-tts-toggle" title="使用当前 TTS 模型朗读 AI 回复"><input type="checkbox" aria-label="朗读 AI 回复" checked={speakTextReplies} onChange={(event) => setSpeakTextReplies(event.target.checked)}/><span aria-hidden="true">✓</span></label>}
      <button type="submit" aria-label={sending ? '打断当前回复并发送' : '发送'} disabled={!message.trim()}>发送</button>
      {sendError && <p role="alert">{sendError}</p>}
    </form>}
    {lookupState && <aside className={`lookup-popover ${lookupState.anchor.placement} ${lookupState.pinned ? 'pinned' : ''}`} data-subtitle-interactive style={{ left: lookupState.anchor.left, top: lookupState.anchor.top, maxHeight: lookupState.anchor.maxHeight }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      {lookupState.status === 'loading' && <><div className="lookup-heading"><strong>{lookupState.query}</strong></div><p>Looking up...</p></>}
      {lookupState.status === 'error' && <><div className="lookup-heading"><strong>{lookupState.query}</strong></div><p>{lookupState.message}</p></>}
      {lookupState.status === 'ready' && <><div className="lookup-heading"><strong>{lookupState.result.query}</strong>{lookupState.result.phonetic && <small>/{lookupState.result.phonetic}/</small>}</div><p>{lookupState.result.definitions.join('; ') || lookupState.result.contextualMeaning || 'No definition returned.'}</p>{lookupState.result.naturalAlternative && <p>Natural: {lookupState.result.naturalAlternative}</p>}</>}
      {lookupState.pinned && <div className="lookup-actions"><button type="button" title="收藏单词" aria-label="收藏单词" disabled={lookupState.saving || lookupState.saved} onClick={() => void saveLookup()}>{lookupState.saved ? '已收藏' : lookupState.saving ? '收藏中…' : '收藏'}</button>{lookupState.saveError && <small role="alert">{lookupState.saveError}</small>}</div>}
    </aside>}
  </div>
}
