import { describe, expect, it } from 'vitest'
import { buildChatGptWebPrompt, buildDirectChatSystemPrompt } from './direct-chat-prompt'

describe('buildDirectChatSystemPrompt', () => {
  it('requires speech-friendly plain text without Markdown decoration', () => {
    const prompt = buildDirectChatSystemPrompt('日常聊天', 'A1', '围绕生活自然聊天。')

    expect(prompt).toContain('朗读输出要求')
    expect(prompt).toContain('不要使用 Markdown、列表、星号')
    expect(prompt).toContain('不要用符号包围单词来强调')
    expect(prompt).toContain('避免连续或装饰性标点')
    expect(prompt).toContain('3 到 5 个句子')
    expect(prompt).toContain('英文约 40 到 80 个单词')
    expect(prompt).toContain('雅思 Part 2 cue card')
    expect(prompt).toContain('为学习者留出充分开口时间')
  })

  it('uses the saved system prompt for a ChatGPT web prompt too', () => {
    const prompt = buildChatGptWebPrompt('旅行英语', 'A2', '围绕机场办理值机进行对话。', '这是共享的系统提示词。')

    expect(prompt).toContain('这是共享的系统提示词。')
    expect(prompt).toContain('围绕机场办理值机进行对话。')
  })
})
