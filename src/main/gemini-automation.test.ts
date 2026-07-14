// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { findGeminiEndVoiceButton, findGeminiVoiceButton } from './gemini-automation'

describe('Gemini voice selectors', () => {
  it('recognizes Gemini-specific voice start and end controls', () => {
    document.body.innerHTML = '<button aria-label="Start voice conversation"></button><button aria-label="End voice conversation"></button>'
    expect(findGeminiVoiceButton(document)?.getAttribute('aria-label')).toBe('Start voice conversation')
    expect(findGeminiEndVoiceButton(document)?.getAttribute('aria-label')).toBe('End voice conversation')
  })
})
