import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { subtitleWordTokens } from '../shared/subtitle-words'
import { subtitleEvents } from '../shared/transcript'
import type { DictionaryResult, SubtitlePreferences, TranscriptEvent } from '../shared/types'
import type { ResizeDirection } from '../main/window-layout'

const defaultSettings: SubtitlePreferences = {
  mode: 'assistant',
  layout: 'split',
  background: 'glass',
  backgroundColor: '#0e1713',
  backgroundOpacity: 0.86,
  assistantColor: '#f1f6f3',
  userColor: '#fff1c9',
  fontSize: 24,
  opacity: 0.9,
  locked: false,
  visible: true,
  maxLines: 4
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
  | { status: 'loading'; query: string }
  | { status: 'ready'; result: DictionaryResult }
  | { status: 'error'; query: string; message: string }

export function SubtitleOverlay() {
  const [settings, setSettings] = useState<SubtitlePreferences>(defaultSettings)
  const [events, setEvents] = useState<TranscriptEvent[]>([])
  const [hoveredToolbar, setHoveredToolbar] = useState(false)
  const [lookupState, setLookupState] = useState<LookupState>()
  const lookupRequest = useRef(0)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const resizeStart = useRef<{ direction: ResizeDirection; origin: NonNullable<SubtitlePreferences['bounds']>; screenX: number; screenY: number } | undefined>(undefined)

  useEffect(() => {
    void window.speaksub.getState().then((state) => {
      setSettings(state.settings)
      setEvents(state.events)
    })
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
    return () => { removeEvents(); removeSettings() }
  }, [])

  const charactersPerLine = Math.max(10, Math.floor(((settings.bounds?.width ?? window.innerWidth) * 0.86 - 70) / settings.fontSize))
  const displayed = useMemo(() => subtitleEvents(events, settings.mode, settings.maxLines, charactersPerLine), [events, settings, charactersPerLine])
  useEffect(() => {
    const transcript = transcriptRef.current
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [displayed, settings.fontSize, settings.layout])
  const toolbarOpen = hoveredToolbar && !settings.locked
  const shellClass = ['subtitle-shell', settings.locked ? 'locked' : '', toolbarOpen ? 'toolbar-open' : '', `layout-${settings.layout}`, `background-${settings.background}`].filter(Boolean).join(' ')
  const style = {
    opacity: settings.opacity,
    fontSize: settings.fontSize,
    background: settings.background === 'transparent' ? 'transparent' : hexToRgba(settings.backgroundColor, settings.backgroundOpacity),
    '--assistant-color': settings.assistantColor,
    '--user-color': settings.userColor
  } as CSSProperties
  const update = (input: Partial<SubtitlePreferences>) => void window.speaksub.updateSubtitle(input)
  const unlock = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setHoveredToolbar(false)
    setSettings((current) => ({ ...current, locked: false }))
    void window.speaksub.setOverlayInteractive(true)
    update({ locked: false })
  }
  const beginResize = (direction: ResizeDirection, event: PointerEvent<HTMLDivElement>) => {
    if (settings.locked || !settings.bounds) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeStart.current = { direction, origin: settings.bounds, screenX: event.screenX, screenY: event.screenY }
  }
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current
    if (!start) return
    void window.speaksub.resizeOverlay(start.direction, start.origin, event.screenX - start.screenX, event.screenY - start.screenY)
  }
  const finishResize = () => { resizeStart.current = undefined }

  const lookupWord = async (word: string, context: string) => {
    const request = lookupRequest.current + 1
    lookupRequest.current = request
    setLookupState({ status: 'loading', query: word })
    try {
      const result = await window.speaksub.lookup(word, context)
      if (lookupRequest.current === request) setLookupState({ status: 'ready', result })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lookup failed. Check learning service settings.'
      if (lookupRequest.current === request) setLookupState({ status: 'error', query: word, message })
    }
  }

  return <div className={shellClass} style={style}>
    {!settings.locked && (['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as ResizeDirection[]).map((direction) => <div key={direction} className={`subtitle-resize-handle ${direction}`} onPointerDown={(event) => beginResize(direction, event)} onPointerMove={resize} onPointerUp={finishResize} onPointerCancel={finishResize}/>) }
    <div className="subtitle-toolbar-zone" onMouseEnter={() => setHoveredToolbar(true)} onMouseLeave={() => setHoveredToolbar(false)}>
      <div className="subtitle-drag-zone"><div className="subtitle-drag-bars" title="Drag subtitle"><span></span><span></span><span></span></div></div>
      <button className="subtitle-unlock" title="Unlock subtitle" style={{ visibility: settings.locked && hoveredToolbar ? 'visible' : 'hidden', pointerEvents: settings.locked && hoveredToolbar ? 'auto' : 'none', WebkitAppRegion: 'no-drag' } as CSSProperties} onPointerDown={unlock}>Unlock</button>
      <div className="subtitle-controls" onClick={(event) => event.stopPropagation()}>
        <label>Size<input aria-label="Subtitle size" type="range" min="18" max="38" value={settings.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })}/></label>
        <label>AI <input aria-label="AI subtitle color" type="color" value={settings.assistantColor} onChange={(event) => update({ assistantColor: event.target.value })}/></label>
        <label>Me <input aria-label="My subtitle color" type="color" value={settings.userColor} onChange={(event) => update({ userColor: event.target.value })}/></label>
        <button className="subtitle-lock" title="Lock subtitle" onClick={() => update({ locked: true })}>Lock</button>
      </div>
    </div>
    <div className="subtitle-transcript" ref={transcriptRef}>
      {displayed.length
        ? displayed.map((event) => <p className={`subtitle-line ${event.speaker}`} key={event.id}><b>{event.speaker === 'assistant' ? 'AI' : 'Me'}</b><span className="subtitle-text">{subtitleWordTokens(event.text).map((token, index) => token.clickable
          ? <button className="subtitle-word" key={index} onMouseEnter={() => { if (!settings.locked) void lookupWord(token.text, event.text) }} onFocus={() => { if (!settings.locked) void lookupWord(token.text, event.text) }} onClick={(click) => { click.stopPropagation(); if (!settings.locked) void lookupWord(token.text, event.text) }}>{token.text}</button>
          : <span className="subtitle-fragment" key={index}>{token.text}</span>)}</span></p>)
        : <p className="subtitle-empty">Start practice to show recent page text here.</p>}
    </div>
    {lookupState && <aside className="lookup-popover" onClick={(event) => event.stopPropagation()}>
      <button className="lookup-close" aria-label="Close lookup result" onClick={() => setLookupState(undefined)}>x</button>
      {lookupState.status === 'loading' && <><strong>{lookupState.query}</strong><p>Looking up...</p></>}
      {lookupState.status === 'error' && <><strong>{lookupState.query}</strong><p>{lookupState.message}</p></>}
      {lookupState.status === 'ready' && <><strong>{lookupState.result.query}</strong>{lookupState.result.phonetic && <small>/{lookupState.result.phonetic}/</small>}<p>{lookupState.result.definitions.join('; ') || lookupState.result.contextualMeaning || 'No definition returned.'}</p>{lookupState.result.naturalAlternative && <p>Natural: {lookupState.result.naturalAlternative}</p>}</>}
    </aside>}
  </div>
}
