import { describe, expect, it, vi } from 'vitest'
import { cleanRecordedConversations, type RecordedConversation } from './background-cleanup'

function createStore(records: RecordedConversation[]) {
  let current = [...records]
  return {
    readAll: () => [...current],
    remove: (conversationUrl: string) => { current = current.filter((item) => item.conversationUrl !== conversationUrl) }
  }
}

describe('recorded conversation cleanup', () => {
  it('deletes recorded conversations sequentially and verifies that none of that batch remain', async () => {
    const store = createStore([
      { conversationUrl: 'https://chatgpt.com/c/one', createdAt: 'one' },
      { conversationUrl: 'https://chatgpt.com/c/two', createdAt: 'two' }
    ])
    const deleteConversation = vi.fn().mockResolvedValue({ ok: true, message: 'deleted' })

    const summary = await cleanRecordedConversations(store, deleteConversation)

    expect(deleteConversation.mock.calls.map(([record]) => record.conversationUrl)).toEqual(['https://chatgpt.com/c/one', 'https://chatgpt.com/c/two'])
    expect(summary).toEqual({ attempted: 2, deleted: 2, failed: [], remainingRecordedUrls: [] })
    expect(store.readAll()).toEqual([])
  })

  it('keeps failed records for a later retry while removing successful records', async () => {
    const store = createStore([
      { conversationUrl: 'https://chatgpt.com/c/one', createdAt: 'one' },
      { conversationUrl: 'https://chatgpt.com/c/two', createdAt: 'two' }
    ])

    const summary = await cleanRecordedConversations(store, async (record) => record.conversationUrl.endsWith('/one') ? { ok: true, message: 'deleted' } : { ok: false, message: 'menu missing' })

    expect(summary.deleted).toBe(1)
    expect(summary.failed).toEqual([{ conversationUrl: 'https://chatgpt.com/c/two', message: 'menu missing' }])
    expect(summary.remainingRecordedUrls).toEqual(['https://chatgpt.com/c/two'])
    expect(store.readAll().map((item) => item.conversationUrl)).toEqual(['https://chatgpt.com/c/two'])
  })
})
