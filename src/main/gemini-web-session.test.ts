// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiWebSession, selectAIStudioLoginCookies } from './gemini-web-session'
import { readAIStudioSnapshot } from './ai-studio-page-dom'

type Snapshot = ReturnType<typeof readAIStudioSnapshot> & { document: number }
const snapshot = (text = 'Hello', document = 1): Snapshot => ({ document, turnCount: 1, emptyUserTurns: 0, rows: [{ sourceMessageId: 'aistudio-web-turn-0', speaker: 'assistant', text, status: 'complete' }] })
afterEach(() => vi.restoreAllMocks())

describe('Gemini browser capture', () => {
  it('mutes native output before blocked cleanup and retains silence if page controls fail', async () => {
    const setAudioMuted = vi.fn()
    const service = new GeminiWebSession('unused', undefined, { contents: () => ({ isDestroyed: () => false, setAudioMuted }) as never, show: vi.fn(), hide: vi.fn() })
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const drain = vi.fn(async () => undefined)
    Object.assign(service, { setMicrophone: () => pending, clickControl: async () => { throw new Error('Page navigated') }, drain })
    const ending = service.pauseAndFlush()
    expect(setAudioMuted).toHaveBeenCalledWith(true)
    expect(drain).not.toHaveBeenCalled()
    release()
    await ending
    await service.disconnect()
    expect(drain).toHaveBeenCalledWith(true)
    expect(setAudioMuted.mock.calls.every(([muted]) => muted === true)).toBe(true)
  })

  it('unmutes only after a fresh practice is ready and keeps a cancelled preparation muted', async () => {
    const setAudioMuted = vi.fn()
    let release!: () => void
    const contents = { isDestroyed: () => false, setAudioMuted, loadURL: () => new Promise<void>(resolve => { release = resolve }) }
    const service = new GeminiWebSession('unused', undefined, { contents: () => contents as never, show: vi.fn(), hide: vi.fn() })
    Object.assign(service, { evaluate: async () => true, installMicrophone: async () => undefined })
    const selection = { deviceId: 'default', label: '', labelIndex: 0 }
    const preparing = service.prepare(new AbortController().signal, selection, false)
    expect(setAudioMuted.mock.calls).toEqual([[true]])
    release()
    await preparing
    expect(setAudioMuted.mock.calls).toEqual([[true], [false]])
    setAudioMuted.mockClear()
    const controller = new AbortController()
    const cancelled = service.prepare(controller.signal, selection, false)
    controller.abort(); release()
    await expect(cancelled).rejects.toThrow('已取消')
    expect(setAudioMuted.mock.calls).toEqual([[true]])
  })

  it('opens and hides the embedded page without launching an external browser', async () => {
    const contents = { getURL: () => '', loadURL: vi.fn(async () => undefined) }
    const show = vi.fn(), hide = vi.fn()
    const service = new GeminiWebSession('unused', undefined, { contents: () => contents as never, show, hide })
    await service.open()
    expect(contents.loadURL).toHaveBeenCalledWith('https://aistudio.google.com/live?model=gemini-3.8-live')
    expect(show).toHaveBeenCalledOnce()
    service.hide()
    expect(hide).toHaveBeenCalledOnce()
  })
  it('limits login import to secure unpartitioned Google parent and AI Studio cookies', () => {
    const cookie = { name: 'SID', value: 'test-secret', domain: '.google.com', path: '/', secure: true, httpOnly: true, expires: 0 }
    expect(selectAIStudioLoginCookies([cookie, { ...cookie, domain: 'aistudio.google.com' }, { ...cookie, domain: 'mail.google.com' }, { ...cookie, domain: 'google.com.evil.test' }, { ...cookie, domain: '.chatgpt.com' }, { ...cookie, secure: false }, { ...cookie, partitionKey: {} }])).toEqual([cookie, { ...cookie, domain: 'aistudio.google.com' }])
  })
  it('deduplicates polls but gives reloads and reset turns a new identity', async () => {
    const service = new GeminiWebSession('unused')
    const state = { value: snapshot() }
    Object.assign(service, { snapshot: async () => state.value, installMicrophone: async () => undefined })
    const events = vi.fn(), warnings = vi.fn()
    service.startCapture(events, warnings)
    await vi.waitFor(() => expect(events).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(events).toHaveBeenCalledTimes(1)
    state.value = snapshot('New document', 2)
    await vi.waitFor(() => expect(events).toHaveBeenCalledTimes(2))
    expect(events.mock.calls[0][0].sourceMessageId).not.toBe(events.mock.calls[1][0].sourceMessageId)
    expect(warnings).toHaveBeenCalledOnce()
    service.stopCapture()
  })

  it('drops a late snapshot after capture stops and reports missing speech without fabricating rows', async () => {
    const service = new GeminiWebSession('unused')
    let finish!: (value: Snapshot) => void
    Object.assign(service, { snapshot: () => new Promise(resolve => { finish = resolve }) })
    const events = vi.fn(), warnings = vi.fn()
    service.startCapture(events, warnings)
    service.stopCapture()
    finish({ ...snapshot(), emptyUserTurns: 1 })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(events).not.toHaveBeenCalled()
    expect(warnings).not.toHaveBeenCalled()
  })

  it('warns about missing user text while still saving available attributed speech', async () => {
    const service = new GeminiWebSession('unused')
    Object.assign(service, { snapshot: async () => ({ ...snapshot(), emptyUserTurns: 1 }) })
    const events = vi.fn(), warnings = vi.fn()
    service.startCapture(events, warnings)
    await vi.waitFor(() => expect(events).toHaveBeenCalledOnce())
    expect(warnings.mock.calls[0][0]).toContain('1 条用户语音缺少文字')
    service.stopCapture()
  })

  it.each(['external', 'embedded'])('%s input confirms submission and preserves unrelated drafts', async transport => {
    let focused = transport !== 'embedded'
    const command = vi.fn(async (method: string, input: { text?: string; type?: string }) => {
      if (method === 'Emulation.setFocusEmulationEnabled') focused = true
      if (method.startsWith('Input.')) expect(focused).toBe(true)
      if (method === 'Input.insertText') document.querySelector('textarea')!.value = input.text!
      if (method === 'Input.dispatchMouseEvent' && input.type === 'mouseReleased') document.querySelector<HTMLButtonElement>('ms-run-button button')!.click()
    })
    const service = new GeminiWebSession('unused', undefined, transport === 'embedded' ? { contents: () => ({ debugger: { isAttached: () => true, sendCommand: command } }) as never, show: vi.fn(), hide: vi.fn() } : undefined)
    document.body.innerHTML = '<ms-bidi-ui><ms-paid-api-key-button><button aria-label="No API key selected"></button></ms-paid-api-key-button><ms-bidi-input><textarea></textarea><ms-run-button><button>Run</button></ms-run-button></ms-bidi-input></ms-bidi-ui>'
    Object.assign(service, { evaluate: async (expression: string) => window.eval(expression) })
    const button = document.querySelector<HTMLButtonElement>('ms-run-button button')!
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, width: 40, height: 20 } as DOMRect)
    Object.assign(service, { page: { command } })
    const click = vi.fn(() => {
      const input = document.querySelector('textarea')!
      const turn = document.createElement('ms-bidi-turn')
      turn.innerHTML = '<div class="turn user"><ms-bidi-text-part></ms-bidi-text-part></div>'
      turn.querySelector('ms-bidi-text-part')!.textContent = input.value
      input.value = ''
      document.body.append(turn)
    })
    button.addEventListener('click', click)
    await service.send('Practice English.')
    expect(click).toHaveBeenCalledOnce()
    document.querySelector('textarea')!.value = 'My unsent draft'
    await expect(service.send('Replace it')).rejects.toThrow('草稿')
    expect(document.querySelector('textarea')!.value).toBe('My unsent draft')
    document.querySelector('textarea')!.value = 'Retry exactly this summary.'
    command.mockClear()
    await service.send('Retry exactly this summary.', true)
    expect(command.mock.calls.some(([method]) => method === 'Input.insertText')).toBe(false)
    expect(click).toHaveBeenCalledTimes(2)
  })
  it('does not send when the page has a paid key selected or its free state is unknown', async () => {
    const service = new GeminiWebSession('unused')
    document.body.innerHTML = '<ms-paid-api-key-button><button aria-label="Paid API key selected"></button></ms-paid-api-key-button>'
    const command = vi.fn()
    Object.assign(service, { evaluate: async (expression: string) => window.eval(expression), page: { command } })
    await expect(service.send('Hello')).rejects.toThrow('未选择 API Key')
    expect(command).not.toHaveBeenCalled()
  })
})
