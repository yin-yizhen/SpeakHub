// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatGPTAutomation, fillComposer, findComposer, findConversationMenuButton, findConversationRow, findDeleteConfirmationButton, findDeleteMenuItem, findEndVoiceButton, findSendButton, findStopButton, findVoiceButton } from './chatgpt-automation'

describe('ChatGPT page automation selectors', () => {
  it('opens the ordinary new-chat page directly rather than clicking a project new-chat control', async () => {
    const loadURL = vi.fn(async () => undefined)
    const executeJavaScript = vi.fn()
    const automation = new ChatGPTAutomation({ loadURL, executeJavaScript } as never)
    await expect(automation.startNewChat()).resolves.toMatchObject({ ok: true })
    expect(loadURL).toHaveBeenCalledWith('https://chatgpt.com/')
    expect(executeJavaScript).not.toHaveBeenCalled()
  })
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
    expect(scripts[1]).toContain('setTimeout(attempt, 120)')
  })

  it('waits for an identified send button and prefers the composer form', async () => {
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ focused: true, diagnostics: [{ id: 'prompt-textarea' }] })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
    const automation = new ChatGPTAutomation({ executeJavaScript, insertText: vi.fn() } as never)

    await expect(automation.fillAndSendPrompt('Travel practice')).resolves.toMatchObject({ ok: true })
    const scripts = (executeJavaScript.mock.calls as unknown as Array<[string]>).map(([script]) => script)
    const sendScript = scripts[1]
    expect(sendScript).toContain("composer?.closest('form')")
    expect(sendScript).toContain('candidates.length === 1')
    expect(sendScript).not.toContain('composerRect')
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
    const automation = new ChatGPTAutomation({ executeJavaScript, loadURL: vi.fn() } as never)

    await expect(automation.captureConversationTitle('https://chatgpt.com/c/target')).resolves.toBe('英语口语练习')
    await expect(automation.deleteConversationByTitle('英语口语练习')).resolves.toMatchObject({ ok: true })

    expect(executeJavaScript.mock.calls[0]?.[0]).toContain('conversationTitle')
    expect(executeJavaScript.mock.calls[1]?.[0]).toContain('title:英语口语练习')
  })

  it('waits for the formal conversation URL after ChatGPT assigns a local optimistic ID', async () => {
    vi.useFakeTimers()
    try {
      const getURL = vi.fn().mockReturnValueOnce('https://chatgpt.com/c/local-chatgpt%3Atemporary').mockReturnValue('https://chatgpt.com/c/server-id')
      const automation = new ChatGPTAutomation({ getURL } as never)
      const capturing = automation.captureConversationUrl()
      await vi.advanceTimersByTimeAsync(250)
      await expect(capturing).resolves.toMatchObject({ conversationUrl: 'https://chatgpt.com/c/server-id' })
      expect(getURL).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('never navigates to or deletes an unidentifiable temporary conversation', async () => {
    const loadURL = vi.fn()
    const automation = new ChatGPTAutomation({ loadURL } as never)
    await expect(automation.deleteConversation('https://chatgpt.com/c/local-chatgpt%3Atemporary')).resolves.toMatchObject({ ok: false })
    expect(loadURL).not.toHaveBeenCalled()
  })

  it('finds the current row chat-options button and refuses a neighboring row menu', () => {
    document.body.innerHTML = '<div role="group"><a href="/c/target">Same title</a><button aria-label="聊天操作"></button></div><div role="group"><a href="/c/other">Same title</a><button aria-label="聊天操作"></button></div>'
    const row = findConversationRow(document, 'https://chatgpt.com/c/target')!
    expect(findConversationMenuButton(row)?.getAttribute('aria-label')).toBe('聊天操作')
    document.body.innerHTML = '<nav><div><a href="/c/target">Target</a></div><div><a href="/c/other">Other</a><button aria-label="聊天操作"></button></div></nav>'
    expect(findConversationRow(document, 'https://chatgpt.com/c/target')).toBeUndefined()
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
    expect(scripts.some((script) => script.includes('readMessages(document)'))).toBe(true)
  })
})

describe('ChatGPT voice startup page execution', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 120, bottom: 40, width: 120, height: 40, toJSON: () => ({})
    })
    document.body.innerHTML = `
      <div data-message-author-role="user">Practice English</div>
      <div data-message-author-role="assistant">Hello</div>
      <button aria-label="开始语音"></button>`
  })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '' })

  function run(): Promise<{ ok: boolean; message: string }> {
    return new ChatGPTAutomation({ executeJavaScript: (script: string) => window.eval(script) } as never).waitForReplyAndStartVoice()
  }

  function addEnd(): void {
    const end = document.createElement('button')
    end.setAttribute('aria-label', '结束语音')
    document.body.append(end)
  }

  it('deletes the exact current sidebar row through its pointer-driven menu and Delete chat confirmation', async () => {
    document.body.innerHTML = '<div id="target"><a href="/c/target">Same title</a><button aria-label="聊天操作"></button></div><div id="other"><a href="/c/other">Same title</a><button aria-label="聊天操作"></button></div>'
    const row = document.querySelector<HTMLElement>('#target')!
    row.scrollIntoView = vi.fn()
    const otherClick = vi.fn()
    document.querySelector('#other button')!.addEventListener('pointerdown', otherClick)
    document.querySelector('#target button')!.addEventListener('pointerdown', () => {
      document.body.insertAdjacentHTML('beforeend', '<div role="menu"><button role="menuitem">删除</button></div>')
      document.querySelector('[role="menuitem"]')!.addEventListener('click', () => {
        document.querySelector('[role="menu"]')!.remove()
        document.body.insertAdjacentHTML('beforeend', '<div role="dialog">删除聊天？Same title<button>取消</button><button id="confirm-delete">删除聊天</button></div>')
        document.querySelector('#confirm-delete')!.addEventListener('click', () => {
          row.remove()
          document.querySelector('[role="dialog"]')!.remove()
        })
      })
    })
    const automation = new ChatGPTAutomation({ loadURL: vi.fn(), executeJavaScript: (script: string) => window.eval(script) } as never)
    const deleting = automation.deleteConversation('https://chatgpt.com/c/target')
    await vi.advanceTimersByTimeAsync(500)
    await expect(deleting).resolves.toMatchObject({ ok: true })
    expect(document.querySelector('a[href="/c/target"]')).toBeNull()
    expect(document.querySelector('a[href="/c/other"]')).not.toBeNull()
    expect(otherClick).not.toHaveBeenCalled()
  })

  it('does not fall back to a neighboring row menu when the target has none', async () => {
    document.body.innerHTML = '<nav><div><a href="/c/target">Target</a></div><div><a href="/c/other">Other</a><button aria-label="聊天操作"></button></div></nav>'
    const wrongClick = vi.fn()
    document.querySelector('button')!.addEventListener('click', wrongClick)
    document.querySelector('button')!.addEventListener('pointerdown', wrongClick)
    const automation = new ChatGPTAutomation({ loadURL: vi.fn(), executeJavaScript: (script: string) => window.eval(script) } as never)
    const deleting = automation.deleteConversation('https://chatgpt.com/c/target')
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(deleting).resolves.toMatchObject({ ok: false })
    expect(wrongClick).not.toHaveBeenCalled()
    expect(document.querySelectorAll('a[href*="/c/"]')).toHaveLength(2)
  })

  it('confirms an actually sent prompt and starts voice using current message units', async () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true" tabindex="0"></div><button aria-label="发送消息"></button><button aria-label="开始语音"></button>'
    const prompt = 'Practice English with me.'
    const composer = document.querySelector('#prompt-textarea')!
    document.querySelector('[aria-label="发送消息"]')!.addEventListener('click', () => {
      composer.textContent = ''
      document.body.insertAdjacentHTML('afterbegin', `<div data-content-search-unit-key="fallback-turn-0:0:user"><div data-user-message-bubble="true">${prompt}<button>显示更多</button></div></div><div data-content-search-unit-key="fallback-turn-0:2:assistant"><div data-markdown-text-style="assistant-message">Hello.</div></div>`)
    })
    const voiceClick = vi.fn(addEnd)
    document.querySelector('[aria-label="开始语音"]')!.addEventListener('click', voiceClick)
    const keys = vi.fn()
    const automation = new ChatGPTAutomation({
      executeJavaScript: (script: string) => window.eval(script),
      insertText: (text: string) => { composer.textContent = text }, sendInputEvent: keys
    } as never)
    const sent = automation.fillAndSendPrompt(prompt)
    await vi.advanceTimersByTimeAsync(250)
    await expect(sent).resolves.toMatchObject({ ok: true })
    expect(keys).not.toHaveBeenCalled()
    const started = automation.waitForReplyAndStartVoice()
    await vi.advanceTimersByTimeAsync(1_250)
    await expect(started).resolves.toMatchObject({ ok: true })
    expect(voiceClick).toHaveBeenCalledOnce()
  })

  it('selects the retained draft before native insertion so retry sends exactly one prompt', async () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true" tabindex="0">Old retained prompt</div><button aria-label="发送消息"></button>'
    const composer = document.querySelector('#prompt-textarea')!
    const prompt = 'New practice prompt'
    const selected = vi.fn()
    document.querySelector('button')!.addEventListener('click', () => {
      const text = composer.textContent
      composer.textContent = ''
      document.body.insertAdjacentHTML('afterbegin', `<div data-content-search-unit-key="t:0:user"><div data-user-message-bubble="true">${text}</div></div>`)
    })
    const insertText = vi.fn((text: string) => {
      selected(window.getSelection()?.toString())
      const selection = window.getSelection()!
      const range = selection.getRangeAt(0)
      range.deleteContents(); range.insertNode(document.createTextNode(text)); selection.removeAllRanges()
    })
    const automation = new ChatGPTAutomation({ executeJavaScript: (script: string) => window.eval(script), insertText, focus: vi.fn(), sendInputEvent: vi.fn() } as never)
    const sending = automation.fillAndSendPrompt(prompt)
    await vi.advanceTimersByTimeAsync(250)
    await expect(sending).resolves.toMatchObject({ ok: true })
    expect(selected).toHaveBeenCalledWith('Old retained prompt')
    expect(insertText).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-user-message-bubble]')!.textContent).toBe(prompt)
  })

  it('waits for a delayed send control inside the composer form and never clicks model or sidebar controls', async () => {
    document.body.innerHTML = '<button aria-label="发送消息">Unrelated send</button><button aria-label="选择 ChatGPT 模型">Model</button><form><div role="textbox" aria-label="询问 ChatGPT" contenteditable="true" tabindex="0"></div><button type="button" aria-label="开始语音"></button></form>'
    const composer = document.querySelector<HTMLElement>('[role="textbox"]')!
    const wrong = vi.fn()
    document.querySelectorAll('button').forEach(button => button.addEventListener('click', wrong))
    const send = vi.fn()
    const automation = new ChatGPTAutomation({
      executeJavaScript: (script: string) => window.eval(script),
      insertText: (text: string) => {
        composer.textContent = text
        composer.removeAttribute('aria-label')
        setTimeout(() => {
          const button = document.createElement('button'); button.type = 'submit'; button.setAttribute('aria-label', '发送')
          composer.closest('form')!.append(button)
          button.addEventListener('click', event => {
            event.preventDefault(); send(); composer.textContent = ''
            document.body.insertAdjacentHTML('afterbegin', `<div data-content-search-unit-key="t:0:user"><div data-user-message-bubble="true">${text}</div></div>`)
          })
        }, 800)
      }, sendInputEvent: vi.fn(), focus: vi.fn()
    } as never)
    const sending = automation.fillAndSendPrompt('Practice after loading')
    await vi.advanceTimersByTimeAsync(1_250)
    await expect(sending).resolves.toMatchObject({ ok: true })
    expect(send).toHaveBeenCalledOnce()
    expect(wrong).not.toHaveBeenCalled()
  })

  it('refocuses the composer before Enter fallback after a click moved focus', async () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true" tabindex="0"></div><button aria-label="发送消息"></button>'
    const composer = document.querySelector<HTMLElement>('#prompt-textarea')!
    const button = document.querySelector('button')!
    button.addEventListener('click', () => button.focus())
    const keyEvents = vi.fn((event: { type: string }) => {
      expect(document.activeElement).toBe(composer)
      if (event.type !== 'keyDown') return
      const text = composer.textContent
      composer.textContent = ''
      document.body.insertAdjacentHTML('afterbegin', `<div data-content-search-unit-key="t:0:user"><div data-user-message-bubble="true">${text}</div></div>`)
    })
    const automation = new ChatGPTAutomation({ executeJavaScript: (script: string) => window.eval(script), insertText: (text: string) => { composer.textContent = text }, sendInputEvent: keyEvents, focus: vi.fn() } as never)
    const sending = automation.fillAndSendPrompt('Practice again')
    await vi.advanceTimersByTimeAsync(6_000)
    await expect(sending).resolves.toMatchObject({ ok: true })
    expect(keyEvents).toHaveBeenCalledTimes(2)
  })

  it('does not confirm an older prompt with the same prefix or a draft still in the composer', async () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true" tabindex="0"></div><button aria-label="发送消息"></button><div data-content-search-unit-key="t:0:user"><div data-user-message-bubble="true">Practice English with me. Old topic.</div></div>'
    const automation = new ChatGPTAutomation({
      executeJavaScript: (script: string) => window.eval(script),
      insertText: (text: string) => { document.querySelector('#prompt-textarea')!.textContent = text },
      sendInputEvent: vi.fn()
    } as never)
    const sent = automation.fillAndSendPrompt('Practice English with me. New topic.')
    await vi.advanceTimersByTimeAsync(45_000)
    await expect(sent).resolves.toMatchObject({ ok: false })
  })

  it('recovers within one startup when the first send and Enter are ignored, without reinserting the prompt', async () => {
    document.body.innerHTML = '<form><div id="prompt-textarea" role="textbox" contenteditable="true" tabindex="0"></div><button type="button" aria-label="发送"></button></form>'
    const composer = document.querySelector('#prompt-textarea')!
    let clicks = 0
    document.querySelector('button')!.addEventListener('click', () => {
      clicks += 1
      if (clicks === 1) return
      const text = composer.textContent
      composer.textContent = ''
      document.body.insertAdjacentHTML('afterbegin', `<div data-content-search-unit-key="t:0:user"><div data-user-message-bubble="true">${text}</div></div>`)
    })
    const insertText = vi.fn((text: string) => { composer.textContent = text })
    const automation = new ChatGPTAutomation({ executeJavaScript: (script: string) => window.eval(script), insertText, sendInputEvent: vi.fn(), focus: vi.fn() } as never)
    const sending = automation.fillAndSendPrompt('Only send this once')
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(sending).resolves.toMatchObject({ ok: true })
    expect(clicks).toBe(2)
    expect(insertText).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('[data-user-message-bubble]')).toHaveLength(1)
  })

  it('waits without retrying when the page acknowledges the prompt but clears the composer late', async () => {
    document.body.innerHTML = '<form><div id="prompt-textarea" role="textbox" contenteditable="true" tabindex="0"></div><button type="button" aria-label="发送"></button></form>'
    const composer = document.querySelector('#prompt-textarea')!
    const click = vi.fn(() => {
      document.body.insertAdjacentHTML('afterbegin', `<div data-content-search-unit-key="t:0:user"><div data-user-message-bubble="true">${composer.textContent}</div></div>`)
      setTimeout(() => { composer.textContent = '' }, 12_000)
    })
    document.querySelector('button')!.addEventListener('click', click)
    const keys = vi.fn()
    const automation = new ChatGPTAutomation({ executeJavaScript: (script: string) => window.eval(script), insertText: (text: string) => { composer.textContent = text }, sendInputEvent: keys, focus: vi.fn() } as never)
    const sending = automation.fillAndSendPrompt('Already acknowledged')
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(sending).resolves.toMatchObject({ ok: true })
    expect(click).toHaveBeenCalledOnce()
    expect(keys).not.toHaveBeenCalled()
  })

  it('selects the observed start button and ignores dictation, settings, read-aloud and hidden stop controls', async () => {
    document.body.insertAdjacentHTML('afterbegin', `
      <button aria-label="语音设置"></button><button aria-label="语音输入"></button>
      <button aria-label="听写"></button><button aria-label="Read aloud voice"></button>
      <button data-testid="stop-button" style="display:none"></button><p>Thinking is a useful word.</p>`)
    const wrong = vi.fn()
    document.querySelectorAll('button:not([aria-label="开始语音"])').forEach(button => button.addEventListener('click', wrong))
    const click = vi.fn(addEnd)
    document.querySelector('[aria-label="开始语音"]')!.addEventListener('click', click)
    const result = run()
    await vi.advanceTimersByTimeAsync(1_250)
    await expect(result).resolves.toMatchObject({ ok: true })
    expect(click).toHaveBeenCalledOnce()
    expect(wrong).not.toHaveBeenCalled()
  })

  it('waits for the latest reply text to stabilize and for visible generation to finish', async () => {
    const click = vi.fn(addEnd)
    document.querySelector('button')!.addEventListener('click', click)
    const result = run()
    for (let index = 0; index < 5; index += 1) {
      await vi.advanceTimersByTimeAsync(500)
      document.querySelector('[data-message-author-role="assistant"]')!.textContent += ' more'
    }
    document.body.insertAdjacentHTML('beforeend', '<button aria-label="停止"></button>')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(click).not.toHaveBeenCalled()
    document.querySelector('[aria-label="停止"]')!.remove()
    await vi.advanceTimersByTimeAsync(1_250)
    await expect(result).resolves.toMatchObject({ ok: true })
    expect(click).toHaveBeenCalledOnce()
  })

  it('does not use an older assistant reply before the latest prompt', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div data-message-author-role="user">New prompt</div>')
    const click = vi.fn()
    document.querySelector('button')!.addEventListener('click', click)
    const result = run()
    await vi.advanceTimersByTimeAsync(45_000)
    await expect(result).resolves.toMatchObject({ ok: false })
    expect(click).not.toHaveBeenCalled()
  })

  it('does not report success when React removes the clicked button or an end control is hidden', async () => {
    const button = document.querySelector('button')!
    button.addEventListener('click', () => {
      button.remove()
      document.body.insertAdjacentHTML('beforeend', '<button aria-label="结束语音" style="display:none"></button>')
    })
    const result = run()
    await vi.advanceTimersByTimeAsync(14_000)
    await expect(result).resolves.toMatchObject({ ok: false, message: expect.stringContaining('未检测到') })
  })

  it('clicks once and waits for a delayed visible end control', async () => {
    const click = vi.fn(() => setTimeout(addEnd, 4_000))
    document.querySelector('button')!.addEventListener('click', click)
    const result = run()
    let settled = false
    void result.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(3_000)
    await expect(result).resolves.toMatchObject({ ok: true })
    expect(click).toHaveBeenCalledOnce()
  })

  it('does not guess between ambiguous visible start controls', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button aria-label="Start voice"></button>')
    const click = vi.fn()
    document.querySelectorAll('button').forEach(button => button.addEventListener('click', click))
    const result = run()
    await vi.advanceTimersByTimeAsync(45_000)
    await expect(result).resolves.toMatchObject({ ok: false })
    expect(click).not.toHaveBeenCalled()
  })
})
