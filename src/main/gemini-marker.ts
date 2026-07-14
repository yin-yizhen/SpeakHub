import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

export interface GeminiConversationMarker { conversationUrl: string; createdAt: string }

export class GeminiMarkerStore {
  constructor(private readonly path: string) {}
  readAll(): GeminiConversationMarker[] {
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as { conversations?: unknown } | Partial<GeminiConversationMarker>
      const raw = Array.isArray((value as { conversations?: unknown }).conversations) ? (value as { conversations: unknown[] }).conversations : [value]
      const seen = new Set<string>()
      return raw.filter((item): item is GeminiConversationMarker => typeof item === 'object' && item !== null && typeof (item as Partial<GeminiConversationMarker>).conversationUrl === 'string' && /^https:\/\/gemini\.google\.com\/app\/[A-Za-z0-9_-]+/.test((item as GeminiConversationMarker).conversationUrl) && typeof (item as Partial<GeminiConversationMarker>).createdAt === 'string').filter((item) => !seen.has(item.conversationUrl) && Boolean(seen.add(item.conversationUrl)))
    } catch { return [] }
  }
  read(): GeminiConversationMarker | undefined { return this.readAll()[0] }
  write(conversationUrl: string): void { this.writeAll([...this.readAll().filter((item) => item.conversationUrl !== conversationUrl), { conversationUrl, createdAt: new Date().toISOString() }]) }
  remove(conversationUrl: string): void { this.writeAll(this.readAll().filter((item) => item.conversationUrl !== conversationUrl)) }
  clear(): void { if (existsSync(this.path)) rmSync(this.path, { force: true }) }
  clearIfMatches(conversationUrl: string): void { this.remove(conversationUrl) }
  private writeAll(conversations: GeminiConversationMarker[]): void { if (!conversations.length) this.clear(); else writeFileSync(this.path, JSON.stringify({ conversations }), 'utf8') }
}
