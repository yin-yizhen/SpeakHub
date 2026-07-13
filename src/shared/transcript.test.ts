import { describe, expect, it } from 'vitest'
import { mergeTranscriptEvent, subtitleEvents, visualLineCount } from './transcript'
import type { TranscriptEvent } from './types'

const event = (id: string, text: string, speaker: TranscriptEvent['speaker'] = 'assistant'): TranscriptEvent => ({
  id, sessionId: 'session-1', sourceMessageId: id, speaker, text, status: 'complete', receivedAt: '2026-01-01T00:00:00.000Z'
})

describe('transcript reducer', () => {
  it('merges streaming updates by source message id', () => {
    const first = event('m1', 'Hello')
    const updated = { ...first, text: 'Hello there', status: 'streaming' as const }
    expect(mergeTranscriptEvent([first], updated)).toEqual([{ ...updated, id: 'm1' }])
  })

  it('filters speaker and respects the visual line cap', () => {
    const events = [event('a', 'One'), event('b', 'Me', 'user'), event('c', 'Two')]
    expect(subtitleEvents(events, 'assistant', 4).map((item) => item.id)).toEqual(['a', 'c'])
    expect(subtitleEvents(events, 'both', 1).map((item) => item.id)).toEqual(['c'])
  })

  it('drops the oldest visible subtitle when a new line arrives', () => {
    const events = [event('a', 'First'), event('b', 'Second'), event('c', 'Third'), event('d', 'Fourth')]
    expect(subtitleEvents(events, 'both', 3).map((item) => item.id)).toEqual(['b', 'c', 'd'])
  })

  it('counts wrapped text as subtitle lines instead of conversation turns', () => {
    expect(visualLineCount('1234567890', 5)).toBe(2)
    expect(subtitleEvents([event('a', '1234567890'), event('b', 'New')], 'both', 3, 5).map((item) => item.id)).toEqual(['a', 'b'])
  })
})
