import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import type { ConnectionState, SubtitlePreferences, WebPracticeSource } from '../shared/types'

const boundsSchema = z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(320).max(10000), height: z.number().int().min(100).max(10000) })
const subtitleSchema = z.object({
  mode: z.enum(['assistant', 'user', 'both']), layout: z.enum(['same-side', 'split']), background: z.enum(['transparent', 'glass', 'solid']),
  backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i), backgroundOpacity: z.number().min(0.1).max(1), assistantColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  userColor: z.string().regex(/^#[0-9a-f]{6}$/i), fontSize: z.number().int().min(18).max(38), opacity: z.number().min(0.55).max(1), locked: z.boolean(),
  visible: z.boolean(), maxLines: z.number().int().min(2).max(6), bounds: boundsSchema.optional()
})
const storedSchema = z.object({ providers: z.object({ 'chatgpt-web': z.boolean() }), subtitle: subtitleSchema.optional(), archiveDirectory: z.string().min(1).optional() })

export const defaultSubtitlePreferences: SubtitlePreferences = { mode: 'assistant', layout: 'split', background: 'glass', backgroundColor: '#0e1713', backgroundOpacity: 0.86, assistantColor: '#f1f6f3', userColor: '#fff1c9', fontSize: 25, opacity: 0.94, locked: false, visible: false, maxLines: 4 }

export class AppSettingsStore {
  constructor(private readonly path: string) {}
  readSubtitle(): SubtitlePreferences { return this.read().subtitle ?? defaultSubtitlePreferences }
  saveSubtitle(value: SubtitlePreferences): void { this.write({ ...this.read(), subtitle: subtitleSchema.parse(value) }) }
  providerReady(source: WebPracticeSource): boolean { return this.read().providers[source] }
  setProviderReady(source: WebPracticeSource, ready: boolean): void { const value = this.read(); value.providers[source] = ready; this.write(value) }
  connection(source: WebPracticeSource, pageVisible: boolean): ConnectionState { const providers = this.read().providers; return { ready: providers[source], providers, activeProvider: source, pageVisible } }
  archiveDirectory(fallback: string): string { return this.read().archiveDirectory ?? fallback }
  setArchiveDirectory(directory: string): void { this.write({ ...this.read(), archiveDirectory: z.string().min(1).parse(directory) }) }
  clear(): void { const archiveDirectory = this.read().archiveDirectory; this.write({ providers: { 'chatgpt-web': false }, subtitle: defaultSubtitlePreferences, archiveDirectory }) }

  private read(): z.infer<typeof storedSchema> {
    const fallback = { providers: { 'chatgpt-web': false } }
    if (!existsSync(this.path)) return fallback
    try { return storedSchema.parse(JSON.parse(readFileSync(this.path, 'utf8'))) }
    catch { return fallback }
  }
  private write(value: z.infer<typeof storedSchema>): void { const temporary = `${this.path}.tmp`; writeFileSync(temporary, JSON.stringify(value), 'utf8'); renameSync(temporary, this.path) }
}

export function parseSubtitleUpdate(current: SubtitlePreferences, input: unknown): SubtitlePreferences {
  return subtitleSchema.parse({ ...current, ...(typeof input === 'object' && input ? input : {}) })
}
