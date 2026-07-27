// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeakSubApi, SubtitlePreferences } from '../shared/types'
import { SubtitleOverlay } from './subtitle-overlay'

const initialSettings: SubtitlePreferences = {
  mode: 'assistant', layout: 'split', background: 'glass', backgroundColor: '#0e1713', backgroundOpacity: 0.86,
  assistantColor: '#f1f6f3', userColor: '#fff1c9', fontSize: 24, opacity: 0.9, locked: false, visible: true, maxLines: 4
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let settings = initialSettings
let settingsListener: ((next: SubtitlePreferences) => void) | undefined
let transcriptListener: ((event: Parameters<SpeakSubApi['onTranscript']>[0] extends (event: infer Event) => void ? Event : never) => void) | undefined
let updateSubtitle: ReturnType<typeof vi.fn>
let setOverlayInteractive: ReturnType<typeof vi.fn>
let practiceActive = false
let endPractice: ReturnType<typeof vi.fn>
let practiceEndedListener: ((result: Parameters<SpeakSubApi['onPracticeEnded']>[0] extends (result: infer Result) => void ? Result : never) => void) | undefined

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  settings = { ...initialSettings }
  practiceActive = false
  endPractice = vi.fn(async () => undefined)
  setOverlayInteractive = vi.fn(async () => undefined)
  updateSubtitle = vi.fn(async (input: Partial<SubtitlePreferences>) => {
    settings = { ...settings, ...input }
    settingsListener?.(settings)
    return settings
  })
  const api = {
    getState: vi.fn(async () => ({ session: practiceActive ? { id: 'session-1', startedAt: 'now', correctionStrength: 'normal' } : undefined, settings, events: [], connection: {}, automation: {}, source: 'api-direct', mode: 'text', lifecycle: practiceActive ? 'active' : 'idle' })),
    updateSubtitle,
    setOverlayInteractive,
    endPractice,
    onTranscript: vi.fn((listener) => { transcriptListener = listener; return () => { transcriptListener = undefined } }),
    onSubtitleSettings: vi.fn((listener) => { settingsListener = listener; return () => { settingsListener = undefined } }),
    onAutomationStatus: vi.fn(() => () => undefined),
    onPracticeEnded: vi.fn((listener) => { practiceEndedListener = listener; return () => { practiceEndedListener = undefined } })
  } as unknown as SpeakSubApi
  window.speaksub = api
})

afterEach(() => { act(() => root.unmount()); container.remove() })

const renderOverlay = async () => {
  await act(async () => { root.render(<SubtitleOverlay/>); await Promise.resolve(); await Promise.resolve() })
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
})

describe('SubtitleOverlay transcript display', () => {
  it('collapses paragraph breaks from an AI response in the compact overlay', async () => {
    await renderOverlay()

    const event = { id: 'event-1', sessionId: 'session-1', sourceMessageId: 'message-1', speaker: 'assistant' as const, text: 'First sentence.\n\nSecond sentence.', status: 'complete' as const, receivedAt: 'now' }
    await act(async () => { transcriptListener?.(event); await Promise.resolve() })

    expect(container.querySelector('.subtitle-text')?.textContent).toBe('First sentence. Second sentence.')
  })

  it('marks an assistant subtitle that was interrupted by the user', async () => {
    await renderOverlay()

    const event = { id: 'event-2', sessionId: 'session-1', sourceMessageId: 'message-2', speaker: 'assistant' as const, text: 'I was still speaking.', status: 'complete' as const, interrupted: true, receivedAt: 'now' }
    await act(async () => { transcriptListener?.(event); await Promise.resolve() })

    expect(container.querySelector('.subtitle-line.interrupted b')?.textContent).toBe('AI · 已打断')
  })
})
