import type { PracticeLifecycle } from '../shared/types'

export function isPracticeTransitionBusy(lifecycle: PracticeLifecycle): boolean {
  return lifecycle === 'starting' || lifecycle === 'ending'
}
