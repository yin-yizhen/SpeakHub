import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpeakSubStore } from './store'

describe('Markdown learning archive', () => {
  it('writes a readable session and independent study document', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-'))
    try {
      const store = new SpeakSubStore(directory)
      const session = store.createSession('normal')
      store.upsertEvent({ id: 'event-1', sessionId: session.id, sourceMessageId: 'source-1', speaker: 'assistant', text: 'That makes sense.', status: 'complete', receivedAt: '2026-01-01T00:00:00.000Z' })
      expect(readFileSync(join(directory, 'sessions', `${session.id}.md`), 'utf8')).toContain('That makes sense.')
      store.endSession(session)
      const saved = store.saveStudyItem({ kind: 'sentence', sourceText: 'That makes sense.', note: '有道理' })
      expect(store.saveStudyItem({ kind: 'sentence', sourceText: 'that makes sense.', note: 'duplicate' }).id).toBe(saved.id)
      expect(readFileSync(join(directory, 'sessions', `${session.id}.md`), 'utf8')).toContain('That makes sense.')
      expect(readFileSync(join(directory, 'study', `${saved.id}.md`), 'utf8')).toContain('# That makes sense.')
      expect(store.listStudyItems()).toHaveLength(1)
      expect(store.listSessions()[0].transcript).toHaveLength(1)
      store.deleteStudyItem(saved.id); expect(store.listStudyItems()).toHaveLength(0)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
