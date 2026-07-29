import { describe, expect, it } from 'vitest'
import { isPracticeTransitionBusy, templateSelectionForDraft } from './app-state'
describe('renderer practice state', () => {
  it('keeps start and end transitions busy', () => {
    expect(isPracticeTransitionBusy('starting')).toBe(true); expect(isPracticeTransitionBusy('ending')).toBe(true); expect(isPracticeTransitionBusy('active')).toBe(false)
  })

  it('maps an archived practice draft back to the current template ids', () => {
    const templates = {
      systemPrompt: 'system',
      scenario: [{ id: 'daily-chat', name: '日常聊天', prompt: '' }, { id: 'travel', name: '旅行英语', prompt: '' }],
      difficulty: [{ id: 'a1', name: 'A1', prompt: '' }, { id: 'b1', name: 'B1', prompt: '' }],
      correction: [{ id: 'normal', name: '普通', prompt: '' }, { id: 'strict', name: '严格', prompt: '' }]
    }

    expect(templateSelectionForDraft({
      derivedFromSessionId: 'session-1',
      topic: '旅行英语',
      level: 'B1',
      source: 'api-direct',
      mode: 'voice',
      correctionStrength: 'strict'
    }, templates)).toEqual({ scenario: 'travel', difficulty: 'b1', correction: 'strict' })
  })
})
