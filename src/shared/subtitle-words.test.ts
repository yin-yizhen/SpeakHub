import { describe, expect, it } from 'vitest'
import { subtitleWordTokens } from './subtitle-words'

describe('subtitleWordTokens', () => {
  it('marks English words and contractions as clickable', () => {
    expect(subtitleWordTokens("Hello, don't stop speaker's turn.")).toEqual([
      { text: 'Hello', clickable: true },
      { text: ', ', clickable: false },
      { text: "don't", clickable: true },
      { text: ' ', clickable: false },
      { text: 'stop', clickable: true },
      { text: ' ', clickable: false },
      { text: "speaker's", clickable: true },
      { text: ' ', clickable: false },
      { text: 'turn', clickable: true },
      { text: '.', clickable: false }
    ])
  })

  it('keeps punctuation and Chinese text unclickable', () => {
    expect(subtitleWordTokens('这个 word，可以点吗？Yes!')).toEqual([
      { text: '这个 ', clickable: false },
      { text: 'word', clickable: true },
      { text: '，可以点吗？', clickable: false },
      { text: 'Yes', clickable: true },
      { text: '!', clickable: false }
    ])
  })

  it('keeps hyphenated terms and versioned product names together for lookup', () => {
    expect(subtitleWordTokens('Use well-known tools such as GPT-4.')).toEqual([
      { text: 'Use', clickable: true },
      { text: ' ', clickable: false },
      { text: 'well-known', clickable: true },
      { text: ' ', clickable: false },
      { text: 'tools', clickable: true },
      { text: ' ', clickable: false },
      { text: 'such', clickable: true },
      { text: ' ', clickable: false },
      { text: 'as', clickable: true },
      { text: ' ', clickable: false },
      { text: 'GPT-4', clickable: true },
      { text: '.', clickable: false }
    ])
  })
})
