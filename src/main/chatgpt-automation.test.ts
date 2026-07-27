// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { ChatGPTAutomation, fillComposer, findComposer, findConversationMenuButton, findConversationRow, findDeleteConfirmationButton, findDeleteMenuItem, findEndVoiceButton, findSendButton, findStopButton, findVoiceButton } from './chatgpt-automation'

describe('ChatGPT page automation selectors', () => {
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

  it('prefers the visible ChatGPT placeholder over an unrelated editor', () => {
    document.body.innerHTML = '<div contenteditable="true" aria-label="notes"></div><div contenteditable="plaintext-only" data-placeholder="询问 ChatGPT"></div>'
    expect(findComposer(document)?.getAttribute('data-placeholder')).toBe('询问 ChatGPT')
  })

  it('recognises the generation stop control separately from voice', () => {
    document.body.innerHTML = '<button data-testid="stop-button" aria-label="停止生成"></button><button data-testid="voice-mode-button" aria-label="开始语音聊天"></button>'
    expect(findStopButton(document)).toBeTruthy()
    expect(findVoiceButton(document)).toBeTruthy()
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

  it('starts ChatGPT voice without injecting or ending the page microphone session', async () => {
    const executeJavaScript = vi.fn(async () => ({ ok: true, message: 'voice started' }))
    const automation = new ChatGPTAutomation({ executeJavaScript } as never)

    await expect(automation.waitForReplyAndStartVoice()).resolves.toMatchObject({ ok: true })
    expect(executeJavaScript).toHaveBeenCalledOnce()
    const [script] = (executeJavaScript.mock.calls as unknown as Array<[string]>)[0]!
    expect(script).toContain('voice.click()')
    expect(script).not.toContain('endVoiceSelector')
  })
})
