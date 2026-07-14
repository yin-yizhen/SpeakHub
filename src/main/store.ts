import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PracticeSession, ReviewResult, SavedStudyItem, SessionArchiveItem, TranscriptEvent } from '../shared/types'

/** A human-readable local archive. No database engine is required for this prototype. */
export class SpeakSubStore {
  private readonly sessionsDirectory: string
  private readonly studyDirectory: string
  private readonly currentEvents = new Map<string, TranscriptEvent[]>()
  private readonly currentSessions = new Map<string, PracticeSession>()
  private readonly reviews = new Map<string, ReviewResult>()

  constructor(private readonly dataDirectory: string) {
    this.sessionsDirectory = join(dataDirectory, 'sessions')
    this.studyDirectory = join(dataDirectory, 'study')
    this.ensureDirectories()
  }

  createSession(strength: PracticeSession['correctionStrength']): PracticeSession {
    const session = { id: randomUUID(), startedAt: new Date().toISOString(), correctionStrength: strength }
    this.currentEvents.set(session.id, [])
    this.currentSessions.set(session.id, session)
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
    this.currentEvents.delete(sessionId); this.currentSessions.delete(sessionId); this.reviews.delete(sessionId)
    for (const extension of ['md', 'json']) rmSync(join(this.sessionsDirectory, `${sessionId}.${extension}`), { force: true })
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

  saveReview(sessionId: string, review: ReviewResult): void {
    this.reviews.set(sessionId, review)
    const session = this.currentSessions.get(sessionId) ?? this.readSessionHeader(sessionId)
    if (session) this.writeSession(session, review)
  }

  saveStudyItem(item: Omit<SavedStudyItem, 'id' | 'createdAt'>): SavedStudyItem {
    const duplicate = this.listStudyItems().find((current) => current.kind === item.kind && current.sourceText.trim().toLocaleLowerCase() === item.sourceText.trim().toLocaleLowerCase())
    if (duplicate) return duplicate
    const saved = { ...item, id: randomUUID(), createdAt: new Date().toISOString() }
    const note = (saved.note ?? '').replace(/\n/g, ' ')
    writeFileSync(join(this.studyDirectory, `${saved.id}.md`), `---\nid: ${saved.id}\nkind: ${saved.kind}\ncreatedAt: ${saved.createdAt}\nnote: ${note}\n---\n\n# ${saved.sourceText}\n`, 'utf8')
    return saved
  }

  deleteStudyItem(id: string): void {
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error('Invalid study item id.')
    rmSync(join(this.studyDirectory, `${id}.md`), { force: true })
  }

  listSessions(): SessionArchiveItem[] {
    const files = readdirSync(this.sessionsDirectory)
    const jsonItems = files.filter((file) => file.endsWith('.json')).flatMap((file) => {
      try {
        const item = JSON.parse(readFileSync(join(this.sessionsDirectory, file), 'utf8')) as SessionArchiveItem
        return item?.session?.id ? [item] : []
      } catch { return [] }
    })
    const known = new Set(jsonItems.map((item) => item.session.id))
    const legacyItems = files.filter((file) => file.endsWith('.md') && !known.has(file.slice(0, -3))).flatMap((file) => {
      const id = file.slice(0, -3); const session = this.readSessionHeader(id); if (!session) return []
      const text = readFileSync(join(this.sessionsDirectory, file), 'utf8'); const transcript: TranscriptEvent[] = []
      const pattern = /^### (AI|Me) · (.+)\r?\n\r?\n([\s\S]*?)(?=\r?\n\r?\n### |\r?\n\r?\n## Review|$)/gm
      for (const match of text.matchAll(pattern)) transcript.push({ id: `${id}-${transcript.length}`, sessionId: id, sourceMessageId: `legacy-${transcript.length}`, speaker: match[1] === 'AI' ? 'assistant' : 'user', receivedAt: match[2], text: match[3].trim(), status: 'complete' })
      return [{ session, transcript }]
    })
    return [...jsonItems, ...legacyItems].sort((a, b) => b.session.startedAt.localeCompare(a.session.startedAt))
  }

  listStudyItems(): SavedStudyItem[] {
    return readdirSync(this.studyDirectory).filter((file) => file.endsWith('.md')).map((file) => {
      const text = readFileSync(join(this.studyDirectory, file), 'utf8')
      const id = /^id: (.+)$/m.exec(text)?.[1] ?? file.replace('.md', '')
      const kind = (/^kind: (word|sentence)$/m.exec(text)?.[1] ?? 'word') as SavedStudyItem['kind']
      const createdAt = /^createdAt: (.+)$/m.exec(text)?.[1] ?? ''
      const note = /^note: (.*)$/m.exec(text)?.[1] || undefined
      const sourceText = /^# (.+)$/m.exec(text)?.[1] ?? ''
      return { id, kind, sourceText, note, createdAt }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  clear(): void {
    rmSync(this.sessionsDirectory, { recursive: true, force: true })
    rmSync(this.studyDirectory, { recursive: true, force: true })
    this.currentEvents.clear()
    this.currentSessions.clear(); this.reviews.clear()
    this.ensureDirectories()
  }

  private writeSession(session: PracticeSession, review?: ReviewResult): void {
    const events = this.eventsForSession(session.id)
    const transcript = events.length ? events.map((event) => `### ${event.speaker === 'assistant' ? 'AI' : 'Me'} · ${event.receivedAt}\n\n${event.text}`).join('\n\n') : '_No supported page text was captured._'
    const reviewSection = review ? `\n\n## Review\n\n**Topic:** ${review.topic}\n\n${review.summary}\n\n### Corrections\n\n${review.issues.map((issue) => `- ${issue.original} → ${issue.improved}: ${issue.reason}`).join('\n')}\n\n### Vocabulary\n\n${review.vocabulary.map((item) => `- ${item.term}: ${item.meaning}`).join('\n')}\n\n### Next practice\n\n${review.nextPractice}` : ''
    const markdown = `---\nid: ${session.id}\nstartedAt: ${session.startedAt}\nendedAt: ${session.endedAt ?? ''}\ncorrectionStrength: ${session.correctionStrength}\n---\n\n# Speaking practice\n\n## Transcript\n\n${transcript}${reviewSection}\n`
    this.atomicWrite(join(this.sessionsDirectory, `${session.id}.md`), markdown)
    this.atomicWrite(join(this.sessionsDirectory, `${session.id}.json`), JSON.stringify({ session, transcript: events, review } satisfies SessionArchiveItem))
  }

  private readSessionHeader(sessionId: string): PracticeSession | undefined {
    const path = join(this.sessionsDirectory, `${sessionId}.md`)
    if (!existsSync(path)) return undefined
    const text = readFileSync(path, 'utf8')
    const get = (key: string) => new RegExp(`^${key}: (.*)$`, 'm').exec(text)?.[1]
    const startedAt = get('startedAt'); const strength = get('correctionStrength') as PracticeSession['correctionStrength'] | undefined
    return startedAt && strength ? { id: sessionId, startedAt, endedAt: get('endedAt') || undefined, correctionStrength: strength } : undefined
  }

  private ensureDirectories(): void { mkdirSync(this.sessionsDirectory, { recursive: true }); mkdirSync(this.studyDirectory, { recursive: true }) }
  private atomicWrite(path: string, value: string): void { const temporary = `${path}.tmp`; writeFileSync(temporary, value, 'utf8'); renameSync(temporary, path) }
}
