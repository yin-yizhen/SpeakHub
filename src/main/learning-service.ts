import { z } from 'zod'
import type { DictionaryResult, ReviewResult, SessionFavoriteSentence, SessionSentenceAnalysis, TranscriptEvent } from '../shared/types'
import { buildDirectChatSystemPrompt } from '../shared/direct-chat-prompt'
import { LocalDictionary } from './local-dictionary'
import { SecureSettings } from './secure-settings'

const reviewSchema = z.object({
  topic: z.string(), summary: z.string(),
  issues: z.array(z.object({ original: z.string(), improved: z.string(), reason: z.string() })),
  vocabulary: z.array(z.object({ term: z.string(), meaning: z.string(), example: z.string().optional() })).max(12),
  nextPractice: z.string(),
  assessment: z.object({
    estimatedCefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1']),
    scores: z.object({ accuracy: z.number().min(0).max(100), vocabulary: z.number().min(0).max(100), fluency: z.number().min(0).max(100), interaction: z.number().min(0).max(100) }),
    errorCategories: z.array(z.object({ category: z.enum(['grammar', 'word-choice', 'tense', 'articles', 'prepositions', 'fluency', 'coherence', 'interaction', 'other']), count: z.number().int().min(1).max(100) })).max(9),
    weakPoints: z.array(z.string()).max(6)
  }).optional()
})

const sentenceAnalysisSchema = z.object({
  translation: z.string().min(1).max(500),
  structure: z.string().min(1).max(300),
  reusablePattern: z.string().min(1).max(300),
  expressions: z.array(z.object({ phrase: z.string().min(1).max(100), meaning: z.string().min(1).max(200) })).max(4),
  breakdown: z.array(z.object({ part: z.string().min(1).max(200), explanation: z.string().min(1).max(300) })).max(5),
  examples: z.array(z.string().min(1).max(300)).max(3),
  tip: z.string().max(300).optional()
})

const reviewWithSentencesSchema = reviewSchema.extend({
  sentenceAnalyses: z.array(z.object({ sourceMessageId: z.string().min(1).max(2_000), analysis: sentenceAnalysisSchema })).max(100)
})

const reviewSynthesisSchema = reviewSchema.omit({ issues: true }).extend({
  sentenceAnalyses: reviewWithSentencesSchema.shape.sentenceAnalyses
})

type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string }

const DEFAULT_LLM_TIMEOUT_MS = 30_000
const REVIEW_LLM_TIMEOUT_MS = 300_000
const REVIEW_DIRECT_MAX_CHARACTERS = 8_000
const REVIEW_CHUNK_MAX_CHARACTERS = 6_000
const REVIEW_RETRY_MIN_CHARACTERS = 2_000

function timeoutError(timeoutMs: number): Error {
  return new Error(`大模型请求超过 ${Math.round(timeoutMs / 1000)} 秒仍未完成，请检查网络后稍后重试。`)
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || /aborted due to timeout|timed out/i.test(error.message))
}

const SUBTITLE_DELTA_TARGET_CHARACTERS = 18
const SUBTITLE_DELTA_MAX_CHARACTERS = 28
const SUBTITLE_DELTA_DELAY_MS = 24

function archiveForReview(archiveMarkdown: string): string {
  const withoutEmbeddedMetadata = archiveMarkdown.replace(/\n?<!-- speaksub-session:[A-Za-z0-9+/=]+ -->\n?/g, '\n')
  const withoutExistingReview = withoutEmbeddedMetadata.replace(/\n\n## Review\n\n[\s\S]*$/, '')
  if (!/^source:\s*chatgpt-web\s*$/m.test(withoutExistingReview)) return withoutExistingReview
  const transcriptStart = withoutExistingReview.indexOf('## Transcript')
  if (transcriptStart < 0) return withoutExistingReview
  const transcript = withoutExistingReview.slice(transcriptStart)
  const firstSetupTurn = /### Me at [^\n]+\n\n[\s\S]*?(?=\n\n### (?:AI|Me)(?: · 已打断)? at |\n\n## |$)/
  if (!firstSetupTurn.test(transcript)) return withoutExistingReview
  return `${withoutExistingReview.slice(0, transcriptStart)}${transcript.replace(firstSetupTurn, '_Initial practice setup prompt omitted from learner review._')}`
}

function splitAtNaturalBoundary(text: string, maxCharacters: number): string[] {
  const chunks: string[] = []
  let remaining = text.trim()
  while (remaining.length > maxCharacters) {
    const paragraphBoundary = remaining.lastIndexOf('\n\n', maxCharacters)
    const sentenceBoundary = Math.max(remaining.lastIndexOf('. ', maxCharacters), remaining.lastIndexOf('? ', maxCharacters), remaining.lastIndexOf('! ', maxCharacters))
    const wordBoundary = remaining.lastIndexOf(' ', maxCharacters)
    const preferredBoundary = Math.max(paragraphBoundary, sentenceBoundary >= 0 ? sentenceBoundary + 1 : -1, wordBoundary)
    const boundary = preferredBoundary >= Math.floor(maxCharacters * 0.6) ? preferredBoundary : maxCharacters
    chunks.push(remaining.slice(0, boundary).trim())
    remaining = remaining.slice(boundary).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function splitOversizedTurn(turn: string, maxCharacters: number): string[] {
  if (turn.length <= maxCharacters) return [turn]
  const heading = /^(### (?:AI|Me)(?: · 已打断)? at [^\n]+\n\n)/.exec(turn)?.[1]
  if (!heading) return splitAtNaturalBoundary(turn, maxCharacters)
  const bodyMaxCharacters = Math.max(500, maxCharacters - heading.length)
  return splitAtNaturalBoundary(turn.slice(heading.length), bodyMaxCharacters).map((part) => `${heading}${part}`)
}

function reviewTranscriptLength(reviewArchive: string): number {
  const transcriptStart = reviewArchive.indexOf('## Transcript')
  if (transcriptStart < 0) return reviewArchive.length
  const afterHeading = reviewArchive.slice(transcriptStart + '## Transcript'.length)
  const nextSection = /\n\n## (?!Transcript)/.exec(afterHeading)
  return (nextSection ? afterHeading.slice(0, nextSection.index) : afterHeading).trim().length
}

function reviewArchiveChunks(archiveMarkdown: string, directMaxCharacters = REVIEW_DIRECT_MAX_CHARACTERS, chunkMaxCharacters = REVIEW_CHUNK_MAX_CHARACTERS): string[] {
  const reviewArchive = archiveForReview(archiveMarkdown)
  const transcriptStart = reviewArchive.indexOf('## Transcript')
  if (transcriptStart < 0 || reviewTranscriptLength(reviewArchive) <= directMaxCharacters) return [reviewArchive]
  const header = reviewArchive.slice(0, transcriptStart).trim()
  const afterHeading = reviewArchive.slice(transcriptStart + '## Transcript'.length)
  const nextSection = /\n\n## (?!Transcript)/.exec(afterHeading)
  const transcript = (nextSection ? afterHeading.slice(0, nextSection.index) : afterHeading).trim()
  const turns = transcript.split(/(?=^### (?:AI|Me)(?: · 已打断)? at )/m).map((turn) => turn.trim()).filter(Boolean)
    .flatMap((turn) => splitOversizedTurn(turn, chunkMaxCharacters))
  if (turns.length <= 1) return [reviewArchive]
  const chunkTurns: string[][] = []
  let current: string[] = []
  let currentLength = 0
  for (const turn of turns) {
    if (current.length && currentLength + 2 + turn.length > chunkMaxCharacters) {
      chunkTurns.push(current)
      current = []
      currentLength = 0
    }
    current.push(turn)
    currentLength += (currentLength ? 2 : 0) + turn.length
  }
  if (current.length) chunkTurns.push(current)
  const prefix = header ? `${header}\n\n## Transcript\n\n` : '## Transcript\n\n'
  return chunkTurns.map((chunk) => `${prefix}${chunk.join('\n\n')}`)
}

function isReviewTimeout(error: unknown): boolean {
  return error instanceof Error && (/LLM request failed \(504\)/.test(error.message) || /大模型请求超过 \d+ 秒/.test(error.message) || isTimeoutError(error))
}

function uniqueReviewIssues(reviews: ReviewResult[]): ReviewResult['issues'] {
  const seen = new Set<string>()
  return reviews.flatMap((review) => review.issues).filter((issue) => {
    const key = `${issue.original.trim().toLocaleLowerCase().replace(/\s+/g, ' ')}\u0000${issue.improved.trim().toLocaleLowerCase().replace(/\s+/g, ' ')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function subtitleDeltaChunks(text: string): string[] {
  if ([...text].length <= SUBTITLE_DELTA_MAX_CHARACTERS) return [text]
  const chunks: string[] = []
  let chunk = ''
  let length = 0
  for (const character of text) {
    chunk += character
    length += 1
    const naturalBoundary = length >= SUBTITLE_DELTA_TARGET_CHARACTERS && /[\s,.!?;:，。！？；：]/u.test(character)
    if (naturalBoundary || length >= SUBTITLE_DELTA_MAX_CHARACTERS) {
      chunks.push(chunk)
      chunk = ''
      length = 0
    }
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

function waitForSubtitleFrame(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, SUBTITLE_DELTA_DELAY_MS)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function emitSubtitleDeltas(text: string, onDelta: (delta: string) => void, signal?: AbortSignal): Promise<void> {
  const chunks = subtitleDeltaChunks(text)
  for (let index = 0; index < chunks.length; index += 1) {
    if (signal?.aborted) throw abortError()
    onDelta(chunks[index])
    if (index < chunks.length - 1) await waitForSubtitleFrame(signal)
  }
}

export class LearningService {
  private readonly localDictionary?: LocalDictionary

  constructor(private readonly settings: SecureSettings, dictionaryDir?: string, private readonly fetcher: typeof fetch = fetch) {
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

  lookupLocal(query: string): DictionaryResult | undefined {
    return this.localDictionary?.lookup(query)
  }

  async review(archiveMarkdown: string, strength: string, favorites: string[] = []): Promise<ReviewResult> {
    const archiveChunks = reviewArchiveChunks(archiveMarkdown)
    const savedVocabulary = favorites.length ? favorites.map((word) => `- ${word}`).join('\n') : '(none)'
    const prompt = `You are a concise English speaking coach. Analyze this complete practice archive at correction level ${strength}. Return JSON only with this exact shape: {"topic":"string","summary":"string","issues":[{"original":"string","improved":"string","reason":"string"}],"vocabulary":[{"term":"string","meaning":"string","example":"string"}],"nextPractice":"string","assessment":{"estimatedCefr":"A1|A2|B1|B2|C1","scores":{"accuracy":0,"vocabulary":0,"fluency":0,"interaction":0},"errorCategories":[{"category":"grammar|word-choice|tense|articles|prepositions|fluency|coherence|interaction|other","count":1}],"weakPoints":["string"]}}. Scores are integer-like values from 0 to 100 based only on language visible in the transcript; do not claim acoustic pronunciation analysis. Use Chinese for explanations. Correct only learner language in the remaining ### Me transcript turns. Never treat frontmatter, saved items, metadata, or practice setup instructions as learner output. Include every distinct, meaningful correction supported by the transcript; do not impose a fixed 8- or 10-item limit, and avoid duplicate issues. The vocabulary array must contain explanations only for the saved vocabulary below. Give each saved word a short English example sentence. Do not add other vocabulary; when none is saved, return an empty vocabulary array. Saved vocabulary:\n${savedVocabulary}\nPractice archive Markdown:\n${archiveForReview(archiveMarkdown)}`
    try {
      const result = archiveChunks.length > 1 ? await this.askStreamingLlm(prompt, REVIEW_LLM_TIMEOUT_MS) : await this.askLlm(prompt, REVIEW_LLM_TIMEOUT_MS)
      const review = reviewSchema.parse(result)
      const saved = new Set(favorites.map((word) => word.toLocaleLowerCase()))
      return { ...review, vocabulary: review.vocabulary.filter((item) => saved.has(item.term.toLocaleLowerCase())) }
    } catch (error) {
      if (archiveChunks.length > 1 && isReviewTimeout(error)) return (await this.reviewLongArchive(archiveChunks, strength, favorites, [])).review
      throw error
    }
  }

  async reviewWithSentences(archiveMarkdown: string, strength: string, favorites: string[] = [], sentences: Array<Pick<SessionFavoriteSentence, 'sourceMessageId' | 'text'>> = []): Promise<{ review: ReviewResult; sentenceAnalyses: SessionSentenceAnalysis[] }> {
    const archiveChunks = reviewArchiveChunks(archiveMarkdown)
    if (!sentences.length) return { review: await this.review(archiveMarkdown, strength, favorites), sentenceAnalyses: [] }
    const savedVocabulary = favorites.length ? favorites.map((word) => `- ${word}`).join('\n') : '(none)'
    const savedSentences = JSON.stringify(sentences)
    const prompt = `You are a concise English speaking coach. Analyze this complete practice archive and every saved sentence in one response at correction level ${strength}. Return JSON only with this exact shape: {"topic":"string","summary":"string","issues":[{"original":"string","improved":"string","reason":"string"}],"vocabulary":[{"term":"string","meaning":"string","example":"string"}],"nextPractice":"string","assessment":{"estimatedCefr":"A1|A2|B1|B2|C1","scores":{"accuracy":0,"vocabulary":0,"fluency":0,"interaction":0},"errorCategories":[{"category":"grammar|word-choice|tense|articles|prepositions|fluency|coherence|interaction|other","count":1}],"weakPoints":["string"]},"sentenceAnalyses":[{"sourceMessageId":"copy the supplied id exactly","analysis":{"translation":"自然中文意思","structure":"一句简短的句型结构说明","reusablePattern":"一个可以替换内容复用的英文句型","expressions":[{"phrase":"原句中的常用表达","meaning":"简短中文含义和使用场景"}],"breakdown":[{"part":"原句片段","explanation":"该片段在句中的作用"}],"examples":["使用可复用句型的新例句"],"tip":"一个简短的易错点或更自然表达建议"}}]}. Scores are integer-like values from 0 to 100 based only on visible language; do not claim acoustic pronunciation analysis. Use Chinese for explanations. Correct only learner language in the remaining ### Me transcript turns. Never treat frontmatter, saved items, metadata, or practice setup instructions as learner output. Include every distinct, meaningful correction supported by the transcript; do not impose a fixed 8- or 10-item limit, and avoid duplicate issues. Vocabulary must explain only the saved vocabulary. Return exactly one sentenceAnalyses item for each saved sentence, preserving its sourceMessageId exactly. Keep structure and reusablePattern concise enough for a three-line list preview. Return at most 4 expressions, 5 breakdown items, and 3 examples per sentence. Saved vocabulary:\n${savedVocabulary}\nSaved sentences:\n${savedSentences}\nPractice archive Markdown:\n${archiveForReview(archiveMarkdown)}`
    try {
      const result = archiveChunks.length > 1 ? await this.askStreamingLlm(prompt, REVIEW_LLM_TIMEOUT_MS) : await this.askLlm(prompt, REVIEW_LLM_TIMEOUT_MS)
      const parsed = reviewWithSentencesSchema.parse(result)
      const savedWords = new Set(favorites.map((word) => word.toLocaleLowerCase()))
      const sentenceIds = new Set(sentences.map((sentence) => sentence.sourceMessageId))
      const seenSentenceIds = new Set<string>()
      const { sentenceAnalyses: rawSentenceAnalyses, ...rawReview } = parsed
      const review = { ...rawReview, vocabulary: rawReview.vocabulary.filter((item) => savedWords.has(item.term.toLocaleLowerCase())) }
      const sentenceAnalyses = rawSentenceAnalyses.filter((item) => {
        if (!sentenceIds.has(item.sourceMessageId) || seenSentenceIds.has(item.sourceMessageId)) return false
        seenSentenceIds.add(item.sourceMessageId)
        return true
      })
      if (sentenceAnalyses.length !== sentenceIds.size) throw new Error('大模型返回的收藏句子分析不完整，请重新生成复盘。')
      return { review, sentenceAnalyses }
    } catch (error) {
      if (archiveChunks.length > 1 && isReviewTimeout(error)) return this.reviewLongArchive(archiveChunks, strength, favorites, sentences)
      throw error
    }
  }

  private async reviewLongArchive(archiveChunks: string[], strength: string, favorites: string[], sentences: Array<Pick<SessionFavoriteSentence, 'sourceMessageId' | 'text'>>): Promise<{ review: ReviewResult; sentenceAnalyses: SessionSentenceAnalysis[] }> {
    const partialReviews: ReviewResult[] = []
    for (let index = 0; index < archiveChunks.length; index += 1) {
      partialReviews.push(...await this.reviewArchiveSegment(archiveChunks[index], strength, index + 1, archiveChunks.length))
    }
    const evidence = partialReviews.map(({ topic, summary, nextPractice, assessment }) => ({ topic, summary, nextPractice, assessment }))
    const savedVocabulary = favorites.length ? favorites.map((word) => `- ${word}`).join('\n') : '(none)'
    const savedSentences = JSON.stringify(sentences)
    const result = await this.askLlm(`You are a concise English speaking coach. Synthesize the overall review from segmented evidence at correction level ${strength}. The correction issues have already been preserved separately, so do not return issues. Return JSON only with this exact shape: {"topic":"string","summary":"string","vocabulary":[{"term":"string","meaning":"string","example":"string"}],"nextPractice":"string","assessment":{"estimatedCefr":"A1|A2|B1|B2|C1","scores":{"accuracy":0,"vocabulary":0,"fluency":0,"interaction":0},"errorCategories":[{"category":"grammar|word-choice|tense|articles|prepositions|fluency|coherence|interaction|other","count":1}],"weakPoints":["string"]},"sentenceAnalyses":[{"sourceMessageId":"copy the supplied id exactly","analysis":{"translation":"自然中文意思","structure":"一句简短的句型结构说明","reusablePattern":"一个可以替换内容复用的英文句型","expressions":[{"phrase":"原句中的常用表达","meaning":"简短中文含义和使用场景"}],"breakdown":[{"part":"原句片段","explanation":"该片段在句中的作用"}],"examples":["使用可复用句型的新例句"],"tip":"一个简短的易错点或更自然表达建议"}}]}. Use Chinese for explanations. Base the overall scores on all segment evidence and do not claim acoustic pronunciation analysis. Vocabulary must explain only the saved vocabulary; add no other words. Return exactly one sentenceAnalyses item for each saved sentence, preserving sourceMessageId exactly; return an empty array when there are none. Keep sentence analyses concise and return at most 4 expressions, 5 breakdown items, and 3 examples per sentence. Saved vocabulary:\n${savedVocabulary}\nSaved sentences:\n${savedSentences}\nSegmented review evidence:\n${JSON.stringify(evidence)}`, REVIEW_LLM_TIMEOUT_MS)
    const parsed = reviewSynthesisSchema.parse(result)
    const savedWords = new Set(favorites.map((word) => word.toLocaleLowerCase()))
    const sentenceIds = new Set(sentences.map((sentence) => sentence.sourceMessageId))
    const seenSentenceIds = new Set<string>()
    const sentenceAnalyses = parsed.sentenceAnalyses.filter((item) => {
      if (!sentenceIds.has(item.sourceMessageId) || seenSentenceIds.has(item.sourceMessageId)) return false
      seenSentenceIds.add(item.sourceMessageId)
      return true
    })
    if (sentenceAnalyses.length !== sentenceIds.size) throw new Error('大模型返回的收藏句子分析不完整，请重新生成复盘。')
    const { sentenceAnalyses: _sentenceAnalyses, ...synthesis } = parsed
    return {
      review: { ...synthesis, issues: uniqueReviewIssues(partialReviews), vocabulary: synthesis.vocabulary.filter((item) => savedWords.has(item.term.toLocaleLowerCase())) },
      sentenceAnalyses
    }
  }

  private async reviewArchiveSegment(archiveChunk: string, strength: string, segmentNumber: number, segmentCount: number): Promise<ReviewResult[]> {
    try {
      const result = await this.askLlm(`You are a concise English speaking coach. Analyze transcript segment ${segmentNumber} of ${segmentCount} at correction level ${strength}. Return JSON only with this exact shape: {"topic":"string","summary":"string","issues":[{"original":"string","improved":"string","reason":"string"}],"vocabulary":[],"nextPractice":"string","assessment":{"estimatedCefr":"A1|A2|B1|B2|C1","scores":{"accuracy":0,"vocabulary":0,"fluency":0,"interaction":0},"errorCategories":[{"category":"grammar|word-choice|tense|articles|prepositions|fluency|coherence|interaction|other","count":1}],"weakPoints":["string"]}}. Scores are integer-like values from 0 to 100 based only on visible language. Use Chinese for explanations. Correct only learner language in ### Me turns. Include every distinct, meaningful correction in this segment; do not impose a fixed 8- or 10-item limit. Never correct AI turns, setup instructions, frontmatter, saved items, or metadata. Keep vocabulary empty because saved vocabulary is handled in the final synthesis. Transcript segment:\n${archiveChunk}`, REVIEW_LLM_TIMEOUT_MS)
      return [reviewSchema.parse(result)]
    } catch (error) {
      const transcriptLength = reviewTranscriptLength(archiveChunk)
      if (!isReviewTimeout(error) || transcriptLength <= REVIEW_RETRY_MIN_CHARACTERS) throw error
      const smallerMaxCharacters = Math.max(REVIEW_RETRY_MIN_CHARACTERS, Math.floor(transcriptLength / 2))
      const smallerChunks = reviewArchiveChunks(archiveChunk, 0, smallerMaxCharacters)
      if (smallerChunks.length <= 1) throw error
      const reviews: ReviewResult[] = []
      for (let index = 0; index < smallerChunks.length; index += 1) {
        reviews.push(...await this.reviewArchiveSegment(smallerChunks[index], strength, index + 1, smallerChunks.length))
      }
      return reviews
    }
  }

  async chat(events: TranscriptEvent[], topic: string, level: string, prompt?: string, systemPrompt?: string, topicDocument?: string): Promise<string> {
    return this.requestLlm(this.chatMessages(events, topic, level, prompt, systemPrompt, topicDocument))
  }

  async streamChat(events: TranscriptEvent[], topic: string, level: string, options: { onDelta: (delta: string) => void; signal?: AbortSignal }, prompt?: string, systemPrompt?: string, topicDocument?: string): Promise<string> {
    const messages = this.chatMessages(events, topic, level, prompt, systemPrompt, topicDocument)
    const config = this.requireLlmConfig()
    const body = { model: config.model, messages, stream: true }
    let received = ''
    try {
      const response = await this.post(config.url, config.apiKey, body, options.signal)
      if (!response.ok) {
        if ([400, 404, 405, 415, 422].includes(response.status)) return this.nonStreamingFallback(messages, options)
        throw new Error(`LLM request failed (${response.status})`)
      }
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (!contentType.includes('text/event-stream')) return this.readNonStreamingResponse(response, options.onDelta, options.signal)
      received = await readSseResponse(response, options.onDelta, options.signal)
      if (received) return received
      return this.nonStreamingFallback(messages, options)
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
      if (received) throw error
      throw error
    }
  }

  private async askLlm(prompt: string, timeoutMs = DEFAULT_LLM_TIMEOUT_MS): Promise<unknown> {
    const content = await this.requestLlm([{ role: 'user', content: prompt }], true, timeoutMs)
    try { return JSON.parse(content) } catch { throw new Error('LLM returned invalid JSON.') }
  }

  private async askStreamingLlm(prompt: string, timeoutMs: number): Promise<unknown> {
    const config = this.requireLlmConfig()
    const messages: LlmMessage[] = [{ role: 'user', content: prompt }]
    const body = { model: config.model, messages, stream: true, response_format: { type: 'json_object' } }
    let content: string
    try {
      const response = await this.post(config.url, config.apiKey, body, undefined, timeoutMs)
      if (!response.ok) {
        if ([400, 404, 405, 415, 422].includes(response.status)) {
          content = await this.requestLlm(messages, true, timeoutMs)
        } else {
          throw new Error(`LLM request failed (${response.status})`)
        }
      } else {
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
        content = contentType.includes('text/event-stream') ? await readSseResponse(response) : await this.readNonStreamingResponse(response)
      }
    } catch (error) {
      if (isTimeoutError(error)) throw timeoutError(timeoutMs)
      throw error
    }
    try { return JSON.parse(content) } catch { throw new Error('LLM returned invalid JSON.') }
  }

  private async requestLlm(messages: LlmMessage[], json = false, timeoutMs = DEFAULT_LLM_TIMEOUT_MS): Promise<string> {
    const config = this.requireLlmConfig()
    const body = { model: config.model, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) }
    try {
      const response = await this.post(config.url, config.apiKey, body, undefined, timeoutMs)
      if (!response.ok) throw new Error(`LLM request failed (${response.status})`)
      return await this.readNonStreamingResponse(response)
    } catch (error) {
      if (isTimeoutError(error)) throw timeoutError(timeoutMs)
      throw error
    }
  }

  private chatMessages(events: TranscriptEvent[], topic: string, level: string, prompt?: string, systemPrompt?: string, topicDocument?: string): LlmMessage[] {
    return [
      { role: 'system', content: buildDirectChatSystemPrompt(topic, level, prompt, systemPrompt, topicDocument) },
      ...events.filter((event) => event.status === 'complete').map((event) => ({ role: event.speaker === 'assistant' ? 'assistant' as const : 'user' as const, content: event.text }))
    ]
  }

  private requireLlmConfig(): { url: URL; model: string; apiKey: string } {
    const config = this.settings.get(); const secrets = this.settings.getSecrets()
    if (!config.llmBaseUrl || !config.llmModel || !secrets.llmApiKey) throw new Error('Please configure an OpenAI-compatible Base URL, model, and API key first.')
    const url = new URL('chat/completions', config.llmBaseUrl.endsWith('/') ? config.llmBaseUrl : `${config.llmBaseUrl}/`)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('The LLM Base URL must use HTTP or HTTPS.')
    return { url, model: config.llmModel, apiKey: secrets.llmApiKey }
  }

  private async post(url: URL, apiKey: string, body: unknown, signal?: AbortSignal, timeoutMs = DEFAULT_LLM_TIMEOUT_MS): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      return await this.fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: requestSignal })
    } catch (error) {
      if (timeout.aborted && !signal?.aborted) throw timeoutError(timeoutMs)
      throw error
    }
  }

  private async nonStreamingFallback(messages: LlmMessage[], options: { onDelta: (delta: string) => void; signal?: AbortSignal }): Promise<string> {
    const config = this.requireLlmConfig()
    const response = await this.post(config.url, config.apiKey, { model: config.model, messages }, options.signal)
    if (!response.ok) throw new Error(`LLM request failed (${response.status})`)
    return this.readNonStreamingResponse(response, options.onDelta, options.signal)
  }

  private async readNonStreamingResponse(response: Response, onContent?: (content: string) => void, signal?: AbortSignal): Promise<string> {
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('LLM returned no message content.')
    if (onContent) await emitSubtitleDeltas(content, onContent, signal)
    return content
  }
}

async function readSseResponse(response: Response, onDelta?: (delta: string) => void, signal?: AbortSignal): Promise<string> {
  if (!response.body) throw new Error('LLM streaming response had no body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = ''
  const consume = async (block: string): Promise<boolean> => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n').trim()
    if (!data) return false
    if (data === '[DONE]') return true
    let payload: { choices?: Array<{ delta?: { content?: string } }> }
    try { payload = JSON.parse(data) as typeof payload } catch { return false }
    const delta = payload.choices?.[0]?.delta?.content
    if (delta) {
      result += delta
      if (onDelta) await emitSubtitleDeltas(delta, onDelta, signal)
    }
    return false
  }
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''
    for (const block of blocks) if (await consume(block)) return result
    if (done) break
  }
  if (buffer) await consume(buffer)
  return result
}
