export interface RecordedConversation {
  conversationUrl: string
  conversationTitle?: string
  createdAt: string
}

export interface ConversationRecordStore {
  readAll(): RecordedConversation[]
  remove(conversationUrl: string): void
}

export interface ConversationDeletionResult {
  ok: boolean
  message: string
}

export interface CleanupSummary {
  attempted: number
  deleted: number
  failed: Array<{ conversationUrl: string; message: string }>
  remainingRecordedUrls: string[]
}

export async function cleanRecordedConversations(
  store: ConversationRecordStore,
  deleteConversation: (conversation: RecordedConversation) => Promise<ConversationDeletionResult>
): Promise<CleanupSummary> {
  const targets = store.readAll()
  const failed: CleanupSummary['failed'] = []
  let deleted = 0

  for (const target of targets) {
    try {
      const result = await deleteConversation(target)
      if (result.ok) {
        store.remove(target.conversationUrl)
        deleted += 1
      } else {
        failed.push({ conversationUrl: target.conversationUrl, message: result.message })
      }
    } catch (error) {
      failed.push({ conversationUrl: target.conversationUrl, message: error instanceof Error ? error.message : 'Background cleanup failed.' })
    }
  }

  const remaining = new Set(store.readAll().map((item) => item.conversationUrl))
  return { attempted: targets.length, deleted, failed, remainingRecordedUrls: targets.map((item) => item.conversationUrl).filter((url) => remaining.has(url)) }
}
