import { describe, expect, it } from 'vitest'
import { SpeechSegmenter } from './speech-segments'

describe('SpeechSegmenter', () => {
  it('splits mixed Chinese and English text at natural punctuation across deltas', () => {
    const segmenter = new SpeechSegmenter()
    expect(segmenter.push('你好，today is')).toEqual([])
    expect(segmenter.push(' sunny。How are')).toEqual(['你好，today is sunny。'])
    expect(segmenter.push(' you?继续')).toEqual(['How are you?'])
    expect(segmenter.flush()).toEqual(['继续'])
  })

  it('cuts very long unpunctuated text at the nearest comma or space', () => {
    const segmenter = new SpeechSegmenter()
    const prefix = `${'a'.repeat(80)},${'b'.repeat(50)}`
    expect(segmenter.push(prefix)).toEqual([`${'a'.repeat(80)},`])
    expect(segmenter.flush()).toEqual(['b'.repeat(50)])
  })
})
