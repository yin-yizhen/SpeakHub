import { describe, expect, it, vi } from 'vitest'
import { SessionCheckpoint } from './session-checkpoint'

describe('SessionCheckpoint', () => {
  it('flushes every five seconds and once more when stopped', () => {
    vi.useFakeTimers()
    try {
      const flush = vi.fn()
      const checkpoint = new SessionCheckpoint(flush)
      checkpoint.start()
      vi.advanceTimersByTime(5_000)
      expect(flush).toHaveBeenCalledTimes(1)
      checkpoint.stop(true)
      expect(flush).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(10_000)
      expect(flush).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })
})
