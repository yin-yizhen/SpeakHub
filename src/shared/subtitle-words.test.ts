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
})
