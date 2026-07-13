// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseGeminiPage } from './gemini-adapter'

describe('Gemini DOM fixture', () => {
  it('uses Gemini-specific selectors for user and model text', () => {
    document.body.innerHTML = '<div data-test-id="user-query" data-message-id="u1">I want to practice travel English.</div><div data-test-id="model-response" data-message-id="a1">Great. Where would you like to go?</div><div>page chrome</div>'
    expect(parseGeminiPage(document)).toEqual([
      { sourceMessageId: 'u1', speaker: 'user', text: 'I want to practice travel English.', status: 'complete' },
      { sourceMessageId: 'a1', speaker: 'assistant', text: 'Great. Where would you like to go?', status: 'complete' }
    ])
  })
})
