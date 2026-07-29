import { describe, expect, it } from 'vitest'
import { buildDirectChatSystemPrompt } from './direct-chat-prompt'

describe('buildDirectChatSystemPrompt', () => {
  it('requires speech-friendly plain text without Markdown decoration', () => {
    const prompt = buildDirectChatSystemPrompt('日常聊天', 'A1', '围绕生活自然聊天。')

    expect(prompt).toContain('朗读输出要求')
    expect(prompt).toContain('不要使用 Markdown、列表、星号')
    expect(prompt).toContain('不要用符号包围单词来强调')
    expect(prompt).toContain('避免连续或装饰性标点')
    expect(prompt).toContain('1 到 2 个简短句子')
    expect(prompt).toContain('英文不超过约 20 个单词')
    expect(prompt).toContain('不要连续教学、长篇解释')
  })
})
