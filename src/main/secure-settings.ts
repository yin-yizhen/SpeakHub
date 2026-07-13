import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ProviderSettings, ProviderSettingsInput } from '../shared/types'

type StoredSettings = Omit<ProviderSettings, 'hasLlmKey'> & { encrypted?: string }

export class SecureSettings {
  constructor(private readonly filePath: string) {}

  private read(): StoredSettings { return existsSync(this.filePath) ? JSON.parse(readFileSync(this.filePath, 'utf8')) : {} }
  private write(value: StoredSettings): void { writeFileSync(this.filePath, JSON.stringify(value), 'utf8') }

  get(): ProviderSettings {
    const value = this.removeLegacyDictionarySecrets(this.read())
    const secrets = this.secrets(value)
    return { llmBaseUrl: value.llmBaseUrl, llmModel: value.llmModel, hasLlmKey: Boolean(secrets.llmApiKey) }
  }

  getSecrets(): { llmApiKey?: string } { return this.secrets(this.read()) }

  save(input: ProviderSettingsInput): ProviderSettings {
    const current = this.read()
    const secrets = { ...this.secrets(current), ...Object.fromEntries(Object.entries({ llmApiKey: input.llmApiKey }).filter(([, value]) => value)) }
    const encrypted = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(JSON.stringify(secrets)).toString('base64') : undefined
    this.write({ llmBaseUrl: input.llmBaseUrl ?? current.llmBaseUrl, llmModel: input.llmModel ?? current.llmModel, encrypted })
    return this.get()
  }

  clear(): void { this.write({}) }

  private secrets(value: StoredSettings): { llmApiKey?: string } {
    if (!value.encrypted || !safeStorage.isEncryptionAvailable()) return {}
    try {
      const secrets = JSON.parse(safeStorage.decryptString(Buffer.from(value.encrypted, 'base64'))) as { llmApiKey?: string }
      return { llmApiKey: secrets.llmApiKey }
    } catch { return {} }
  }

  private removeLegacyDictionarySecrets(value: StoredSettings): StoredSettings {
    if (!value.encrypted || !safeStorage.isEncryptionAvailable()) return value
    try {
      const raw = JSON.parse(safeStorage.decryptString(Buffer.from(value.encrypted, 'base64'))) as Record<string, unknown>
      const sanitized = typeof raw.llmApiKey === 'string' ? { llmApiKey: raw.llmApiKey } : {}
      const hasLegacySecrets = Object.keys(raw).some((key) => key !== 'llmApiKey')
      if (!hasLegacySecrets) return value
      const next = { ...value, encrypted: safeStorage.encryptString(JSON.stringify(sanitized)).toString('base64') }
      this.write(next)
      return next
    } catch {
      return value
    }
  }
}
