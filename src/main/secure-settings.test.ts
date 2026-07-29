import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString('utf8') } }))
import { SecureSettings } from './secure-settings'

describe('SecureSettings', () => {
  let directory: string; let path: string
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'speaksub-provider-')); path = join(directory, 'provider.json') })
  it('recovers from corrupt JSON', () => {
    try { writeFileSync(path, '{bad', 'utf8'); expect(new SecureSettings(path).get()).toEqual({ llmBaseUrl: undefined, llmModel: undefined, hasLlmKey: false, hasAliyunAsrKey: false, ttsProvider: 'mimo', mimoTtsVoice: 'Mia', hasMimoTtsKey: false }) }
    finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('defaults legacy settings to MiMo without overriding an explicit Kokoro choice', () => {
    try {
      writeFileSync(path, JSON.stringify({ llmBaseUrl: 'https://api.example.com/v1' }), 'utf8')
      const settings = new SecureSettings(path)
      expect(settings.get().ttsProvider).toBe('mimo')
      expect(settings.save({ ttsProvider: 'kokoro' }).ttsProvider).toBe('kokoro')
      expect(settings.get().ttsProvider).toBe('kokoro')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('can explicitly clear the encrypted API key', () => {
    try { const settings = new SecureSettings(path); expect(settings.save({ llmApiKey: 'secret' }).hasLlmKey).toBe(true); expect(settings.save({ clearLlmApiKey: true }).hasLlmKey).toBe(false) }
    finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('stores the Aliyun speech key separately from the text API', () => {
    try {
      const settings = new SecureSettings(path)
      expect(settings.save({ aliyunAsrApiKey: 'dashscope-secret' })).toMatchObject({ hasAliyunAsrKey: true, hasLlmKey: false })
      expect(settings.getSecrets()).toEqual({ llmApiKey: undefined, aliyunAsrApiKey: 'dashscope-secret', mimoTtsApiKey: undefined })
      expect(settings.save({ clearAliyunAsrApiKey: true })).toMatchObject({ hasAliyunAsrKey: false })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('stores MiMo TTS preferences and its API key separately', () => {
    try {
      const settings = new SecureSettings(path)
      expect(settings.save({ ttsProvider: 'mimo', mimoTtsVoice: 'Milo', mimoTtsApiKey: 'mimo-secret' })).toMatchObject({
        ttsProvider: 'mimo',
        mimoTtsVoice: 'Milo',
        hasMimoTtsKey: true,
        hasAliyunAsrKey: false
      })
      expect(settings.getSecrets()).toEqual({ llmApiKey: undefined, aliyunAsrApiKey: undefined, mimoTtsApiKey: 'mimo-secret' })
      expect(settings.save({ clearMimoTtsApiKey: true })).toMatchObject({ hasMimoTtsKey: false, ttsProvider: 'mimo' })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
