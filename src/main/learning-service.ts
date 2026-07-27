import { z } from 'zod'
import type { DictionaryResult, ReviewResult, TranscriptEvent } from '../shared/types'
import { LocalDictionary } from './local-dictionary'
import { SecureSettings } from './secure-settings'

const reviewSchema = z.object({
  topic: z.string(), summary: z.string(),
  issues: z.array(z.object({ original: z.string(), improved: z.string(), reason: z.string() })).min(0).max(8),
  vocabulary: z.array(z.object({ term: z.string(), meaning: z.string(), example: z.string().optional() })).max(12),
  nextPractice: z.string(),
  assessment: z.object({
    estimatedCefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1']),
    scores: z.object({ accuracy: z.number().min(0).max(100), vocabulary: z.number().min(0).max(100), fluency: z.number().min(0).max(100), interaction: z.number().min(0).max(100) }),
    errorCategories: z.array(z.object({ category: z.enum(['grammar', 'word-choice', 'tense', 'articles', 'prepositions', 'fluency', 'coherence', 'interaction', 'other']), count: z.number().int().min(1).max(100) })).max(9),
    weakPoints: z.array(z.string()).max(6)
  }).optional()
})

type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export class LearningService {
  private readonly localDictionary?: LocalDictionary

  constructor(private readonly settings: SecureSettings, dictionaryDir?: string) {
    this.localDictionary = dictionaryDir ? new LocalDictionary(dictionaryDir) : undefined
  }

  async lookup(query: string, sentence?: string): Promise<DictionaryResult> {
    const config = this.settings.get()
    const base: DictionaryResult = this.localDictionary?.lookup(query) ?? { query, definitions: [] }
    if (base.definitions.length) return base
    if (config.hasLlmKey) {
      const llm = await this.askLlm(`Explain the English selection for a Chinese learner. Return JSON only: {"contextualMeaning":"...","naturalAlternative":"..."}. Selection: ${query}. Context: ${sentence ?? ''}`)
      const contextual = z.object({ contextualMeaning: z.string().optional(), naturalAlternative: z.string().optional() }).parse(llm)
      return { ...base, ...contextual }
    }
    throw new Error('The built-in dictionary did not find this word. Configure an OpenAI-compatible LLM for fallback lookup.')
  }

  async review(archiveMarkdown: string, strength: string, favorites: string[] = []): Promise<ReviewResult> {
    const savedVocabulary = favorites.length ? favorites.map((word) => `- ${word}`).join('\n') : '(none)'
    const result = await this.askLlm(`You are a concise English speaking coach. Analyze this complete practice archive at correction level ${strength}. Return JSON only with this exact shape: {"topic":"string","summary":"string","issues":[{"original":"string","improved":"string","reason":"string"}],"vocabulary":[{"term":"string","meaning":"string","example":"string"}],"nextPractice":"string","assessment":{"estimatedCefr":"A1|A2|B1|B2|C1","scores":{"accuracy":0,"vocabulary":0,"fluency":0,"interaction":0},"errorCategories":[{"category":"grammar|word-choice|tense|articles|prepositions|fluency|coherence|interaction|other","count":1}],"weakPoints":["string"]}}. Scores are integer-like values from 0 to 100 based only on language visible in the transcript; do not claim acoustic pronunciation analysis. Use Chinese for explanations. The vocabulary array must contain explanations only for the saved vocabulary below. Give each saved word a short English example sentence. Do not add other vocabulary; when none is saved, return an empty vocabulary array. Saved vocabulary:\n${savedVocabulary}\nPractice archive Markdown:\n${archiveMarkdown}`)
    const review = reviewSchema.parse(result)
    const saved = new Set(favorites.map((word) => word.toLocaleLowerCase()))
    return { ...review, vocabulary: review.vocabulary.filter((item) => saved.has(item.term.toLocaleLowerCase())) }
  }

  async chat(events: TranscriptEvent[], topic: string, level: string): Promise<string> {
    const messages: LlmMessage[] = [
      { role: 'system', content: `You are a warm English speaking partner. The learner selected ${topic} at CEFR ${level}. Reply in English, keep each turn concise, ask at most one question, and gently adapt to the learner's level.` },
      ...events.map((event) => ({ role: event.speaker === 'assistant' ? 'assistant' as const : 'user' as const, content: event.text }))
    ]
    return this.requestLlm(messages)
  }

  private async askLlm(prompt: string): Promise<unknown> {
    const content = await this.requestLlm([{ role: 'user', content: prompt }], true)
    try { return JSON.parse(content) } catch { throw new Error('LLM returned invalid JSON.') }
  }

  private async requestLlm(messages: LlmMessage[], json = false): Promise<string> {
    const config = this.settings.get(); const secrets = this.settings.getSecrets()
    if (!config.llmBaseUrl || !config.llmModel || !secrets.llmApiKey) throw new Error('Please configure an OpenAI-compatible Base URL, model, and API key first.')
    const url = new URL('chat/completions', config.llmBaseUrl.endsWith('/') ? config.llmBaseUrl : `${config.llmBaseUrl}/`)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('The LLM Base URL must use HTTP or HTTPS.')
    const body = { model: config.llmModel, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) }
    let response: Response
    try { response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secrets.llmApiKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) }) }
    catch (error) { if (error instanceof Error && error.name === 'TimeoutError') throw new Error('LLM request timed out after 30 seconds.'); throw error }
    if (!response.ok) throw new Error(`LLM request failed (${response.status})`)
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('LLM returned no message content.')
    return content
  }
}
