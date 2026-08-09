// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { ChatGPTAutomation, fillComposer, findComposer, findConversationMenuButton, findConversationRow, findDeleteConfirmationButton, findDeleteMenuItem, findEndVoiceButton, findSendButton, findStopButton, findVoiceButton } from './chatgpt-automation'

describe('ChatGPT page automation selectors', () => {
  it('checks the real ChatGPT session instead of treating the logged-out composer as signed in', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue(false)
    const automation = new ChatGPTAutomation({ executeJavaScript } as never)

    await expect(automation.isAuthenticated()).resolves.toBe(false)
    expect(executeJavaScript.mock.calls[0][0]).toContain("fetch('/api/auth/session'")
    expect(executeJavaScript.mock.calls[0][0]).toContain('session.user')
  })

  it('fills the composer and finds send and voice controls', () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true"></div><button aria-label="发送消息"></button><button aria-label="开始语音聊天"></button>'
    const composer = findComposer(document)
    expect(composer).toBeTruthy()
    fillComposer(composer!, 'Travel practice')
    expect(composer?.textContent).toBe('Travel practice')
    expect(findSendButton(document)).toBeTruthy()
    expect(findVoiceButton(document)).toBeTruthy()
  })

  it('returns no controls from an incompatible fixture', () => {
    document.body.innerHTML = '<main>Unsupported page</main>'
    expect(findComposer(document)).toBeUndefined()
    expect(findSendButton(document)).toBeUndefined()
    expect(findVoiceButton(document)).toBeUndefined()
  })

  it('recognises the current Chinese and English ChatGPT composer labels', () => {
    document.body.innerHTML = '<div contenteditable="true" aria-label="notes"></div><div contenteditable="plaintext-only" data-placeholder="问问 ChatGPT"></div>'
    expect(findComposer(document)?.getAttribute('data-placeholder')).toBe('问问 ChatGPT')

    document.body.innerHTML = '<div contenteditable="plaintext-only" data-placeholder="询问 ChatGPT"></div>'
    expect(findComposer(document)?.getAttribute('data-placeholder')).toBe('询问 ChatGPT')

    document.body.innerHTML = '<div contenteditable="plaintext-only" aria-label="Message ChatGPT"></div>'
    expect(findComposer(document)?.getAttribute('aria-label')).toBe('Message ChatGPT')

  })

  it('waits for the composer to appear after a new chat before sending', async () => {
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ focused: false, diagnostics: [{ id: 'loading' }] })
      .mockResolvedValueOnce({ focused: true, diagnostics: [{ id: 'prompt-textarea' }] })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    const insertText = vi.fn()
    const automation = new ChatGPTAutomation({ executeJavaScript, insertText } as never)

    await expect(automation.fillAndSendPrompt('Travel practice')).resolves.toMatchObject({ ok: true })
    expect(insertText).toHaveBeenCalledWith('Travel practice')
    expect(executeJavaScript).toHaveBeenCalledTimes(4)
  })

  it('types the prompt once, then immediately clicks send', async () => {
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ focused: true, diagnostics: [{ id: 'prompt-textarea' }] })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    const insertText = vi.fn()
    const sendInputEvent = vi.fn()
    const automation = new ChatGPTAutomation({ executeJavaScript, insertText, sendInputEvent } as never)

    await expect(automation.fillAndSendPrompt('Travel practice')).resolves.toMatchObject({ ok: true })
    expect(insertText).toHaveBeenCalledTimes(1)
    expect(sendInputEvent).not.toHaveBeenCalled()
    const scripts = (executeJavaScript.mock.calls as unknown as Array<[string]>).map(([script]) => script)
    expect(scripts[1]).toContain('composerRect')
  })

  it('searches the whole page for the send button beside the composer', async () => {
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ focused: true, diagnostics: [{ id: 'prompt-textarea' }] })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    const automation = new ChatGPTAutomation({ executeJavaScript, insertText: vi.fn() } as never)

    await expect(automation.fillAndSendPrompt('Travel practice')).resolves.toMatchObject({ ok: true })
    const scripts = (executeJavaScript.mock.calls as unknown as Array<[string]>).map(([script]) => script)
    const sendScript = scripts.find((script) => script.includes('composerRect'))!
    expect(sendScript).toContain("document.querySelectorAll('button:not([disabled])')")
    expect(sendScript).toContain('composerRect.width * 0.55')
    expect(sendScript).not.toContain("composer.closest('form')")
  })

  it('recognises the generation stop control separately from voice', () => {
    document.body.innerHTML = '<button data-testid="stop-button" aria-label="停止生成"></button><button data-testid="voice-mode-button" aria-label="开始语音聊天"></button>'
    expect(findStopButton(document)).toBeTruthy()
    expect(findVoiceButton(document)).toBeTruthy()
  })

  it('clicks the visible generation stop control before a replacement prompt', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const automation = new ChatGPTAutomation({ executeJavaScript } as never)

    await expect(automation.stopGenerating()).resolves.toBe(true)
    const [script] = (executeJavaScript.mock.calls as unknown as Array<[string]>)[0]!
    expect(script).toContain('data-testid*')
    expect(script).toContain('button.click()')
  })

  it('recognises the dedicated voice-session end control', () => {
    document.body.innerHTML = '<button aria-label="结束语音聊天"></button><button aria-label="开始语音聊天"></button>'
    expect(findEndVoiceButton(document)?.getAttribute('aria-label')).toBe('结束语音聊天')
  })

  it('finds only the target conversation row and its ellipsis menu', () => {
    document.body.innerHTML = `
      <div class="conversation-row"><a href="/c/other">Other chat</a><button data-testid="conversation-options-button">…</button></div>
      <div class="conversation-row"><a href="/c/target">English Conversation</a><button data-testid="conversation-options-button">…</button></div>`

    const row = findConversationRow(document, 'https://chatgpt.com/c/target')
    expect(row?.textContent).toContain('English Conversation')
    expect(row?.textContent).not.toContain('Other chat')
    expect(findConversationMenuButton(row!)?.getAttribute('data-testid')).toBe('conversation-options-button')
  })

  it('scopes the Chinese or English delete action to the opened menu', () => {
    document.body.innerHTML = `
      <button>删除</button>
      <div role="menu"><button role="menuitem">重命名</button><button role="menuitem">删除</button></div>
      <div role="menu"><button role="menuitem">Delete</button></div>`
    const menus = document.querySelectorAll('[role="menu"]')
    expect(findDeleteMenuItem(menus[0]!)?.textContent).toBe('删除')
    expect(findDeleteMenuItem(menus[1]!)?.textContent).toBe('Delete')
  })

  it('clicks only the confirmation delete button within its dialog', () => {
    document.body.innerHTML = `
      <button>删除</button>
      <div role="dialog"><button>取消</button><button>删除</button></div>`
    const dialog = document.querySelector('[role="dialog"]')!
    expect(findDeleteConfirmationButton(dialog)?.textContent).toBe('删除')
  })

  it('uses hover, scoped menu and scoped confirmation before checking that the target row disappears', async () => {
    const executeJavaScript = vi.fn(async () => ({ ok: true, message: 'deleted' }))
    const automation = new ChatGPTAutomation({ loadURL: vi.fn(), executeJavaScript } as never)

    await expect(automation.deleteConversation('https://chatgpt.com/c/target')).resolves.toMatchObject({ ok: true })
    const [script] = (executeJavaScript.mock.calls as unknown as Array<[string]>)[0]!
    expect(script).toContain("mouseenter")
    expect(script).toContain("conversation-options")
    expect(script).toContain("[role=\"menu\"]")
    expect(script).toContain("[role=\"dialog\"]")
    expect(script).toContain("if (!targetLink())")
  })

  it('captures the ChatGPT-generated sidebar title and can delete by that title', async () => {
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ ok: true, conversationTitle: '英语口语练习' })
      .mockResolvedValueOnce({ ok: true, message: 'deleted' })
    const automation = new ChatGPTAutomation({ executeJavaScript } as never)

    await expect(automation.captureConversationTitle('https://chatgpt.com/c/target')).resolves.toBe('英语口语练习')
    await expect(automation.deleteConversationByTitle('英语口语练习')).resolves.toMatchObject({ ok: true })

    expect(executeJavaScript.mock.calls[0]?.[0]).toContain('conversationTitle')
    expect(executeJavaScript.mock.calls[1]?.[0]).toContain('title:英语口语练习')
  })

  it('waits for ChatGPT to finish its first reply before starting voice', async () => {
    const executeJavaScript = vi.fn(async () => ({ ok: true, message: 'voice started' }))
    const automation = new ChatGPTAutomation({ executeJavaScript } as never)

    await expect(automation.waitForReplyAndStartVoice()).resolves.toMatchObject({ ok: true })
    expect(executeJavaScript).toHaveBeenCalledOnce()
    const [script] = (executeJavaScript.mock.calls as unknown as Array<[string]>)[0]!
    expect(script).toContain('voice.click()')
    expect(script).toContain('endSelector')
    expect(script).toContain('hasAssistantReply')
    expect(script).toContain('conversation-turn-')
    expect(script).toContain('45000')
  })

  it('re-reads the visible composer after sending instead of trusting a stale cached node', async () => {
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ focused: true, diagnostics: [{ id: 'prompt-textarea' }] })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    const automation = new ChatGPTAutomation({ executeJavaScript, insertText: vi.fn() } as never)

    await expect(automation.fillAndSendPrompt('Travel practice')).resolves.toMatchObject({ ok: true })
    const scripts = (executeJavaScript.mock.calls as unknown as Array<[string]>).map(([script]) => script)
    expect(scripts.some((script) => script.includes('window.__speaksubComposer ||'))).toBe(false)
    expect(scripts.some((script) => script.includes('data-message-author-role="user"'))).toBe(true)
  })
})
