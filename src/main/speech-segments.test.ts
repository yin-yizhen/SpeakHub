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

  it('starts synthesis at a useful comma or newline without waiting for a full sentence', () => {
    const segmenter = new SpeechSegmenter()
    expect(segmenter.push('这是一个用于验证首段播放速度的回答，后面的字幕仍在生成')).toEqual(['这是一个用于验证首段播放速度的回答，'])
    expect(segmenter.push('First useful phrase\nNext line')).toEqual(['后面的字幕仍在生成First useful phrase'])
    expect(segmenter.flush()).toEqual(['Next line'])
  })

  it('uses a short first fallback and a longer steady-state fallback for unpunctuated text', () => {
    const segmenter = new SpeechSegmenter()
    expect(segmenter.push('a'.repeat(28))).toEqual(['a'.repeat(28)])
    expect(segmenter.push('b'.repeat(51))).toEqual([])
    expect(segmenter.push('b')).toEqual(['b'.repeat(52)])
    expect(segmenter.flush()).toEqual([])
  })

  it('prefers a nearby space when the first segment reaches its latency limit', () => {
    const segmenter = new SpeechSegmenter()
    expect(segmenter.push('This response should start speaking soon even while more text arrives')).toEqual(['This response should start'])
    expect(segmenter.flush()).toEqual(['speaking soon even while more text arrives'])
  })
})
