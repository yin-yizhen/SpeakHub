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
  it('uses the supplied Chinese prompt verbatim and appends an optional review focus', () => {
    const profile = parsePracticeProfile({ topic: '自定义情景', level: 'B1', correctionStrength: 'normal', source: 'api-direct', mode: 'text', prompt: '请扮演咖啡店店员，用英语与我逐轮对话。', focus: '重点练习过去时。' })
    expect(buildPracticePrompt(profile)).toBe('请扮演咖啡店店员，用英语与我逐轮对话。\n\n本次重点：\n重点练习过去时。')
  })
})
