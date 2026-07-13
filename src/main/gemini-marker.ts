import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

export interface GeminiConversationMarker { conversationUrl: string; createdAt: string }

export class GeminiMarkerStore {
  constructor(private readonly path: string) {}
  read(): GeminiConversationMarker | undefined {
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<GeminiConversationMarker>
      return typeof value.conversationUrl === 'string' && /^https:\/\/gemini\.google\.com\/app\/[A-Za-z0-9_-]+/.test(value.conversationUrl) && typeof value.createdAt === 'string' ? value as GeminiConversationMarker : undefined
    } catch { return undefined }
  }
  write(conversationUrl: string): void { writeFileSync(this.path, JSON.stringify({ conversationUrl, createdAt: new Date().toISOString() }), 'utf8') }
  clear(): void { if (existsSync(this.path)) rmSync(this.path, { force: true }) }
}
