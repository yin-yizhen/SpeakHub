import type { PracticeEndResult, PracticeLifecycle, PracticeStartResult } from '../shared/types'

export class PracticeController {
  private startPromise?: Promise<PracticeStartResult>
  private endPromise?: Promise<PracticeEndResult>
  private _lifecycle: PracticeLifecycle = 'idle'

  get lifecycle(): PracticeLifecycle { return this._lifecycle }

  start(operation: () => Promise<PracticeStartResult>, active: () => PracticeStartResult | undefined): Promise<PracticeStartResult> {
    const current = active()
    if (current) return Promise.resolve(current)
    if (this.startPromise) return this.startPromise
    if (this.endPromise) return Promise.reject(new Error('The previous practice is still ending.'))
    this._lifecycle = 'starting'
    this.startPromise = operation().then((result) => {
      this._lifecycle = 'active'
      return result
    }).catch((error) => {
      this._lifecycle = 'error'
      throw error
    }).finally(() => { this.startPromise = undefined })
    return this.startPromise
  }

  end(operation: () => Promise<PracticeEndResult>, hasActive: () => boolean): Promise<PracticeEndResult> {
    if (this.endPromise) return this.endPromise
    if (this.startPromise) {
      this._lifecycle = 'ending'
      this.endPromise = this.startPromise.then(() => {
        if (!hasActive()) throw new Error('Practice startup did not produce an active session.')
        return operation()
      }).then((result) => { this._lifecycle = 'idle'; return result }).catch((error) => { this._lifecycle = hasActive() ? 'error' : 'idle'; throw error }).finally(() => { this.endPromise = undefined })
      return this.endPromise
    }
    if (!hasActive()) return Promise.reject(new Error('There is no active practice.'))
    this._lifecycle = 'ending'
    this.endPromise = operation().then((result) => {
      this._lifecycle = 'idle'
      return result
    }).catch((error) => {
      this._lifecycle = hasActive() ? 'error' : 'idle'
      throw error
    }).finally(() => { this.endPromise = undefined })
    return this.endPromise
  }

  reset(): void { this._lifecycle = 'idle'; this.startPromise = undefined; this.endPromise = undefined }
}
