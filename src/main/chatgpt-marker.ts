import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

export interface ChatGPTConversationMarker {
  conversationUrl: string
  createdAt: string
}

export class ChatGPTMarkerStore {
  constructor(private readonly path: string) {}

  read(): ChatGPTConversationMarker | undefined {
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<ChatGPTConversationMarker>
      return typeof value.conversationUrl === 'string' && /^https:\/\/chatgpt\.com\/c\//.test(value.conversationUrl) && typeof value.createdAt === 'string' ? value as ChatGPTConversationMarker : undefined
    } catch { return undefined }
  }

  write(conversationUrl: string): void { writeFileSync(this.path, JSON.stringify({ conversationUrl, createdAt: new Date().toISOString() }), 'utf8') }
  clear(): void { if (existsSync(this.path)) rmSync(this.path, { force: true }) }
}
