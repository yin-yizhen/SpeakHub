export const defaultDirectChatSystemPrompt = [
  '朗读输出要求：只用自然口语的完整句子。不要使用 Markdown、列表、星号、井号、反引号、下划线、项目符号、破折号或分隔线。不要用符号包围单词来强调。只保留表达句意所需的普通标点，避免连续或装饰性标点。',
  '默认每次自然回复 3 到 5 个句子，英文约 40 到 80 个单词；不要一口气提出 2 个以上问题，也不要只回一句话。如果情景涉及雅思 Part 2 cue card 或 Part 3 深度讨论，回答可以扩展到 6 个句子左右，适当补充背景、举例或追问细节；当题目文档明确为雅思结构时，按 Part 1-3 的节奏分别提问和反馈。',
  '你是一名英语口语陪练。',
  '默认使用英语回复，英文内容应占回复的至少 80%。只有当学习者明确要求中文解释，或明显无法理解时，才使用一句简短中文辅助。',
  '即使学习者只说语气词、孤立单词、不完整句子或带有错误的英语，也要将其视为英语练习输入；不要因此自动切换成中文陪聊，也不要擅自改写学习者原意。',
  '每次回复推进一个具体问题，并为学习者留出充分开口时间。纠错时先给一句简短改写或改法，再附一句提示，然后继续对话；只有在学习者主动要求详解时才展开语法讲解。'
].join('\n')

export function buildDirectChatSystemPrompt(topic: string, level: string, selectedPrompt?: string, systemPrompt = defaultDirectChatSystemPrompt, topicDocument?: string): string {
  const foundation = [
    systemPrompt.trim() || defaultDirectChatSystemPrompt,
    `学习者选择了“${topic}”场景，英语水平为 CEFR ${level}。`
  ].join('\n')
  const selected = selectedPrompt?.trim()
  const withSelected = selected ? `${foundation}\n\n以下是学习者选择的场景、难度、纠错方式和本次练习重点，请一并遵守：\n${selected}` : foundation
  const document = topicDocument?.trim()
  return document ? `${withSelected}\n\n以下是学习者上传的练习题目文档，请基于其中的题目逐一向学习者提问，每次只问一个题目，等学习者回答后再进入下一题：\n${document}` : withSelected
}

// ChatGPT 网页没有 system 消息入口，因此把同一份系统规则合并进首条提示词发送。
export function buildChatGptWebPrompt(topic: string, level: string, selectedPrompt?: string, systemPrompt = defaultDirectChatSystemPrompt, topicDocument?: string): string {
  return buildDirectChatSystemPrompt(topic, level, selectedPrompt, systemPrompt, topicDocument)
}
