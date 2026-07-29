import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ProviderSettings, ProviderSettingsInput } from '../shared/types'

type ProviderSecrets = { llmApiKey?: string; aliyunAsrApiKey?: string; mimoTtsApiKey?: string }

type StoredSettings = Partial<Omit<ProviderSettings, 'hasLlmKey' | 'hasAliyunAsrKey' | 'hasMimoTtsKey'>> & {
  encrypted?: string
  realtimeEnabled?: boolean
  realtimeModel?: string
  realtimeProtocol?: 'current' | 'legacy'
}

export class SecureSettings {
  constructor(private readonly filePath: string) {}

  private read(): StoredSettings {
    if (!existsSync(this.filePath)) return {}
    try { return JSON.parse(readFileSync(this.filePath, 'utf8')) as StoredSettings }
    catch { return {} }
  }
  private write(value: StoredSettings): void { writeFileSync(this.filePath, JSON.stringify(value), 'utf8') }

  get(): ProviderSettings {
    const value = this.removeLegacyDictionarySecrets(this.read())
    const secrets = this.secrets(value)
    return {
      llmBaseUrl: value.llmBaseUrl,
      llmModel: value.llmModel,
      hasLlmKey: Boolean(secrets.llmApiKey),
      hasAliyunAsrKey: Boolean(secrets.aliyunAsrApiKey),
      ttsProvider: value.ttsProvider === 'kokoro' ? 'kokoro' : 'mimo',
      mimoTtsVoice: value.mimoTtsVoice || 'Mia',
      hasMimoTtsKey: Boolean(secrets.mimoTtsApiKey)
    }
  }

  getSecrets(): ProviderSecrets { return this.secrets(this.read()) }

  save(input: ProviderSettingsInput): ProviderSettings {
    const current = this.read()
    const previousSecrets = this.secrets(current)
    if (input.clearLlmApiKey) delete previousSecrets.llmApiKey
    if (input.clearAliyunAsrApiKey) delete previousSecrets.aliyunAsrApiKey
    if (input.clearMimoTtsApiKey) delete previousSecrets.mimoTtsApiKey
    const secrets = {
      ...previousSecrets,
      ...Object.fromEntries(Object.entries({
        llmApiKey: input.llmApiKey,
        aliyunAsrApiKey: input.aliyunAsrApiKey,
        mimoTtsApiKey: input.mimoTtsApiKey
      }).filter(([, value]) => value))
    }
    const encrypted = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(JSON.stringify(secrets)).toString('base64') : undefined
    this.write({
      llmBaseUrl: input.llmBaseUrl ?? current.llmBaseUrl,
      llmModel: input.llmModel ?? current.llmModel,
      ttsProvider: input.ttsProvider ?? current.ttsProvider,
      mimoTtsVoice: input.mimoTtsVoice ?? current.mimoTtsVoice,
      encrypted
    })
    return this.get()
  }

  clear(): void { this.write({}) }

  private secrets(value: StoredSettings): ProviderSecrets {
    if (!value.encrypted || !safeStorage.isEncryptionAvailable()) return {}
    try {
      const secrets = JSON.parse(safeStorage.decryptString(Buffer.from(value.encrypted, 'base64'))) as ProviderSecrets
      return { llmApiKey: secrets.llmApiKey, aliyunAsrApiKey: secrets.aliyunAsrApiKey, mimoTtsApiKey: secrets.mimoTtsApiKey }
    } catch { return {} }
  }

  private removeLegacyDictionarySecrets(value: StoredSettings): StoredSettings {
    if (!value.encrypted || !safeStorage.isEncryptionAvailable()) return value
    try {
      const raw = JSON.parse(safeStorage.decryptString(Buffer.from(value.encrypted, 'base64'))) as Record<string, unknown>
      const sanitized = {
        ...(typeof raw.llmApiKey === 'string' ? { llmApiKey: raw.llmApiKey } : {}),
        ...(typeof raw.aliyunAsrApiKey === 'string' ? { aliyunAsrApiKey: raw.aliyunAsrApiKey } : {}),
        ...(typeof raw.mimoTtsApiKey === 'string' ? { mimoTtsApiKey: raw.mimoTtsApiKey } : {})
      }
      const hasLegacySecrets = Object.keys(raw).some((key) => !['llmApiKey', 'aliyunAsrApiKey', 'mimoTtsApiKey'].includes(key))
      if (!hasLegacySecrets) return value
      const next = { ...value, encrypted: safeStorage.encryptString(JSON.stringify(sanitized)).toString('base64') }
      this.write(next)
      return next
    } catch {
      return value
    }
  }
}
