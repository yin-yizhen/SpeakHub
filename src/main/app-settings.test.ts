import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppSettingsStore, defaultSubtitlePreferences, parseSubtitleUpdate } from './app-settings'

describe('AppSettingsStore', () => {
  it('recovers from corrupt data and persists ChatGPT readiness', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-settings-')); const path = join(directory, 'app.json')
    try {
      writeFileSync(path, '{broken', 'utf8'); const store = new AppSettingsStore(path)
      expect(store.providerReady('chatgpt-web')).toBe(false)
      store.setProviderReady('chatgpt-web', true)
      expect(store.connection('chatgpt-web', true)).toMatchObject({ ready: true, providers: { 'chatgpt-web': true } })
      expect(store.archiveDirectory('D:/default')).toBe('D:/default')
      store.setArchiveDirectory('D:/SpeakSub archive')
      expect(store.archiveDirectory('D:/default')).toBe('D:/SpeakSub archive')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('rejects subtitle values outside the UI boundary', () => {
    expect(() => parseSubtitleUpdate(defaultSubtitlePreferences, { fontSize: 200 })).toThrow()
  })
})
