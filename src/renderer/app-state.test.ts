import { describe, expect, it } from 'vitest'
import { isPracticeTransitionBusy, mergeSavedStudyItem } from './app-state'

const item = { id: 'one', kind: 'word' as const, sourceText: 'practice', createdAt: 'now' }
describe('renderer practice state', () => {
  it('shows a newly saved item immediately without duplicating an existing one', () => {
    expect(mergeSavedStudyItem([], item)).toEqual([item])
    expect(mergeSavedStudyItem([item], item)).toEqual([item])
  })
  it('keeps start and end transitions busy', () => {
    expect(isPracticeTransitionBusy('starting')).toBe(true); expect(isPracticeTransitionBusy('ending')).toBe(true); expect(isPracticeTransitionBusy('active')).toBe(false)
  })
})
