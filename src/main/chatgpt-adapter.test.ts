// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseChatGPTPage } from './chatgpt-adapter'

describe('ChatGPT DOM fixture', () => {
  it('reads only attributable visible message text', () => {
    document.body.innerHTML = '<article data-testid="conversation-turn-1" data-message-author-role="assistant" data-message-id="a1">That makes sense.</article><article data-testid="conversation-turn-2" data-message-author-role="user" data-message-id="u1">I agree.</article><div>unattributed page chrome</div>'
    expect(parseChatGPTPage(document)).toEqual([
      { sourceMessageId: 'a1', speaker: 'assistant', text: 'That makes sense.', status: 'complete' },
      { sourceMessageId: 'u1', speaker: 'user', text: 'I agree.', status: 'complete' }
    ])
  })
})
