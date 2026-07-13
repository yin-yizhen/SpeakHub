// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fillComposer, findComposer, findEndVoiceButton, findSendButton, findStopButton, findVoiceButton } from './chatgpt-automation'

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
    document.body.innerHTML = '<div contenteditable="true" aria-label="notes"></div><div contenteditable="plaintext-only" data-placeholder="问问 ChatGPT"></div>'
    expect(findComposer(document)?.getAttribute('data-placeholder')).toBe('问问 ChatGPT')
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
})
