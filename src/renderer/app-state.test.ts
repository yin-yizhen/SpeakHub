import { describe, expect, it } from 'vitest'
import { isPracticeTransitionBusy } from './app-state'
describe('renderer practice state', () => {
  it('keeps start and end transitions busy', () => {
    expect(isPracticeTransitionBusy('starting')).toBe(true); expect(isPracticeTransitionBusy('ending')).toBe(true); expect(isPracticeTransitionBusy('active')).toBe(false)
  })
})
