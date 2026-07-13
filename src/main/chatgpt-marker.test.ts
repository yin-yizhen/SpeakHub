import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ChatGPTMarkerStore } from './chatgpt-marker'

describe('ChatGPT conversation marker', () => {
  it('only reads and clears a valid ChatGPT conversation marker', () => {
    const store = new ChatGPTMarkerStore(join(mkdtempSync(join(tmpdir(), 'speaksub-marker-')), 'last-chat.json'))
    store.write('https://chatgpt.com/c/abc-123')
    expect(store.read()?.conversationUrl).toBe('https://chatgpt.com/c/abc-123')
    store.clear()
    expect(store.read()).toBeUndefined()
  })

  it('ignores a malformed or non-conversation marker', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'speaksub-marker-')), 'last-chat.json')
    writeFileSync(path, JSON.stringify({ conversationUrl: 'https://chatgpt.com/', createdAt: 'now' }), 'utf8')
    expect(new ChatGPTMarkerStore(path).read()).toBeUndefined()
  })
})
