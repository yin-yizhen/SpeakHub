export class SessionCheckpoint {
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly flush: () => void, private readonly intervalMs = 5_000) {}

  start(): void {
    this.stop()
    this.timer = setInterval(this.flush, this.intervalMs)
    this.timer.unref?.()
  }

  stop(flush = false): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (flush) this.flush()
  }
}
