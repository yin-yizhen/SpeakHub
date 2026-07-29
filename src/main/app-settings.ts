import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { defaultMicrophoneShortcut } from './microphone-shortcut'
import type { ConnectionState, PracticePreferences, PromptTemplates, SubtitlePreferences, WebPracticeSource } from '../shared/types'
import { defaultDirectChatSystemPrompt } from '../shared/direct-chat-prompt'
import { defaultSubtitlePreferences } from '../shared/defaults'

export { defaultSubtitlePreferences } from '../shared/defaults'

const boundsSchema = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(320).max(10000), height: z.number().int().min(100).max(10000) })
const subtitleSchema = z.object({
  mode: z.enum(['assistant', 'user', 'both']), background: z.enum(['transparent', 'glass', 'solid']),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i), backgroundOpacity: z.number().min(0.1).max(1), assistantColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  userColor: z.string().regex(/^#[0-9a-f]{6}$/i), fontSize: z.number().int().min(18).max(38), opacity: z.number().min(0.55).max(1), locked: z.boolean(),
  visible: z.boolean(), maxLines: z.number().int().min(2).max(6), bounds: boundsSchema.optional()
})
const promptTemplateSchema = z.object({ id: z.string().min(1).max(80), name: z.string().trim().min(1).max(80), prompt: z.string().trim().min(1).max(8_000) })
const promptTemplatesSchema = z.object({ systemPrompt: z.string().trim().min(1).max(8_000).optional(), scenario: z.array(promptTemplateSchema).min(1).max(30), difficulty: z.array(promptTemplateSchema).min(1).max(30), correction: z.array(promptTemplateSchema).min(1).max(30) })
const practicePreferencesSchema = z.object({
  source: z.enum(['chatgpt-web', 'api-direct']), mode: z.enum(['text', 'voice']),
  scenarioTemplateId: z.string().min(1).max(80), difficultyTemplateId: z.string().min(1).max(80), correctionTemplateId: z.string().min(1).max(80),
  focus: z.string().max(2_000), focusEnabled: z.boolean()
})
const storedSchema = z.object({
  providers: z.object({ 'chatgpt-web': z.boolean() }),
  subtitle: subtitleSchema.optional(),
  archiveDirectory: z.string().min(1).optional(),
  microphoneShortcut: z.string().min(1).max(80).optional(),
  promptTemplates: promptTemplatesSchema.optional(),
  practicePreferences: practicePreferencesSchema.optional(),
  speechUsageSeconds: z.record(z.string(), z.number().int().nonnegative()).optional()
})

export const defaultPromptTemplates: PromptTemplates = {
  systemPrompt: defaultDirectChatSystemPrompt,
  scenario: [
    { id: 'daily-chat', name: '日常聊天', prompt: '围绕生活、兴趣和近况自然聊天；主动追问，保持轻松。' },
    { id: 'travel', name: '旅行英语', prompt: '扮演当地服务人员或旅伴，围绕出行、住宿、点餐、问路与突发情况交流。' },
    { id: 'interview', name: '面试英语', prompt: '扮演面试官，围绕经历、能力与岗位匹配度提问；根据我的回答追问。' },
    { id: 'meeting', name: '职场会议', prompt: '扮演同事或客户，围绕进度、方案、分工和异议展开讨论。' },
    { id: 'ielts', name: '雅思口语', prompt: '扮演雅思口语考官，按 Part 1–3 提问；适时追问，不代替我作答。' },
    { id: 'free-chat', name: '自由闲聊', prompt: '根据我的话题自然延展；不预设任务。' },
    { id: 'role-play', name: '情景角色扮演', prompt: '扮演我指定的角色，在我指定的目标与约束下完成对话。若我未指定，请先提供一个实用情景。' }
  ],
  difficulty: [
    { id: 'a1', name: 'A1', prompt: '使用高频词和短句；一次只问一个具体问题；必要时给选项或示例。' },
    { id: 'a2', name: 'A2', prompt: '使用常见日常表达和简单复句；可谈经历、计划和偏好；语速清晰。' },
    { id: 'b1', name: 'B1', prompt: '使用自然的常用表达；鼓励我连续说明、举例和表达理由。' },
    { id: 'b2', name: 'B2', prompt: '使用较自然的语速与多样表达；可讨论工作、观点、比较和协商。' },
    { id: 'c1', name: 'C1', prompt: '使用接近真实场景的自然表达；可讨论抽象或专业议题，关注语域、逻辑和细微差别。' }
  ],
  correction: [
    { id: 'light', name: '轻度', prompt: '以交流为先。仅在影响理解或错误重复时纠正；不打断。回复末尾给 1 个更自然的说法。不评价或纠正发音、语音、重音、语调。' },
    { id: 'normal', name: '普通', prompt: '每次最多处理 1 个最重要的语法、用词或表达问题。先用简短提示引导我自我修正；若我未修正，再给正确表达和一句简短原因。不评价或纠正发音、语音、重音、语调。' },
    { id: 'strict', name: '严格', prompt: '每轮最多指出 1 个最重要的语法、用词或表达问题。先要求我重说；未修正时按“原句 → 推荐说法 → 简短原因”反馈，并请我复述。不评价或纠正发音、语音、重音、语调。' }
  ]
}

export const defaultPracticePreferences: PracticePreferences = { source: 'chatgpt-web', mode: 'voice', scenarioTemplateId: 'daily-chat', difficultyTemplateId: 'a1', correctionTemplateId: 'normal', focus: '', focusEnabled: false }

export class AppSettingsStore {
  constructor(private readonly path: string) {}
  readSubtitle(): SubtitlePreferences { return this.read().subtitle ?? defaultSubtitlePreferences }
  saveSubtitle(value: SubtitlePreferences): void { this.write({ ...this.read(), subtitle: subtitleSchema.parse(value) }) }
  providerReady(source: WebPracticeSource): boolean { return this.read().providers[source] }
  setProviderReady(source: WebPracticeSource, ready: boolean): void { const value = this.read(); value.providers[source] = ready; this.write(value) }
  connection(source: WebPracticeSource, pageVisible: boolean): ConnectionState { const providers = this.read().providers; return { ready: providers[source], providers, activeProvider: source, pageVisible } }
  archiveDirectory(fallback: string): string { return this.read().archiveDirectory ?? fallback }
  setArchiveDirectory(directory: string): void { this.write({ ...this.read(), archiveDirectory: z.string().min(1).parse(directory) }) }
  microphoneShortcut(): string { return this.read().microphoneShortcut ?? defaultMicrophoneShortcut }
  setMicrophoneShortcut(shortcut: string): void { this.write({ ...this.read(), microphoneShortcut: z.string().min(1).max(80).parse(shortcut) }) }
  promptTemplates(): PromptTemplates { const saved = this.read().promptTemplates; return saved ? { ...defaultPromptTemplates, ...saved } : defaultPromptTemplates }
  setPromptTemplates(templates: PromptTemplates): PromptTemplates { const parsed = { ...defaultPromptTemplates, ...promptTemplatesSchema.parse(templates) }; this.write({ ...this.read(), promptTemplates: parsed }); return parsed }
  practicePreferences(): PracticePreferences { return this.read().practicePreferences ?? defaultPracticePreferences }
  setPracticePreferences(preferences: PracticePreferences): PracticePreferences { const parsed = practicePreferencesSchema.parse(preferences); this.write({ ...this.read(), practicePreferences: parsed }); return parsed }
  speechUsageSeconds(month: string): number { return this.read().speechUsageSeconds?.[month] ?? 0 }
  addSpeechUsageSeconds(month: string, seconds: number): number {
    const value = this.read()
    const usage = { ...value.speechUsageSeconds }
    usage[month] = (usage[month] ?? 0) + z.number().int().nonnegative().parse(seconds)
    this.write({ ...value, speechUsageSeconds: usage })
    return usage[month]
  }
  clear(): void { const archiveDirectory = this.read().archiveDirectory; this.write({ providers: { 'chatgpt-web': false }, subtitle: defaultSubtitlePreferences, archiveDirectory }) }

  private read(): z.infer<typeof storedSchema> {
    const fallback = { providers: { 'chatgpt-web': false } }
    if (!existsSync(this.path)) return fallback
    try { return storedSchema.parse(JSON.parse(readFileSync(this.path, 'utf8'))) }
    catch { return fallback }
  }
  private write(value: z.infer<typeof storedSchema>): void { const temporary = `${this.path}.tmp`; writeFileSync(temporary, JSON.stringify(value), 'utf8'); renameSync(temporary, this.path) }
}

export function parseSubtitleUpdate(current: SubtitlePreferences, input: unknown): SubtitlePreferences {
  return subtitleSchema.parse({ ...current, ...(typeof input === 'object' && input ? input : {}) })
}
