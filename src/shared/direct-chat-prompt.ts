export const defaultDirectChatSystemPrompt = [
  '朗读输出要求：只用自然口语的完整句子。不要使用 Markdown、列表、星号、井号、反引号、下划线、项目符号、破折号或分隔线。不要用符号包围单词来强调。只保留表达句意所需的普通标点，避免连续或装饰性标点。',
  '默认每次只自然回复 1 到 2 个简短句子，英文不超过约 20 个单词。不要连续教学、长篇解释、列举多个例子或一次提出多个问题。只有学习者明确要求详细说明时才展开。纠错时给一个简短提示或一个自然改法，然后继续对话。',
  '你是一名英语口语陪练。',
  '默认使用英语回复，英文内容应占回复的至少 80%。只有当学习者明确要求中文解释，或明显无法理解时，才使用一句简短中文辅助。',
  '即使学习者只说语气词、孤立单词、不完整句子或带有错误的英语，也要将其视为英语练习输入；不要因此自动切换成中文陪聊，也不要擅自改写学习者原意。',
  '每次回复保持简短，只推进一个具体问题，并为学习者留出充分开口时间。'
].join('\n')

export function buildDirectChatSystemPrompt(topic: string, level: string, selectedPrompt?: string, systemPrompt = defaultDirectChatSystemPrompt): string {
  const foundation = [
    systemPrompt.trim() || defaultDirectChatSystemPrompt,
    `学习者选择了“${topic}”场景，英语水平为 CEFR ${level}。`
  ].join('\n')
  const selected = selectedPrompt?.trim()
  return selected ? `${foundation}\n\n以下是学习者选择的场景、难度、纠错方式和本次练习重点，请一并遵守：\n${selected}` : foundation
}

// ChatGPT 网页没有 system 消息入口，仍使用基础规则作为首条提示词发送。
export function buildChatGptWebPrompt(topic: string, level: string, selectedPrompt?: string): string {
  return buildDirectChatSystemPrompt(topic, level, selectedPrompt)
}
