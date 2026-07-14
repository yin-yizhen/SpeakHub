import type { PracticeLifecycle, SavedStudyItem } from '../shared/types'

export function mergeSavedStudyItem(current: SavedStudyItem[], saved: SavedStudyItem): SavedStudyItem[] {
  return current.some((item) => item.id === saved.id) ? current : [saved, ...current]
}

export function isPracticeTransitionBusy(lifecycle: PracticeLifecycle): boolean {
  return lifecycle === 'starting' || lifecycle === 'ending'
}
