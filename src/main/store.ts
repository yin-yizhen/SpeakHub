import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PracticeSession, ReviewResult, TranscriptEvent } from '../shared/types'

/** Writes the active practice to one recoverable Markdown file, without a database or sidecar index. */
export class SpeakSubStore {
  private readonly currentPath: string
  private readonly currentEvents = new Map<string, TranscriptEvent[]>()
  private readonly currentSessions = new Map<string, PracticeSession>()
  private readonly currentFavorites = new Map<string, string[]>()
  private readonly reviews = new Map<string, ReviewResult>()

  constructor(private readonly dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true })
    this.currentPath = join(dataDirectory, 'current-practice.md')
  }

  createSession(strength: PracticeSession['correctionStrength']): PracticeSession {
    this.archiveInterruptedPractice()
    const session = { id: randomUUID(), startedAt: new Date().toISOString(), correctionStrength: strength }
    this.currentEvents.set(session.id, [])
    this.currentSessions.set(session.id, session)
    this.currentFavorites.set(session.id, [])
    this.writeSession(session)
    return session
  }

  endSession(session: PracticeSession): PracticeSession {
    const ended = { ...session, endedAt: new Date().toISOString() }
    this.currentSessions.set(session.id, ended)
    this.writeSession(ended)
    return ended
  }

  abortSession(sessionId: string): void {
    this.currentEvents.delete(sessionId); this.currentSessions.delete(sessionId); this.currentFavorites.delete(sessionId); this.reviews.delete(sessionId)
    rmSync(this.currentPath, { force: true })
  }

  upsertEvent(event: TranscriptEvent): void {
    const current = this.currentEvents.get(event.sessionId) ?? []
    const index = current.findIndex((item) => item.sourceMessageId === event.sourceMessageId)
    if (index === -1) current.push(event); else current[index] = { ...current[index], ...event, id: current[index].id }
    this.currentEvents.set(event.sessionId, current)
    const session = this.currentSessions.get(event.sessionId)
    if (session) this.writeSession(session, this.reviews.get(event.sessionId))
  }

  eventsForSession(sessionId: string): TranscriptEvent[] { return this.currentEvents.get(sessionId) ?? [] }
  favoriteWordsForSession(sessionId: string): string[] { return this.currentFavorites.get(sessionId) ?? [] }

  saveFavorite(sessionId: string, word: string): void {
    const session = this.currentSessions.get(sessionId)
    if (!session) throw new Error('Start a practice before saving a word.')
    const favorites = this.currentFavorites.get(sessionId) ?? []
    if (!favorites.some((current) => current.toLocaleLowerCase() === word.toLocaleLowerCase())) favorites.push(word)
    this.currentFavorites.set(sessionId, favorites)
    this.writeSession(session, this.reviews.get(sessionId))
  }

  flushSession(sessionId: string): void {
    const session = this.currentSessions.get(sessionId)
    if (session) this.writeSession(session, this.reviews.get(sessionId))
  }

  readSessionMarkdown(sessionId: string): string {
    if (!this.currentSessions.has(sessionId) || !existsSync(this.currentPath)) throw new Error('The active practice file is unavailable.')
    return readFileSync(this.currentPath, 'utf8')
  }

  saveReview(sessionId: string, review: ReviewResult): void {
    this.reviews.set(sessionId, review)
    const session = this.currentSessions.get(sessionId)
    if (session) this.writeSession(session, review)
  }

  finalizeSession(sessionId: string): string | undefined {
    const session = this.currentSessions.get(sessionId)
    if (!session || !existsSync(this.currentPath)) return undefined
    const stamp = (session.endedAt ?? session.startedAt).replace(/[:.]/g, '-')
    const destination = join(this.dataDirectory, `speaksub-practice-${stamp}.md`)
    renameSync(this.currentPath, destination)
    this.currentEvents.delete(sessionId); this.currentSessions.delete(sessionId); this.currentFavorites.delete(sessionId); this.reviews.delete(sessionId)
    return destination
  }

  clear(): void {
    for (const file of readdirSync(this.dataDirectory)) {
      if (file === 'current-practice.md' || /^speaksub-(practice|interrupted)-.+\.md$/.test(file)) rmSync(join(this.dataDirectory, file), { force: true })
    }
    this.currentEvents.clear(); this.currentSessions.clear(); this.currentFavorites.clear(); this.reviews.clear()
  }

  private archiveInterruptedPractice(): void {
    if (!existsSync(this.currentPath)) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    renameSync(this.currentPath, join(this.dataDirectory, `speaksub-interrupted-${stamp}.md`))
  }

  private writeSession(session: PracticeSession, review?: ReviewResult): void {
    const events = this.eventsForSession(session.id)
    const favorites = this.favoriteWordsForSession(session.id)
    const transcript = events.length ? events.map((event) => `### ${event.speaker === 'assistant' ? 'AI' : 'Me'} at ${event.receivedAt}\n\n${event.text}`).join('\n\n') : '_No supported page text was captured._'
    const favoritesSection = favorites.length ? `\n\n## Saved vocabulary\n\n${favorites.map((word) => `- ${word}`).join('\n')}` : ''
    const reviewSection = review ? `\n\n## Review\n\n**Topic:** ${review.topic}\n\n${review.summary}\n\n### Corrections\n\n${review.issues.map((issue) => `- ${issue.original} -> ${issue.improved}: ${issue.reason}`).join('\n')}\n\n### Vocabulary\n\n${review.vocabulary.map((item) => `- ${item.term}: ${item.meaning}${item.example ? `\n  - Example: ${item.example}` : ''}`).join('\n')}\n\n### Next practice\n\n${review.nextPractice}` : ''
    const markdown = `---\nid: ${session.id}\nstartedAt: ${session.startedAt}\nendedAt: ${session.endedAt ?? ''}\ncorrectionStrength: ${session.correctionStrength}\n---\n\n# Speaking practice\n\n## Transcript\n\n${transcript}${favoritesSection}${reviewSection}\n`
    this.atomicWrite(this.currentPath, markdown)
  }

  private atomicWrite(path: string, value: string): void { const temporary = `${path}.tmp`; writeFileSync(temporary, value, 'utf8'); renameSync(temporary, path) }
}
