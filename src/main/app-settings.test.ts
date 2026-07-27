import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppSettingsStore, defaultPracticePreferences, defaultPromptTemplates, defaultSubtitlePreferences, parseSubtitleUpdate } from './app-settings'

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
      expect(store.microphoneShortcut()).toBe('F8')
      store.setMicrophoneShortcut('Ctrl+Shift+M')
      expect(store.microphoneShortcut()).toBe('Ctrl+Shift+M')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('rejects subtitle values outside the UI boundary', () => {
    expect(() => parseSubtitleUpdate(defaultSubtitlePreferences, { fontSize: 200 })).toThrow()
  })
  it('provides independent scenario, difficulty, and text-only correction defaults', () => {
    expect(defaultPromptTemplates.scenario).toHaveLength(7)
    expect(defaultPromptTemplates.difficulty.map((item) => item.name)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1'])
    expect(defaultPromptTemplates.correction.map((item) => item.name)).toEqual(['轻度', '普通', '严格'])
    expect(defaultPromptTemplates.correction.every((item) => item.prompt.includes('不评价或纠正发音'))).toBe(true)
    expect(defaultPromptTemplates.correction.find((item) => item.id === 'normal')?.prompt).toContain('先用简短提示引导我自我修正')
  })
  it('persists validated practice preferences and clears them with the rest of the app data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-settings-')); const path = join(directory, 'app.json')
    try {
      const store = new AppSettingsStore(path)
      expect(store.practicePreferences()).toEqual(defaultPracticePreferences)
      const preferences = { source: 'api-direct' as const, mode: 'text' as const, scenarioTemplateId: 'travel', difficultyTemplateId: 'b1', correctionTemplateId: 'strict', focus: '重点练习过去时。', focusEnabled: true }
      expect(store.setPracticePreferences(preferences)).toEqual(preferences)
      expect(new AppSettingsStore(path).practicePreferences()).toEqual(preferences)
      expect(() => store.setPracticePreferences({ ...preferences, mode: 'video' } as never)).toThrow()
      store.clear()
      expect(store.practicePreferences()).toEqual(defaultPracticePreferences)
      expect(store.promptTemplates()).toHaveProperty('scenario')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('persists monthly cloud speech usage as integer seconds', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-settings-')); const path = join(directory, 'app.json')
    try {
      const store = new AppSettingsStore(path)
      expect(store.speechUsageSeconds('2026-07')).toBe(0)
      expect(store.addSpeechUsageSeconds('2026-07', 4)).toBe(4)
      expect(store.addSpeechUsageSeconds('2026-07', 3)).toBe(7)
      expect(new AppSettingsStore(path).speechUsageSeconds('2026-07')).toBe(7)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
