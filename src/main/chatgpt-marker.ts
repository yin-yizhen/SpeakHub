import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

export interface ChatGPTConversationMarker {
  conversationUrl: string
  conversationTitle?: string
  createdAt: string
}

export class ChatGPTMarkerStore {
  constructor(private readonly path: string) {}

  readAll(): ChatGPTConversationMarker[] {
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as { conversations?: unknown } | Partial<ChatGPTConversationMarker>
      const raw = Array.isArray((value as { conversations?: unknown }).conversations) ? (value as { conversations: unknown[] }).conversations : [value]
      const seen = new Set<string>()
      return raw.filter((item): item is ChatGPTConversationMarker => typeof item === 'object' && item !== null && typeof (item as Partial<ChatGPTConversationMarker>).conversationUrl === 'string' && /^https:\/\/chatgpt\.com\/c\//.test((item as ChatGPTConversationMarker).conversationUrl) && typeof (item as Partial<ChatGPTConversationMarker>).createdAt === 'string').filter((item) => !seen.has(item.conversationUrl) && Boolean(seen.add(item.conversationUrl)))
    } catch { return [] }
  }

  read(): ChatGPTConversationMarker | undefined { return this.readAll()[0] }
  write(conversationUrl: string): void { this.writeAll([...this.readAll().filter((item) => item.conversationUrl !== conversationUrl), { conversationUrl, createdAt: new Date().toISOString() }]) }
  setTitle(conversationUrl: string, conversationTitle: string): void {
    const title = conversationTitle.trim()
    if (!title) return
    this.writeAll(this.readAll().map((item) => item.conversationUrl === conversationUrl ? { ...item, conversationTitle: title } : item))
  }
  remove(conversationUrl: string): void { this.writeAll(this.readAll().filter((item) => item.conversationUrl !== conversationUrl)) }
  clear(): void { if (existsSync(this.path)) rmSync(this.path, { force: true }) }
  clearIfMatches(conversationUrl: string): void { this.remove(conversationUrl) }

  private writeAll(conversations: ChatGPTConversationMarker[]): void { if (!conversations.length) this.clear(); else writeFileSync(this.path, JSON.stringify({ conversations }), 'utf8') }
}
