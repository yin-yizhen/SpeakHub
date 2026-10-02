// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { ChatGPTAdapter, parseChatGPTPage } from './chatgpt-adapter'

describe('ChatGPT DOM fixture', () => {
  it('reads only attributable visible message text', () => {
    document.body.innerHTML = '<article data-testid="conversation-turn-1" data-message-author-role="assistant" data-message-id="a1">That makes sense.</article><article data-testid="conversation-turn-2" data-message-author-role="user" data-message-id="u1">I agree.</article><div>unattributed page chrome</div>'
    expect(parseChatGPTPage(document)).toEqual([
      { sourceMessageId: 'a1', speaker: 'assistant', text: 'That makes sense.', status: 'complete' },
      { sourceMessageId: 'u1', speaker: 'user', text: 'I agree.', status: 'complete' }
    ])
  })

  it('does not duplicate a nested message role inside a conversation turn', () => {
    document.body.innerHTML = '<article id="turn-1" data-testid="conversation-turn-1"><div data-message-author-role="assistant" data-message-id="a1">Hello there.</div></article>'
    expect(parseChatGPTPage(document)).toEqual([{ sourceMessageId: 'a1', speaker: 'assistant', text: 'Hello there.', status: 'complete' }])
  })

  it('reads the September ChatGPT message units without legacy role attributes or articles', () => {
    document.body.innerHTML = `<div data-content-search-unit-key="fallback-turn-0:0:user">
      <div data-user-message-bubble="true"><div data-search-result-target>Practice English</div><button>显示更多</button></div>
      <button>复制</button></div>
      <div data-content-search-unit-key="fallback-turn-0:2:assistant" data-chatgpt-search-message-ids="a1 a1">
      <h4 data-conversation-role="assistant">ChatGPT 说：</h4>
      <div data-chatgpt-selection-message-id="a1"><div data-markdown-text-style="assistant-message"><p>Hello.</p><p>How are you?</p></div></div></div>
      <div data-content-search-unit-key="fallback-turn-0:1:reasoning">Private thinking</div>`
    expect(parseChatGPTPage(document)).toEqual([
      { sourceMessageId: 'fallback-turn-0:0:user', speaker: 'user', text: 'Practice English', status: 'complete' },
      { sourceMessageId: 'a1', speaker: 'assistant', text: 'Hello.\nHow are you?', status: 'complete' }
    ])
  })

  it('finalizes a streamed current-format message when only the stop-button label changes', () => {
    vi.useFakeTimers()
    const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
    document.body.innerHTML = ''
    const adapter = new ChatGPTAdapter({ executeJavaScript: async (script: string) => window.eval(script), isDestroyed: () => false } as never, vi.fn(), vi.fn())
    try {
      adapter.start()
      document.body.innerHTML = '<button aria-label="停止"></button><div data-content-search-unit-key="t:0:assistant" data-chatgpt-search-message-ids="a1"><div data-markdown-text-style="assistant-message">Hello</div></div>'
      expect(window.eval('window.__speaksubDrain()')).toEqual([{ sourceMessageId: 'a1', speaker: 'assistant', text: 'Hello', status: 'streaming' }])
      document.querySelector('button')!.setAttribute('aria-label', '开始语音')
      expect(window.eval('window.__speaksubDrain()')).toEqual([{ sourceMessageId: 'a1', speaker: 'assistant', text: 'Hello', status: 'complete' }])
      expect(window.eval('window.__speaksubDrain()')).toEqual([])
    } finally { adapter.stop(); rects.mockRestore(); vi.useRealTimers() }
  })

  it('recovers after transient page execution failure and emits messages that already exist on the new document', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<div data-content-search-unit-key="t:0:assistant" data-chatgpt-search-message-ids="a1"><div data-markdown-text-style="assistant-message">Recovered reply</div></div>'
    const onEvent = vi.fn()
    const onUnsupported = vi.fn()
    const executeJavaScript = vi.fn().mockRejectedValueOnce(new Error('Execution context was destroyed')).mockImplementation(async (script: string) => window.eval(script))
    const adapter = new ChatGPTAdapter({ executeJavaScript, isDestroyed: () => false } as never, onEvent, onUnsupported)
    try {
      adapter.start()
      await vi.advanceTimersByTimeAsync(700)
      expect(onEvent).toHaveBeenCalledOnce()
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ sourceMessageId: 'a1', text: 'Recovered reply' }))
      expect(onUnsupported).not.toHaveBeenCalled()
      // A new document has no observer, even though its messages are present.
      window.eval('window.__speaksubStop()')
      document.body.innerHTML = '<div data-content-search-unit-key="t:0:assistant" data-chatgpt-search-message-ids="a2"><div data-markdown-text-style="assistant-message">New document reply</div></div>'
      await vi.advanceTimersByTimeAsync(350)
      expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ sourceMessageId: 'a2', text: 'New document reply' }))
    } finally { adapter.stop(); await Promise.resolve(); vi.useRealTimers() }
  })

  it('continues recovering after a persistent-read warning and discards late results after stop', async () => {
    vi.useFakeTimers()
    const onEvent = vi.fn()
    const onUnsupported = vi.fn()
    const executeJavaScript = vi.fn().mockRejectedValue(new Error('Page unavailable'))
    const adapter = new ChatGPTAdapter({ executeJavaScript, isDestroyed: () => false } as never, onEvent, onUnsupported)
    try {
      adapter.start()
      await vi.advanceTimersByTimeAsync(1_750)
      expect(onUnsupported).toHaveBeenCalledOnce()
      let finish!: (rows: unknown) => void
      executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      await vi.advanceTimersByTimeAsync(350)
      adapter.stop()
      finish([{ sourceMessageId: 'stale', speaker: 'assistant', text: 'Late reply', status: 'complete' }])
      await Promise.resolve(); await Promise.resolve()
      expect(onEvent).not.toHaveBeenCalled()
    } finally { adapter.stop(); vi.useRealTimers() }
  })
})
