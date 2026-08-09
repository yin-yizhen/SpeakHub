export interface InterruptibleTask {
  promise: Promise<void>
  interrupt: () => void
}

export type InterruptibleTaskStarter = () => InterruptibleTask | Promise<InterruptibleTask>

/**
 * Replaces a long-running task without allowing replacement handoffs to race.
 * The caller receives the lifetime of its own task, while later callers can
 * interrupt it immediately and wait for its cleanup before starting.
 */
export class InterruptibleTaskHandoff {
  private handoff: Promise<void> = Promise.resolve()
  private current: InterruptibleTask | undefined

  replace(start: InterruptibleTaskStarter): Promise<void> {
    let resolveResult!: () => void
    let rejectResult!: (reason?: unknown) => void
    const result = new Promise<void>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })

    const begin = this.handoff.then(async () => {
      const previous = this.current
      if (previous) {
        previous.interrupt()
        await previous.promise.catch(() => undefined)
        if (this.current === previous) this.current = undefined
      }

      const next = await start()
      this.current = next
      void next.promise.then(resolveResult, rejectResult).finally(() => {
        if (this.current === next) this.current = undefined
      })
    })

    this.handoff = begin.catch(() => undefined)
    void begin.catch(rejectResult)
    return result
  }

  async interruptAndSettle(): Promise<void> {
    const first = this.current
    first?.interrupt()
    await this.handoff
    const latest = this.current
    if (latest && latest !== first) latest.interrupt()
    await latest?.promise.catch(() => undefined)
  }
}
