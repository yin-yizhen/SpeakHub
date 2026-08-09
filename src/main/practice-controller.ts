import type { PracticeEndResult, PracticeLifecycle, PracticeStartResult } from '../shared/types'

export class PracticeController {
  private startPromise?: Promise<PracticeStartResult>
  private startController?: AbortController
  private endPromise?: Promise<PracticeEndResult>
  private _lifecycle: PracticeLifecycle = 'idle'

  get lifecycle(): PracticeLifecycle { return this._lifecycle }

  start(operation: (signal: AbortSignal) => Promise<PracticeStartResult>, active: () => PracticeStartResult | undefined): Promise<PracticeStartResult> {
    const current = active()
    if (current) return Promise.resolve(current)
    if (this.startPromise) return this.startPromise
    if (this.endPromise) return Promise.reject(new Error('The previous practice is still ending.'))
    this._lifecycle = 'starting'
    const controller = new AbortController()
    this.startController = controller
    const cancelled = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Practice startup was cancelled.')), { once: true }))
    const operationPromise = operation(controller.signal)
    let startPromise: Promise<PracticeStartResult>
    startPromise = Promise.race([operationPromise, cancelled]).then((result) => {
      this._lifecycle = 'active'
      return result
    }).catch((error) => {
      this._lifecycle = controller.signal.aborted ? 'idle' : 'error'
      throw error
    }).finally(() => {
      if (this.startPromise === startPromise) this.startPromise = undefined
      if (this.startController === controller) this.startController = undefined
    })
    this.startPromise = startPromise
    return startPromise
  }

  cancelStart(): boolean {
    if (!this.startController || this.startController.signal.aborted) return false
    this.startController.abort()
    return true
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

  reset(): void { this.startController?.abort(); this.startController = undefined; this._lifecycle = 'idle'; this.startPromise = undefined; this.endPromise = undefined }
}
