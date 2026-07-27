import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnonymousAnalytics } from './analytics'

describe('AnonymousAnalytics', () => {
  afterEach(() => vi.useRealTimers())

  it('persists an anonymous installation ID, creates a new session, and sends only lifecycle fields', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-analytics-'))
    const sent: URL[] = []
    let number = 0
    try {
      const first = new AnonymousAnalytics({ userDataDirectory: directory, appVersion: '0.1.0', platform: 'win32', arch: 'x64', createId: () => `id-${++number}`, transport: async (url) => { sent.push(url) } })
      await first.start()
      const second = new AnonymousAnalytics({ userDataDirectory: directory, appVersion: '0.1.0', platform: 'win32', arch: 'x64', createId: () => `id-${++number}`, transport: async (url) => { sent.push(url) } })
      await second.start()

      expect(sent).toHaveLength(2)
      expect(sent[0].searchParams.get('distinct_id')).toBe('id-1')
      expect(sent[1].searchParams.get('distinct_id')).toBe('id-1')
      expect(sent[0].searchParams.get('session_id')).toBe('id-2')
      expect(sent[1].searchParams.get('session_id')).toBe('id-3')
      expect(sent[0].searchParams.get('is_first_launch')).toBe('true')
      expect(sent[1].searchParams.get('is_first_launch')).toBe('false')
      expect([...sent[0].searchParams.keys()].sort()).toEqual(['APIVersion', 'app_name', 'app_version', 'arch', 'distinct_id', 'event', 'is_first_launch', 'os', 'session_id'].sort())
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('sends heartbeats and a close duration without leaking network failures', async () => {
    vi.useFakeTimers()
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-analytics-'))
    const sent: URL[] = []
    let now = 1_000
    try {
      const analytics = new AnonymousAnalytics({ userDataDirectory: directory, appVersion: '0.1.0', platform: 'win32', arch: 'x64', now: () => now, createId: () => 'id', transport: async (url) => { sent.push(url) } })
      await analytics.start()
      now += 60_000
      await vi.advanceTimersByTimeAsync(60_000)
      now += 61_000
      await analytics.close()

      expect(sent.map((url) => url.searchParams.get('event'))).toEqual(['app_open', 'app_heartbeat', 'app_close'])
      expect(sent[2].searchParams.get('duration_seconds')).toBe('121')

      const failing = new AnonymousAnalytics({ userDataDirectory: directory, appVersion: '0.1.0', platform: 'win32', arch: 'x64', transport: async () => { throw new Error('offline') } })
      await expect(failing.start()).resolves.toBeUndefined()
      await expect(failing.close()).resolves.toBeUndefined()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
