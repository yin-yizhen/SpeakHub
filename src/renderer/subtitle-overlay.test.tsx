// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeakSubApi, SubtitlePreferences } from '../shared/types'
import { SubtitleOverlay, subtitleCharactersPerLine } from './subtitle-overlay'

const initialSettings: SubtitlePreferences = {
  mode: 'assistant', background: 'glass', backgroundColor: '#0e1713', backgroundOpacity: 0.86,
  assistantColor: '#f1f6f3', userColor: '#fff1c9', fontSize: 24, opacity: 0.9, locked: false, visible: true, maxLines: 4
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let settings = initialSettings
let settingsListener: ((next: SubtitlePreferences) => void) | undefined
let transcriptListener: ((event: Parameters<SpeakSubApi['onTranscript']>[0] extends (event: infer Event) => void ? Event : never) => void) | undefined
let updateSubtitle: ReturnType<typeof vi.fn>
let setOverlayInteractive: ReturnType<typeof vi.fn>
let moveOverlay: ReturnType<typeof vi.fn>
let lookup: ReturnType<typeof vi.fn>
let practiceActive = false
let practiceMode: 'text' | 'voice' = 'text'
let endPractice: ReturnType<typeof vi.fn>
let sendPracticeMessage: ReturnType<typeof vi.fn>
let saveSessionSentence: ReturnType<typeof vi.fn>
let practiceEndedListener: ((result: Parameters<SpeakSubApi['onPracticeEnded']>[0] extends (result: infer Result) => void ? Result : never) => void) | undefined

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  settings = { ...initialSettings }
  practiceActive = false
  practiceMode = 'text'
  endPractice = vi.fn(async () => undefined)
  sendPracticeMessage = vi.fn(async () => undefined)
  saveSessionSentence = vi.fn(async (sourceMessageId: string) => ({ sourceMessageId, speaker: 'assistant' as const, text: 'hello world', savedAt: 'now' }))
  setOverlayInteractive = vi.fn(async () => undefined)
  moveOverlay = vi.fn(async () => settings)
  lookup = vi.fn(async (query: string) => ({ query, definitions: ['definition'] }))
  updateSubtitle = vi.fn(async (input: Partial<SubtitlePreferences>) => {
    settings = { ...settings, ...input }
    settingsListener?.(settings)
    return settings
  })
  const api = {
    getState: vi.fn(async () => ({ session: practiceActive ? { id: 'session-1', startedAt: 'now', correctionStrength: 'normal' } : undefined, settings, events: [], connection: {}, automation: {}, source: 'api-direct', mode: practiceMode, lifecycle: practiceActive ? 'active' : 'idle' })),
    updateSubtitle,
    setOverlayInteractive,
    moveOverlay,
    lookup,
    endPractice,
    sendPracticeMessage,
    saveSessionSentence,
    onTranscript: vi.fn((listener) => { transcriptListener = listener; return () => { transcriptListener = undefined } }),
    onSubtitleSettings: vi.fn((listener) => { settingsListener = listener; return () => { settingsListener = undefined } }),
    onAutomationStatus: vi.fn(() => () => undefined),
    onPracticeEnded: vi.fn((listener) => { practiceEndedListener = listener; return () => { practiceEndedListener = undefined } }),
    onVoiceAudio: vi.fn(() => () => undefined),
    onVoiceInterrupt: vi.fn(() => () => undefined),
    notifyVoicePlaybackEnded: vi.fn(async () => undefined)
  } as unknown as SpeakSubApi
  window.speaksub = api
})

afterEach(() => { act(() => root.unmount()); container.remove() })

const renderOverlay = async () => {
  await act(async () => { root.render(<SubtitleOverlay/>); await Promise.resolve(); await Promise.resolve() })
}

const pointerEvent = (type: string, input: { pointerId: number; screenX: number; screenY: number; buttons?: number }) => {
  const event = new MouseEvent(type, { bubbles: true, button: 0, buttons: input.buttons ?? 1, screenX: input.screenX, screenY: input.screenY })
  Object.defineProperty(event, 'pointerId', { value: input.pointerId })
  return event
}

describe('SubtitleOverlay lock controls', () => {
  it('keeps the three-bar unlock handle while hiding regular controls', async () => {
    await renderOverlay()
    const lock = container.querySelector<HTMLButtonElement>('.subtitle-lock')!
    expect(lock.textContent).toBe('Lock')

    await act(async () => { lock.click(); await Promise.resolve() })

    expect(updateSubtitle).toHaveBeenCalledWith({ locked: true })
    expect(container.querySelector('.subtitle-drag-zone')).toBeNull()
    expect(container.querySelector('.subtitle-controls')).toBeNull()
    expect(container.querySelector('.subtitle-close')).toBeNull()
    expect(container.querySelector('.subtitle-lock-handle')).not.toBeNull()
    expect(container.querySelector('.subtitle-unlock')).toBeNull()

    const toolbar = container.querySelector<HTMLDivElement>('.subtitle-toolbar-zone')!
    await act(async () => { toolbar.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await Promise.resolve() })
    expect(container.querySelector('.toolbar-open')).not.toBeNull()
    const unlock = container.querySelector<HTMLButtonElement>('.subtitle-unlock')!
    expect(unlock.textContent).toBe('Unlock')
    await act(async () => { unlock.click(); await Promise.resolve() })
    expect(updateSubtitle).toHaveBeenLastCalledWith({ locked: false })
  })

  it('places the active-session ending action to the left of the horizontal close action', async () => {
    practiceActive = true
    await renderOverlay()

    const actionRow = container.querySelector('.subtitle-action-row')!
    const endButton = actionRow.querySelector<HTMLButtonElement>('.subtitle-end-practice')!
    const closeButton = actionRow.querySelector<HTMLButtonElement>('.subtitle-close')!
    expect(endButton.textContent).toBe('结束对话')
    expect(closeButton.textContent).toBe('关闭字幕')
    expect(Array.from(actionRow.children)).toEqual([endButton, closeButton])

    await act(async () => { endButton.click(); await Promise.resolve() })
    expect(endPractice).toHaveBeenCalledOnce()
    expect(endButton.disabled).toBe(true)

    await act(async () => { practiceEndedListener?.({} as Parameters<NonNullable<typeof practiceEndedListener>>[0]); await Promise.resolve() })
    expect(container.querySelector('.subtitle-end-practice')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('.subtitle-close')?.textContent).toBe('关闭字幕')
  })
})

describe('SubtitleOverlay mouse passthrough', () => {
  it('only captures the mouse over interactive subtitle elements and keeps the lock handle interactive', async () => {
    await renderOverlay()
    expect(setOverlayInteractive).toHaveBeenLastCalledWith(false)
    setOverlayInteractive.mockClear()

    const event = { id: 'event-1', sessionId: 'session-1', sourceMessageId: 'message-1', speaker: 'assistant' as const, text: 'hello world', status: 'complete' as const, receivedAt: 'now' }
    await act(async () => { transcriptListener?.(event); await Promise.resolve() })

    const shell = container.querySelector<HTMLDivElement>('.subtitle-shell')!
    const word = container.querySelector<HTMLButtonElement>('.subtitle-word')!
    const toolbar = container.querySelector<HTMLDivElement>('.subtitle-toolbar-zone')!
    await act(async () => { word.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); await Promise.resolve() })
    expect(setOverlayInteractive).toHaveBeenLastCalledWith(true)

    await act(async () => { shell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); await Promise.resolve() })
    expect(setOverlayInteractive).toHaveBeenLastCalledWith(false)

    await act(async () => { toolbar.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); await Promise.resolve() })
    expect(setOverlayInteractive).toHaveBeenLastCalledWith(true)

    await act(async () => { settingsListener?.({ ...settings, locked: true }); await Promise.resolve() })
    expect(setOverlayInteractive).toHaveBeenLastCalledWith(false)
    setOverlayInteractive.mockClear()

    await act(async () => { word.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); await Promise.resolve() })
    expect(setOverlayInteractive).not.toHaveBeenCalledWith(true)

    const lockHandle = container.querySelector<HTMLDivElement>('.subtitle-lock-handle')!
    await act(async () => { lockHandle.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); await Promise.resolve() })
    expect(setOverlayInteractive).toHaveBeenLastCalledWith(true)
  })

  it('dismisses a pinned word lookup after focus moves to another app', async () => {
    await renderOverlay()
    const event = { id: 'event-2', sessionId: 'session-1', sourceMessageId: 'message-2', speaker: 'assistant' as const, text: 'hello world', status: 'complete' as const, receivedAt: 'now' }
    await act(async () => { transcriptListener?.(event); await Promise.resolve() })

    const word = container.querySelector<HTMLButtonElement>('.subtitle-word')!
    await act(async () => { word.click(); await Promise.resolve(); await Promise.resolve() })
    expect(container.querySelector('.lookup-popover.pinned')).not.toBeNull()

    const shell = container.querySelector<HTMLDivElement>('.subtitle-shell')!
    await act(async () => { shell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); await Promise.resolve() })
    expect(container.querySelector('.lookup-popover.pinned')).not.toBeNull()

    await act(async () => { window.dispatchEvent(new Event('blur')); await Promise.resolve() })
    expect(container.querySelector('.lookup-popover')).toBeNull()
  })

  it('keeps moving the unlocked overlay after the pointer leaves the narrow drag handle', async () => {
    settings = { ...initialSettings, bounds: { x: 100, y: 200, width: 600, height: 240 } }
    await renderOverlay()
    const dragHandle = container.querySelector<HTMLDivElement>('.subtitle-drag-zone')!
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    dragHandle.setPointerCapture = setPointerCapture
    dragHandle.hasPointerCapture = vi.fn(() => true)
    dragHandle.releasePointerCapture = releasePointerCapture
    await act(async () => {
      dragHandle.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, screenX: 300, screenY: 400 }))
      dragHandle.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, screenX: 900, screenY: 50 }))
      dragHandle.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, screenX: 900, screenY: 50, buttons: 0 }))
      await Promise.resolve()
    })
    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(moveOverlay).toHaveBeenCalledWith({ x: 100, y: 200, width: 600, height: 240 }, 600, -350)
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
  })
})

describe('SubtitleOverlay transcript display', () => {
  it('uses equal 57px text gutters without reserving extra wrapping width', () => {
    expect(subtitleCharactersPerLine(1664, 24)).toBe(64)
    expect(subtitleCharactersPerLine(320, 38)).toBe(10)
  })

  it('collapses paragraph breaks from an AI response in the compact overlay', async () => {
    await renderOverlay()

    const event = { id: 'event-1', sessionId: 'session-1', sourceMessageId: 'message-1', speaker: 'assistant' as const, text: 'First sentence.\n\nSecond sentence.', status: 'complete' as const, receivedAt: 'now' }
    await act(async () => { transcriptListener?.(event); await Promise.resolve() })

    expect(container.querySelector('.subtitle-text')?.textContent).toBe('First sentence. Second sentence.')
  })

  it('updates one assistant subtitle repeatedly before the reply is complete', async () => {
    practiceActive = true
    await renderOverlay()

    await act(async () => {
      transcriptListener?.({ id: 'stream-1', sessionId: 'session-1', sourceMessageId: 'assistant-stream', speaker: 'assistant', text: 'The weather', status: 'streaming', receivedAt: 'now' })
      await Promise.resolve()
    })
    expect(container.querySelector('.subtitle-text')?.textContent).toBe('The weather')
    expect(container.querySelector('.subtitle-sentence-save')).toBeNull()

    await act(async () => {
      transcriptListener?.({ id: 'stream-2', sessionId: 'session-1', sourceMessageId: 'assistant-stream', speaker: 'assistant', text: 'The weather is perfect for your interview.', status: 'streaming', receivedAt: 'later' })
      await Promise.resolve()
    })
    expect(container.querySelectorAll('.subtitle-line')).toHaveLength(1)
    expect(container.querySelector('.subtitle-text')?.textContent).toBe('The weather is perfect for your interview.')
    expect(container.querySelector('.subtitle-sentence-save')).toBeNull()

    await act(async () => {
      transcriptListener?.({ id: 'stream-3', sessionId: 'session-1', sourceMessageId: 'assistant-stream', speaker: 'assistant', text: 'The weather is perfect for your interview.', status: 'complete', receivedAt: 'done' })
      await Promise.resolve()
    })
    expect(container.querySelectorAll('.subtitle-line')).toHaveLength(1)
    expect(container.querySelector('.subtitle-sentence-save')).not.toBeNull()
  })

  it('marks an assistant subtitle that was interrupted by the user', async () => {
    await renderOverlay()

    const event = { id: 'event-2', sessionId: 'session-1', sourceMessageId: 'message-2', speaker: 'assistant' as const, text: 'I was still speaking.', status: 'complete' as const, interrupted: true, receivedAt: 'now' }
    await act(async () => { transcriptListener?.(event); await Promise.resolve() })

    expect(container.querySelector('.subtitle-line.interrupted b')?.textContent).toBe('AI · 已打断')
  })

  it.each(['text', 'voice'] as const)('saves a complete %s conversation sentence from the subtitle ending', async (mode) => {
    practiceActive = true
    practiceMode = mode
    await renderOverlay()

    const event = { id: 'event-save', sessionId: 'session-1', sourceMessageId: `message-${mode}`, speaker: 'assistant' as const, text: 'Keep this whole sentence.', status: 'complete' as const, receivedAt: 'now' }
    await act(async () => { transcriptListener?.(event); await Promise.resolve() })

    const save = container.querySelector<HTMLButtonElement>('.subtitle-sentence-save')!
    expect(save.textContent).toBe('收藏句子')
    await act(async () => { save.click(); await Promise.resolve(); await Promise.resolve() })

    expect(saveSessionSentence).toHaveBeenCalledWith(`message-${mode}`)
    expect(save.textContent).toBe('已收藏')
    expect(save.disabled).toBe(true)
  })
})

describe('SubtitleOverlay text composer', () => {
  it('keeps the composer editable and sends a replacement while AI is replying', async () => {
    practiceActive = true
    const completeSends: Array<() => void> = []
    sendPracticeMessage.mockImplementation(() => new Promise<void>((resolve) => { completeSends.push(resolve) }))
    await renderOverlay()

    const form = container.querySelector<HTMLFormElement>('.subtitle-composer')!
    const input = form.querySelector<HTMLInputElement>('input')!
    const send = form.querySelector<HTMLButtonElement>('button')!
    expect(send.disabled).toBe(true)
    expect(form.getAttribute('aria-busy')).toBe('false')
    const speakReply = form.querySelector<HTMLInputElement>('[aria-label="朗读 AI 回复"]')!
    expect(speakReply.checked).toBe(false)

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Hello')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    expect(send.disabled).toBe(false)

    await act(async () => { speakReply.click(); await Promise.resolve() })
    expect(speakReply.checked).toBe(true)

    await act(async () => { send.click(); await Promise.resolve() })
    expect(sendPracticeMessage).toHaveBeenCalledWith('Hello', true)
    expect(input.disabled).toBe(false)
    expect(speakReply.disabled).toBe(false)
    expect(send.disabled).toBe(true)
    expect(form.getAttribute('aria-busy')).toBe('true')
    expect(send.textContent).toBe('发送')

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Wait')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })
    expect(send.disabled).toBe(false)
    expect(send.getAttribute('aria-label')).toBe('打断当前回复并发送')

    await act(async () => { send.click(); await Promise.resolve() })
    expect(sendPracticeMessage).toHaveBeenNthCalledWith(2, 'Wait', true)

    await act(async () => { completeSends[0](); await Promise.resolve() })
    expect(form.getAttribute('aria-busy')).toBe('true')

    await act(async () => { completeSends[1](); await Promise.resolve() })
    expect(form.getAttribute('aria-busy')).toBe('false')
  })
})
