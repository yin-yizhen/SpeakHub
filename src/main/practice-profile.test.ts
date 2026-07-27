import { describe, expect, it } from 'vitest'
import { buildPracticePrompt, parsePracticeProfile } from './practice-profile'

describe('PracticeProfile', () => {
  it('keeps source, CEFR, topic and correction strength in one validated profile', () => {
    const profile = parsePracticeProfile({ topic: '旅行英语', level: 'B1', correctionStrength: 'strict', source: 'api-direct', mode: 'voice', focus: 'Use the past tense accurately.' })
    expect(buildPracticePrompt(profile)).toContain('CEFR level is B1')
    expect(buildPracticePrompt(profile)).toContain('Notice grammar')
    expect(buildPracticePrompt(profile)).toContain('Use the past tense accurately.')
  })
  it('rejects unsupported IPC values', () => {
    expect(() => parsePracticeProfile({ topic: 'unknown', level: 'B9', correctionStrength: 'normal', source: 'api-direct', mode: 'text' })).toThrow()
  })
})
