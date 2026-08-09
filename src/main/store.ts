import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { CorrectionStrength, HistorySearchQuery, LearningDashboard, LearningPeriod, NextPracticeDraft, PracticeProfile, PracticeSession, ReviewResult, SavedSentenceItem, SentenceLearningStatus, SessionArchiveDetail, SessionArchiveSummary, SessionFavoriteSentence, SessionSentenceAnalysis, TranscriptEvent, VocabularyFamiliarity, VocabularyItem, VocabularyReviewRating } from '../shared/types'

type IndexedSession = { fileName: string; modifiedAt: number; detail: SessionArchiveDetail; searchText: string }
type LearningIndex = { version: 1; sessions: IndexedSession[]; vocabulary: VocabularyItem[]; sentences: SavedSentenceItem[] }

const finalFilePattern = /^speaksub-(practice|interrupted)-.+\.md$/
const supportedTopics = new Set(['日常聊天', '旅行英语', '面试英语', '职场会议', '雅思口语', '自由闲聊', '情景角色扮演'])
const defaultProfile = (strength: CorrectionStrength): PracticeProfile => ({ topic: '口语练习', level: 'B1', source: 'api-direct', mode: 'text', correctionStrength: strength })
const normalizeTerm = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
const encodePayload = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
const decodePayload = <T>(markdown: string, name: string): T | undefined => {
  const match = markdown.match(new RegExp(`<!-- speaksub-${name}:([A-Za-z0-9+/=]+) -->`))
  if (!match) return undefined
  try { return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as T } catch { return undefined }
}

/** Markdown remains the readable archive; the JSON file is an atomic, rebuildable search and learning index. */
export class SpeakSubStore {
  private readonly currentPath: string
  private readonly indexPath: string
  private readonly currentEvents = new Map<string, TranscriptEvent[]>()
  private readonly currentSessions = new Map<string, PracticeSession>()
  private readonly currentFavorites = new Map<string, string[]>()
  private readonly currentFavoriteSentences = new Map<string, SessionFavoriteSentence[]>()
  private readonly reviews = new Map<string, ReviewResult>()
  private index: LearningIndex

  constructor(private readonly dataDirectory: string, private readonly now: () => Date = () => new Date()) {
    mkdirSync(dataDirectory, { recursive: true })
    this.currentPath = join(dataDirectory, 'current-practice.md')
    this.indexPath = join(dataDirectory, 'learning-index.json')
    this.index = this.readIndex()
    this.reconcileArchives()
  }

  createSession(input: CorrectionStrength | PracticeProfile): PracticeSession {
    this.archiveInterruptedPractice()
    const profile = typeof input === 'string' ? defaultProfile(input) : input
    const session: PracticeSession = { id: randomUUID(), startedAt: this.now().toISOString(), ...profile }
    this.currentEvents.set(session.id, [])
    this.currentSessions.set(session.id, session)
    this.currentFavorites.set(session.id, [])
    this.currentFavoriteSentences.set(session.id, [])
    this.writeSession(session)
    return session
  }

  endSession(session: PracticeSession): PracticeSession {
    const ended = { ...session, endedAt: this.now().toISOString() }
    this.currentSessions.set(session.id, ended)
    this.writeSession(ended)
    return ended
  }

  abortSession(sessionId: string): void {
    this.currentEvents.delete(sessionId); this.currentSessions.delete(sessionId); this.currentFavorites.delete(sessionId); this.currentFavoriteSentences.delete(sessionId); this.reviews.delete(sessionId)
    rmSync(this.currentPath, { force: true })
  }

  upsertEvent(event: TranscriptEvent): void {
    const current = this.currentEvents.get(event.sessionId) ?? []
    const index = current.findIndex((item) => item.sourceMessageId === event.sourceMessageId)
    if (index === -1) current.push(event); else current[index] = { ...current[index], ...event, id: current[index].id }
    this.currentEvents.set(event.sessionId, current)
    const session = this.currentSessions.get(event.sessionId)
    if (session && event.status === 'complete') this.writeSession(session, this.reviews.get(event.sessionId))
  }

  eventsForSession(sessionId: string): TranscriptEvent[] { return this.currentEvents.get(sessionId) ?? [] }
  favoriteWordsForSession(sessionId: string): string[] { return this.currentFavorites.get(sessionId) ?? [] }
  favoriteSentencesForSession(sessionId: string): SessionFavoriteSentence[] { return this.currentFavoriteSentences.get(sessionId) ?? [] }

  saveFavorite(sessionId: string, word: string): void {
    const session = this.currentSessions.get(sessionId)
    if (!session) throw new Error('Start a practice before saving a word.')
    const favorites = this.currentFavorites.get(sessionId) ?? []
    if (!favorites.some((current) => normalizeTerm(current) === normalizeTerm(word))) favorites.push(word.trim().replace(/\s+/g, ' '))
    this.currentFavorites.set(sessionId, favorites)
    this.writeSession(session, this.reviews.get(sessionId))
  }

  saveSentenceFavorite(sessionId: string, sourceMessageId: string): SessionFavoriteSentence {
    const session = this.currentSessions.get(sessionId)
    if (!session) throw new Error('Start a practice before saving a sentence.')
    const event = this.eventsForSession(sessionId).find((candidate) => candidate.sourceMessageId === sourceMessageId)
    if (!event || event.status !== 'complete') throw new Error('Wait for the sentence to finish before saving it.')
    const favorites = this.currentFavoriteSentences.get(sessionId) ?? []
    const existing = favorites.find((candidate) => candidate.sourceMessageId === sourceMessageId)
    if (existing) return structuredClone(existing)
    const text = event.text.normalize('NFKC').trim().replace(/[\t ]*\r?\n+[\t ]*/g, ' ').replace(/\s+/g, ' ')
    if (!text) throw new Error('The sentence is empty and cannot be saved.')
    const favorite: SessionFavoriteSentence = { sourceMessageId, speaker: event.speaker, text, savedAt: this.now().toISOString(), learningStatus: 'learning' }
    favorites.push(favorite)
    this.currentFavoriteSentences.set(sessionId, favorites)
    this.writeSession(session, this.reviews.get(sessionId))
    return structuredClone(favorite)
  }

  flushSession(sessionId: string): void {
    const session = this.currentSessions.get(sessionId)
    if (session) this.writeSession(session, this.reviews.get(sessionId))
  }

  readSessionMarkdown(sessionId: string): string {
    if (!this.currentSessions.has(sessionId) || !existsSync(this.currentPath)) throw new Error('The active practice file is unavailable.')
    return readFileSync(this.currentPath, 'utf8')
  }

  readArchivedSessionMarkdown(sessionId: string): string {
    const entry = this.index.sessions.find(({ detail }) => detail.id === sessionId)
    if (!entry) throw new Error('The archived practice was not found.')
    return readFileSync(join(this.dataDirectory, basename(entry.fileName)), 'utf8')
  }

  saveReview(sessionId: string, review: ReviewResult, sentenceAnalyses: SessionSentenceAnalysis[] = []): void {
    this.reviews.set(sessionId, review)
    const session = this.currentSessions.get(sessionId)
    if (sentenceAnalyses.length) {
      const analyses = new Map(sentenceAnalyses.map((item) => [item.sourceMessageId, item.analysis]))
      const sentences = this.favoriteSentencesForSession(sessionId).map((sentence) => analyses.has(sentence.sourceMessageId) ? { ...sentence, analysis: analyses.get(sentence.sourceMessageId) } : sentence)
      this.currentFavoriteSentences.set(sessionId, sentences)
    }
    if (session) this.writeSession(session, review)
  }

  saveArchivedReview(sessionId: string, review: ReviewResult, sentenceAnalyses: SessionSentenceAnalysis[] = []): SessionArchiveDetail {
    const entry = this.index.sessions.find(({ detail }) => detail.id === sessionId)
    if (!entry) throw new Error('The archived practice was not found.')
    if (entry.detail.status !== 'completed') throw new Error('Only completed practices can generate a review.')
    const path = join(this.dataDirectory, basename(entry.fileName))
    const previousMarkdown = readFileSync(path, 'utf8')
    const previousIndex = structuredClone(this.index)
    const detail = entry.detail
    const session: PracticeSession = {
      id: detail.id,
      startedAt: detail.startedAt,
      endedAt: detail.endedAt,
      topic: detail.topic,
      level: detail.level,
      source: detail.source,
      mode: detail.mode,
      correctionStrength: detail.correctionStrength,
      focus: detail.focus
    }
    const analyses = new Map(sentenceAnalyses.map((item) => [item.sourceMessageId, item.analysis]))
    const favoriteSentences = (detail.favoriteSentences ?? []).map((sentence) => analyses.has(sentence.sourceMessageId) ? { ...sentence, analysis: analyses.get(sentence.sourceMessageId) } : sentence)
    try {
      this.atomicWrite(path, this.renderSessionMarkdown(session, detail.transcript, detail.favoriteWords, favoriteSentences, review))
      this.upsertArchive(path)
      this.writeIndex()
      return this.getSessionDetail(sessionId)
    } catch (error) {
      this.index = previousIndex
      this.atomicWrite(path, previousMarkdown)
      this.writeIndex()
      throw error
    }
  }

  finalizeSession(sessionId: string): string | undefined {
    const session = this.currentSessions.get(sessionId)
    if (!session || !existsSync(this.currentPath)) return undefined
    const stamp = (session.endedAt ?? session.startedAt).replace(/[:.]/g, '-')
    const destination = join(this.dataDirectory, `speaksub-practice-${stamp}.md`)
    renameSync(this.currentPath, destination)
    try {
      this.upsertArchive(destination)
      this.writeIndex()
    } catch (error) {
      renameSync(destination, this.currentPath)
      throw error
    }
    this.currentEvents.delete(sessionId); this.currentSessions.delete(sessionId); this.currentFavorites.delete(sessionId); this.currentFavoriteSentences.delete(sessionId); this.reviews.delete(sessionId)
    return destination
  }

  searchSessions(query: HistorySearchQuery = {}): SessionArchiveSummary[] {
    const text = query.text?.normalize('NFKC').trim().toLocaleLowerCase()
    return this.index.sessions.filter(({ detail, searchText }) => {
      if (text && !searchText.includes(text)) return false
      if (query.source && detail.source !== query.source) return false
      if (query.mode && detail.mode !== query.mode) return false
      if (query.level && detail.level !== query.level) return false
      if (query.status && detail.status !== query.status) return false
      if (query.dateFrom && detail.startedAt < query.dateFrom) return false
      if (query.dateTo && detail.startedAt > query.dateTo) return false
      return true
    }).map(({ detail }) => this.summary(detail)).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  getSessionDetail(id: string): SessionArchiveDetail {
    const found = this.index.sessions.find(({ detail }) => detail.id === id)
    if (!found) throw new Error('The archived practice was not found.')
    return structuredClone(found.detail)
  }

  deleteSession(id: string): void {
    const position = this.index.sessions.findIndex(({ detail }) => detail.id === id)
    if (position < 0) throw new Error('The archived practice was not found.')
    const entry = this.index.sessions[position]
    const path = join(this.dataDirectory, basename(entry.fileName))
    const tombstone = `${path}.deleting`
    const previous = structuredClone(this.index)
    renameSync(path, tombstone)
    try {
      this.index.sessions.splice(position, 1)
      for (const item of this.index.vocabulary) item.sessionIds = item.sessionIds.filter((sessionId) => sessionId !== id)
      this.index.vocabulary = this.index.vocabulary.filter((item) => item.sessionIds.length > 0)
      this.rebuildSentences()
      this.writeIndex()
      rmSync(tombstone, { force: true })
    } catch (error) {
      this.index = previous
      if (existsSync(tombstone)) renameSync(tombstone, path)
      this.writeIndex()
      throw error
    }
  }

  listVocabulary(filter: { familiarity?: VocabularyFamiliarity; dueOnly?: boolean; text?: string } = {}): VocabularyItem[] {
    const now = this.now().toISOString(); const text = normalizeTerm(filter.text ?? '')
    return this.index.vocabulary.filter((item) => (!filter.familiarity || item.familiarity === filter.familiarity) && (!filter.dueOnly || item.nextReviewAt <= now) && (!text || item.normalizedTerm.includes(text) || item.meaning?.toLocaleLowerCase().includes(text)))
      .sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt) || a.firstSavedAt.localeCompare(b.firstSavedAt)).map((item) => structuredClone(item))
  }

  listSavedSentences(filter: { text?: string; learningStatus?: SentenceLearningStatus } = {}): SavedSentenceItem[] {
    const text = normalizeTerm(filter.text ?? '')
    return this.index.sentences.filter((item) => (!text || normalizeTerm(item.text).includes(text)) && (!filter.learningStatus || item.learningStatus === filter.learningStatus))
      .sort((a, b) => {
        const aDate = a.learningStatus === 'mastered' ? a.learnedAt ?? a.savedAt : a.savedAt
        const bDate = b.learningStatus === 'mastered' ? b.learnedAt ?? b.savedAt : b.savedAt
        return bDate.localeCompare(aDate)
      }).map((item) => structuredClone(item))
  }

  updateSavedSentenceStatus(id: string, learningStatus: SentenceLearningStatus): SavedSentenceItem {
    return this.updateArchivedSentence(id, (sentence) => ({
      ...sentence,
      learningStatus,
      learnedAt: learningStatus === 'mastered' ? this.now().toISOString() : undefined
    }))
  }

  updateVocabularyFamiliarity(id: string, familiarity: VocabularyFamiliarity): VocabularyItem {
    const item = this.index.vocabulary.find((candidate) => candidate.id === id)
    if (!item) throw new Error('The saved vocabulary item was not found.')
    const now = this.now(); const days = familiarity === 'unfamiliar' ? 0 : familiarity === 'learning' ? 3 : 14
    item.familiarity = familiarity; item.lastReviewedAt = now.toISOString(); item.nextReviewAt = new Date(now.getTime() + days * 86_400_000).toISOString()
    this.writeIndex()
    return structuredClone(item)
  }

  reviewVocabulary(id: string, rating: VocabularyReviewRating): VocabularyItem {
    const item = this.index.vocabulary.find((candidate) => candidate.id === id)
    if (!item) throw new Error('The saved vocabulary item was not found.')
    const schedule: Record<VocabularyReviewRating, { familiarity: VocabularyFamiliarity; days: number }> = {
      again: { familiarity: 'unfamiliar', days: 0 }, hard: { familiarity: 'learning', days: 1 }, good: { familiarity: 'learning', days: 3 }, easy: { familiarity: 'mastered', days: 14 }
    }
    const next = schedule[rating]; const now = this.now()
    item.familiarity = next.familiarity; item.lastReviewedAt = now.toISOString(); item.nextReviewAt = new Date(now.getTime() + next.days * 86_400_000).toISOString()
    this.writeIndex()
    return structuredClone(item)
  }

  saveVocabularyMeaning(id: string, meaning: string): VocabularyItem {
    const item = this.index.vocabulary.find((candidate) => candidate.id === id)
    if (!item) throw new Error('The saved vocabulary item was not found.')
    if (item.meaning !== meaning) { item.meaning = meaning; this.writeIndex() }
    return structuredClone(item)
  }

  getReviewQueue(): VocabularyItem[] { return this.listVocabulary({ dueOnly: true }) }

  getLearningDashboard(period: LearningPeriod): LearningDashboard {
    const to = this.now(); const days = period === 'week' ? 7 : 30; const from = new Date(to.getTime() - (days - 1) * 86_400_000); from.setHours(0, 0, 0, 0)
    const sessions = this.index.sessions.map(({ detail }) => detail).filter((detail) => detail.status === 'completed' && detail.startedAt >= from.toISOString() && detail.startedAt <= to.toISOString())
    const activityMap = new Map<string, { sessions: number; minutes: number }>()
    for (const session of sessions) { const date = session.startedAt.slice(0, 10); const current = activityMap.get(date) ?? { sessions: 0, minutes: 0 }; current.sessions += 1; current.minutes += session.durationSeconds / 60; activityMap.set(date, current) }
    const assessments = sessions.map((session) => session.review?.assessment).filter(Boolean) as NonNullable<ReviewResult['assessment']>[]
    const averageScores = assessments.length ? (['accuracy', 'vocabulary', 'fluency', 'interaction'] as const).reduce((result, key) => ({ ...result, [key]: Math.round(assessments.reduce((sum, item) => sum + item.scores[key], 0) / assessments.length) }), {} as NonNullable<ReviewResult['assessment']>['scores']) : undefined
    const errors = new Map<string, number>(); for (const assessment of assessments) for (const item of assessment.errorCategories) errors.set(item.category, (errors.get(item.category) ?? 0) + item.count)
    const practicedDates = new Set(this.index.sessions.filter(({ detail }) => detail.status === 'completed').map(({ detail }) => detail.startedAt.slice(0, 10))); let streakDays = 0; const cursor = new Date(to); cursor.setUTCHours(0, 0, 0, 0)
    if (!practicedDates.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1)
    while (practicedDates.has(cursor.toISOString().slice(0, 10))) { streakDays += 1; cursor.setUTCDate(cursor.getUTCDate() - 1) }
    return {
      period, from: from.toISOString(), to: to.toISOString(), sessionCount: sessions.length, totalMinutes: Math.round(sessions.reduce((sum, item) => sum + item.durationSeconds, 0) / 60), practiceDays: activityMap.size, streakDays,
      newVocabulary: this.index.vocabulary.filter((item) => item.firstSavedAt >= from.toISOString() && item.firstSavedAt <= to.toISOString()).length,
      masteredVocabulary: this.index.vocabulary.filter((item) => item.familiarity === 'mastered').length, dueVocabulary: this.getReviewQueue().length, averageScores,
      cefrTrend: sessions.flatMap((item) => item.review?.assessment ? [{ date: item.startedAt.slice(0, 10), level: item.review.assessment.estimatedCefr }] : []),
      topErrors: [...errors].map(([category, count]) => ({ category: category as LearningDashboard['topErrors'][number]['category'], count })).sort((a, b) => b.count - a.count).slice(0, 5),
      activity: [...activityMap].map(([date, value]) => ({ date, sessions: value.sessions, minutes: Math.round(value.minutes) })).sort((a, b) => a.date.localeCompare(b.date))
    }
  }

  createNextPracticeDraft(sessionId: string): NextPracticeDraft {
    const detail = this.getSessionDetail(sessionId)
    const weak = detail.review?.assessment?.weakPoints ?? []
    const focus = [...weak, detail.review?.nextPractice].filter(Boolean).join('\n')
    return { derivedFromSessionId: sessionId, topic: supportedTopics.has(detail.topic) ? detail.topic : '日常聊天', level: detail.level ?? 'B1', source: detail.source ?? 'api-direct', mode: detail.mode ?? 'text', correctionStrength: detail.correctionStrength, focus }
  }

  clear(): void {
    for (const file of readdirSync(this.dataDirectory)) if (file === 'current-practice.md' || file === 'learning-index.json' || file === 'learning-index.json.bak' || finalFilePattern.test(file)) rmSync(join(this.dataDirectory, file), { force: true })
    this.currentEvents.clear(); this.currentSessions.clear(); this.currentFavorites.clear(); this.currentFavoriteSentences.clear(); this.reviews.clear(); this.index = { version: 1, sessions: [], vocabulary: [], sentences: [] }
  }

  private archiveInterruptedPractice(): void {
    if (!existsSync(this.currentPath)) return
    const destination = join(this.dataDirectory, `speaksub-interrupted-${this.now().toISOString().replace(/[:.]/g, '-')}.md`)
    renameSync(this.currentPath, destination); this.upsertArchive(destination); this.writeIndex()
  }

  private writeSession(session: PracticeSession, review?: ReviewResult): void {
    const events = this.eventsForSession(session.id).filter((event) => event.status === 'complete')
    const favorites = this.favoriteWordsForSession(session.id)
    const favoriteSentences = this.favoriteSentencesForSession(session.id)
    this.atomicWrite(this.currentPath, this.renderSessionMarkdown(session, events, favorites, favoriteSentences, review))
  }

  private updateArchivedSentence(id: string, update: (sentence: SessionFavoriteSentence) => SessionFavoriteSentence): SavedSentenceItem {
    const indexedSentence = this.index.sentences.find((item) => item.id === id)
    if (!indexedSentence) throw new Error('The saved sentence was not found.')
    const entry = this.index.sessions.find(({ detail }) => detail.id === indexedSentence.sessionId)
    if (!entry) throw new Error('The archived practice was not found.')
    const sentenceIndex = entry.detail.favoriteSentences?.findIndex((item) => item.sourceMessageId === indexedSentence.sourceMessageId) ?? -1
    if (sentenceIndex < 0) throw new Error('The saved sentence was not found in its archive.')
    const path = join(this.dataDirectory, basename(entry.fileName))
    const previousMarkdown = readFileSync(path, 'utf8')
    const previousIndex = structuredClone(this.index)
    const detail = entry.detail
    const favoriteSentences = (detail.favoriteSentences ?? []).map((sentence, index) => index === sentenceIndex ? update(structuredClone(sentence)) : sentence)
    const session: PracticeSession = { id: detail.id, startedAt: detail.startedAt, endedAt: detail.endedAt, topic: detail.topic, level: detail.level, source: detail.source, mode: detail.mode, correctionStrength: detail.correctionStrength, focus: detail.focus }
    try {
      this.atomicWrite(path, this.renderSessionMarkdown(session, detail.transcript, detail.favoriteWords, favoriteSentences, detail.review))
      this.upsertArchive(path)
      this.writeIndex()
      const saved = this.index.sentences.find((item) => item.id === id)
      if (!saved) throw new Error('The updated sentence could not be indexed.')
      return structuredClone(saved)
    } catch (error) {
      this.index = previousIndex
      this.atomicWrite(path, previousMarkdown)
      this.writeIndex()
      throw error
    }
  }

  private renderSessionMarkdown(session: PracticeSession, events: SessionArchiveDetail['transcript'], favorites: string[], favoriteSentences: SessionFavoriteSentence[], review?: ReviewResult): string {
    const transcript = events.length ? events.map((event) => `### ${event.speaker === 'assistant' ? `AI${event.interrupted ? ' · 已打断' : ''}` : 'Me'} at ${event.receivedAt ?? session.startedAt}\n\n${event.text}`).join('\n\n') : '_No supported page text was captured._'
    const favoritesSection = favorites.length ? `\n\n## Saved vocabulary\n\n${favorites.map((word) => `- ${word}`).join('\n')}` : ''
    const favoriteSentencesSection = favoriteSentences.length ? `\n\n## Saved sentences\n\n${favoriteSentences.map((item) => `- ${item.speaker === 'assistant' ? 'AI' : 'Me'}: ${item.text}`).join('\n')}` : ''
    const reviewSection = review ? `\n\n## Review\n\n**Topic:** ${review.topic}\n\n${review.summary}\n\n### Corrections\n\n${review.issues.map((issue) => `- ${issue.original} -> ${issue.improved}: ${issue.reason}`).join('\n')}\n\n### Vocabulary\n\n${review.vocabulary.map((item) => `- ${item.term}: ${item.meaning}${item.example ? `\n  - Example: ${item.example}` : ''}`).join('\n')}\n\n### Next practice\n\n${review.nextPractice}` : ''
    const metadata = { ...session, favorites, favoriteSentences, events: events.map(({ speaker, text, receivedAt, interrupted }) => ({ speaker, text, receivedAt, interrupted })), review }
    return `---\nid: ${session.id}\nstartedAt: ${session.startedAt}\nendedAt: ${session.endedAt ?? ''}\ncorrectionStrength: ${session.correctionStrength}\ntopic: ${JSON.stringify(session.topic ?? '口语练习')}\nlevel: ${session.level ?? ''}\nsource: ${session.source ?? ''}\nmode: ${session.mode ?? ''}\n---\n\n<!-- speaksub-session:${encodePayload(metadata)} -->\n\n# Speaking practice\n\n## Transcript\n\n${transcript}${favoritesSection}${favoriteSentencesSection}${reviewSection}\n`
  }

  private parseArchive(path: string): SessionArchiveDetail {
    const markdown = readFileSync(path, 'utf8'); const embedded = decodePayload<PracticeSession & { favorites?: string[]; favoriteSentences?: SessionFavoriteSentence[]; events?: SessionArchiveDetail['transcript']; review?: ReviewResult }>(markdown, 'session')
    const field = (name: string) => markdown.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1]?.trim()
    const stringField = (name: string, fallback = '') => { const value = field(name); if (!value) return fallback; try { return JSON.parse(value) as string } catch { return value } }
    const startedAt = embedded?.startedAt ?? field('startedAt') ?? statSync(path).birthtime.toISOString(); const endedAt = embedded?.endedAt || field('endedAt') || undefined
    const transcript = embedded?.events ?? [...markdown.matchAll(/### (AI|Me)( · 已打断)? at ([^\n]+)\n\n([\s\S]*?)(?=\n\n### |\n\n## |$)/g)].map((match) => ({ speaker: match[1] === 'AI' ? 'assistant' as const : 'user' as const, interrupted: Boolean(match[2]), receivedAt: match[3], text: match[4].trim() }))
    const favorites = embedded?.favorites ?? (markdown.match(/## Saved vocabulary\n\n([\s\S]*?)(?=\n\n## |$)/)?.[1]?.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim()) ?? [])
    const favoriteSentences = embedded?.favoriteSentences ?? (markdown.match(/## Saved sentences\n\n([\s\S]*?)(?=\n\n## |$)/)?.[1]?.split('\n').flatMap((line, index) => {
      const match = line.match(/^- (AI|Me):\s*(.+)$/)
      return match ? [{ sourceMessageId: `legacy-${index}`, speaker: match[1] === 'AI' ? 'assistant' as const : 'user' as const, text: match[2], savedAt: startedAt }] : []
    }) ?? [])
    const status = basename(path).startsWith('speaksub-interrupted-') ? 'interrupted' as const : 'completed' as const
    const review = embedded?.review
    return { id: embedded?.id ?? field('id') ?? randomUUID(), status, startedAt, endedAt, durationSeconds: endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)) : 0, topic: embedded?.topic ?? stringField('topic', review?.topic ?? '口语练习'), level: embedded?.level, source: embedded?.source, mode: embedded?.mode, correctionStrength: embedded?.correctionStrength ?? (field('correctionStrength') as CorrectionStrength) ?? 'normal', summary: review?.summary, estimatedCefr: review?.assessment?.estimatedCefr, favoriteWords: favorites, favoriteSentences, hasReview: Boolean(review), transcript, review, focus: embedded?.focus }
  }

  private upsertArchive(path: string): void {
    const detail = this.parseArchive(path); const fileName = basename(path); const existing = this.index.sessions.findIndex((item) => item.fileName === fileName || item.detail.id === detail.id)
    const searchText = normalizeTerm([detail.topic, detail.summary, detail.level, detail.source, detail.mode, ...detail.favoriteWords, ...(detail.favoriteSentences?.map((item) => item.text) ?? []), ...detail.transcript.map((item) => item.text), ...(detail.review?.issues.flatMap((item) => [item.original, item.improved, item.reason]) ?? [])].filter(Boolean).join(' '))
    const entry = { fileName, modifiedAt: statSync(path).mtimeMs, detail, searchText }; if (existing >= 0) this.index.sessions[existing] = entry; else this.index.sessions.push(entry)
    for (const word of detail.favoriteWords) this.upsertVocabulary(word, detail)
    this.rebuildSentences()
  }

  private upsertVocabulary(word: string, detail: SessionArchiveDetail): void {
    const normalizedTerm = normalizeTerm(word); if (!normalizedTerm) return
    let item = this.index.vocabulary.find((candidate) => candidate.normalizedTerm === normalizedTerm)
    const explanation = detail.review?.vocabulary.find((candidate) => normalizeTerm(candidate.term) === normalizedTerm)
    if (!item) { item = { id: randomUUID(), normalizedTerm, term: word, meaning: explanation?.meaning, example: explanation?.example, familiarity: 'unfamiliar', firstSavedAt: detail.startedAt, lastSavedAt: detail.startedAt, nextReviewAt: detail.startedAt, occurrenceCount: 0, sessionIds: [] }; this.index.vocabulary.push(item) }
    if (!item.sessionIds.includes(detail.id)) { item.sessionIds.push(detail.id); item.occurrenceCount += 1 }
    if (detail.startedAt < item.firstSavedAt) item.firstSavedAt = detail.startedAt
    if (detail.startedAt > item.lastSavedAt) item.lastSavedAt = detail.startedAt
    item.meaning ??= explanation?.meaning; item.example ??= explanation?.example
  }

  private reconcileArchives(): void {
    const files = readdirSync(this.dataDirectory).filter((file) => finalFilePattern.test(file)); const existing = new Set(files)
    this.index.sessions = this.index.sessions.filter((entry) => existing.has(entry.fileName))
    for (const file of files) { const path = join(this.dataDirectory, file); const indexed = this.index.sessions.find((entry) => entry.fileName === file); if (!indexed || indexed.modifiedAt !== statSync(path).mtimeMs) this.upsertArchive(path) }
    const ids = new Set(this.index.sessions.map((entry) => entry.detail.id)); for (const item of this.index.vocabulary) item.sessionIds = item.sessionIds.filter((id) => ids.has(id)); this.index.vocabulary = this.index.vocabulary.filter((item) => item.sessionIds.length)
    this.rebuildSentences()
    this.writeIndex()
  }

  private readIndex(): LearningIndex {
    for (const path of [this.indexPath, `${this.indexPath}.bak`]) if (existsSync(path)) { try { const value = JSON.parse(readFileSync(path, 'utf8')) as LearningIndex; if (value.version === 1 && Array.isArray(value.sessions) && Array.isArray(value.vocabulary)) return { ...value, sentences: Array.isArray(value.sentences) ? value.sentences : [] } } catch { /* rebuild below */ } }
    return { version: 1, sessions: [], vocabulary: [], sentences: [] }
  }

  private rebuildSentences(): void {
    this.index.sentences = this.index.sessions.flatMap(({ detail }) => (detail.favoriteSentences ?? []).map((item) => ({
      ...item,
      learningStatus: item.learningStatus ?? 'learning',
      id: `${detail.id}:${item.sourceMessageId}`,
      sessionId: detail.id,
      sessionStartedAt: detail.startedAt,
      source: detail.source,
      mode: detail.mode
    })))
  }

  private writeIndex(): void { this.atomicWrite(this.indexPath, JSON.stringify(this.index, null, 2), true) }
  private summary(detail: SessionArchiveDetail): SessionArchiveSummary { const { transcript: _transcript, review: _review, focus: _focus, ...summary } = detail; return summary }
  private atomicWrite(path: string, value: string, backup = false): void { const temporary = `${path}.tmp`; writeFileSync(temporary, value, 'utf8'); if (backup && existsSync(path)) copyFileSync(path, `${path}.bak`); renameSync(temporary, path) }
}
