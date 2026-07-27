import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { defaultMicrophoneShortcut } from './microphone-shortcut'
import type { ConnectionState, PracticePreferences, PromptTemplates, SubtitlePreferences, WebPracticeSource } from '../shared/types'

const boundsSchema = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(320).max(10000), height: z.number().int().min(100).max(10000) })
const subtitleSchema = z.object({
  mode: z.enum(['assistant', 'user', 'both']), layout: z.enum(['same-side', 'split']), background: z.enum(['transparent', 'glass', 'solid']),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i), backgroundOpacity: z.number().min(0.1).max(1), assistantColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  userColor: z.string().regex(/^#[0-9a-f]{6}$/i), fontSize: z.number().int().min(18).max(38), opacity: z.number().min(0.55).max(1), locked: z.boolean(),
  visible: z.boolean(), maxLines: z.number().int().min(2).max(6), bounds: boundsSchema.optional()
})
const promptTemplateSchema = z.object({ id: z.string().min(1).max(80), name: z.string().trim().min(1).max(80), prompt: z.string().trim().min(1).max(8_000) })
const promptTemplatesSchema = z.object({ scenario: z.array(promptTemplateSchema).min(1).max(30), difficulty: z.array(promptTemplateSchema).min(1).max(30), correction: z.array(promptTemplateSchema).min(1).max(30) })
const practicePreferencesSchema = z.object({
  source: z.enum(['chatgpt-web', 'api-direct']), mode: z.enum(['text', 'voice']),
  scenarioTemplateId: z.string().min(1).max(80), difficultyTemplateId: z.string().min(1).max(80), correctionTemplateId: z.string().min(1).max(80),
  focus: z.string().max(2_000), focusEnabled: z.boolean()
})
const storedSchema = z.object({ providers: z.object({ 'chatgpt-web': z.boolean() }), subtitle: subtitleSchema.optional(), archiveDirectory: z.string().min(1).optional(), microphoneShortcut: z.string().min(1).max(80).optional(), promptTemplates: promptTemplatesSchema.optional(), practicePreferences: practicePreferencesSchema.optional() })

export const defaultPromptTemplates: PromptTemplates = {
  scenario: [
    { id: 'daily-chat', name: '日常聊天', prompt: '你是一位友好的英语口语伙伴。请与我进行自然的日常英语对话，每次只问一个问题，并根据我的回答继续。' },
    { id: 'travel', name: '旅行英语', prompt: '请扮演友好的旅行伙伴或当地工作人员，与我练习实用旅行英语；每次只推进一个交流回合。' },
    { id: 'interview', name: '面试英语', prompt: '请扮演英语面试官，提出真实的面试问题；等待我的回答后再继续。' },
    { id: 'meeting', name: '职场会议', prompt: '请扮演职场会议中的同事，使用真实的商务情景与我轮流进行英语交流。' },
    { id: 'ielts', name: '雅思口语', prompt: '请扮演雅思口语考官，按真实考试节奏逐题提问并等待我的回答。' },
    { id: 'free-chat', name: '自由闲聊', prompt: '请开始一段友好的英语自由对话，回复简短，给我充分开口练习的机会。' },
    { id: 'role-play', name: '情景角色扮演', prompt: '请先设定一个实用英语角色扮演情景，然后以角色身份开始对话。' }
  ],
  difficulty: ['A1', 'A2', 'B1', 'B2', 'C1'].map((name) => ({ id: name.toLowerCase(), name, prompt: `我的英语水平为 ${name}。请使用符合该水平的词汇、语法和句子长度，并清晰、简短地表达。` })),
  correction: [
    { id: 'light', name: '轻度', prompt: '仅在错误影响理解时纠正，并简短给出更自然的表达。' },
    { id: 'normal', name: '普通', prompt: '温和地纠正重要错误，但不要打断正常对话。' },
    { id: 'strict', name: '严格', prompt: '注意语法和用词错误，并简短示范更好的表达。' }
  ]
}

export const defaultSubtitlePreferences: SubtitlePreferences = { mode: 'assistant', layout: 'split', background: 'glass', backgroundColor: '#0e1713', backgroundOpacity: 0.86, assistantColor: '#f1f6f3', userColor: '#fff1c9', fontSize: 25, opacity: 0.94, locked: false, visible: false, maxLines: 4 }
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
  promptTemplates(): PromptTemplates { return this.read().promptTemplates ?? defaultPromptTemplates }
  setPromptTemplates(templates: PromptTemplates): PromptTemplates { const parsed = promptTemplatesSchema.parse(templates); this.write({ ...this.read(), promptTemplates: parsed }); return parsed }
  practicePreferences(): PracticePreferences { return this.read().practicePreferences ?? defaultPracticePreferences }
  setPracticePreferences(preferences: PracticePreferences): PracticePreferences { const parsed = practicePreferencesSchema.parse(preferences); this.write({ ...this.read(), practicePreferences: parsed }); return parsed }
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
