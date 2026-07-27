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
    try { writeFileSync(path, '{bad', 'utf8'); expect(new SecureSettings(path).get()).toEqual({ llmBaseUrl: undefined, llmModel: undefined, hasLlmKey: false }) }
    finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('can explicitly clear the encrypted API key', () => {
    try { const settings = new SecureSettings(path); expect(settings.save({ llmApiKey: 'secret' }).hasLlmKey).toBe(true); expect(settings.save({ clearLlmApiKey: true }).hasLlmKey).toBe(false) }
    finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
