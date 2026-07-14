import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

  it('migrates the legacy single-record JSON and appends unique conversation URLs', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'speaksub-marker-')), 'last-chat.json')
    writeFileSync(path, JSON.stringify({ conversationUrl: 'https://chatgpt.com/c/legacy', createdAt: 'then' }), 'utf8')
    const store = new ChatGPTMarkerStore(path)

    store.write('https://chatgpt.com/c/current')
    store.write('https://chatgpt.com/c/current')

    expect(store.readAll().map((item) => item.conversationUrl)).toEqual(['https://chatgpt.com/c/legacy', 'https://chatgpt.com/c/current'])
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ conversations: expect.any(Array) })
  })

  it('ignores a malformed or non-conversation marker', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'speaksub-marker-')), 'last-chat.json')
    writeFileSync(path, JSON.stringify({ conversationUrl: 'https://chatgpt.com/', createdAt: 'now' }), 'utf8')
    expect(new ChatGPTMarkerStore(path).read()).toBeUndefined()
  })

  it('does not clear a newer conversation while background cleanup finishes', () => {
    const store = new ChatGPTMarkerStore(join(mkdtempSync(join(tmpdir(), 'speaksub-marker-')), 'last-chat.json'))
    store.write('https://chatgpt.com/c/old-chat')
    store.write('https://chatgpt.com/c/new-chat')

    store.clearIfMatches('https://chatgpt.com/c/old-chat')
    expect(store.read()?.conversationUrl).toBe('https://chatgpt.com/c/new-chat')
  })
})
