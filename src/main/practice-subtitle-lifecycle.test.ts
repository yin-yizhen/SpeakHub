import { describe, expect, it, vi } from 'vitest'
import { endPracticeWithSubtitles, startPracticeWithSubtitles } from './practice-subtitle-lifecycle'

describe('practice subtitle lifecycle', () => {
  it('shows subtitles only after practice startup succeeds', async () => {
    const order: string[] = []

    const result = await startPracticeWithSubtitles(async () => {
      order.push('started')
      return 'session'
    }, () => { order.push('shown') })

    expect(result).toBe('session')
    expect(order).toEqual(['started', 'shown'])
  })

  it('does not show subtitles when practice startup fails', async () => {
    const showSubtitles = vi.fn()

    await expect(startPracticeWithSubtitles(async () => {
      throw new Error('startup failed')
    }, showSubtitles)).rejects.toThrow('startup failed')

    expect(showSubtitles).not.toHaveBeenCalled()
  })

  it('hides subtitles before the review starts', async () => {
    const order: string[] = []

    await endPracticeWithSubtitles(async () => { order.push('review'); return 'reviewed' }, () => { order.push('hidden') })

    expect(order).toEqual(['hidden', 'review'])
  })

  it('does not let a subtitle window error block the practice lifecycle', async () => {
    const visibilityError = new Error('window unavailable')
    const onVisibilityError = vi.fn()

    await expect(startPracticeWithSubtitles(async () => 'session', () => { throw visibilityError }, onVisibilityError)).resolves.toBe('session')
    await expect(endPracticeWithSubtitles(async () => 'reviewed', () => { throw visibilityError }, onVisibilityError)).resolves.toBe('reviewed')

    expect(onVisibilityError).toHaveBeenCalledTimes(2)
    expect(onVisibilityError).toHaveBeenNthCalledWith(1, visibilityError)
    expect(onVisibilityError).toHaveBeenNthCalledWith(2, visibilityError)
  })
})
