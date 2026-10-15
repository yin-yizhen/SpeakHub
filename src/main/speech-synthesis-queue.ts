type SpeechTask<T> = {
  run: (emit: (chunk: T) => void) => Promise<void>
  chunks: T[]
  started: boolean
  complete: boolean
}

// Prepare at most two adjacent segments. Stream the first immediately and hold
// the next segment until every chunk of the first has been delivered.
export class SpeechSynthesisQueue<T> {
  private tasks: SpeechTask<T>[] = []
  private failure?: Error
  private waiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = []

  constructor(private readonly deliver: (chunk: T) => void, private readonly signal: AbortSignal) {}

  enqueue(run: SpeechTask<T>['run']): void {
    if (this.failure || this.signal.aborted) return
    this.tasks.push({ run, chunks: [], started: false, complete: false })
    this.pump()
  }

  done(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure)
    if (!this.tasks.length) return Promise.resolve()
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
  }

  private pump(): void {
    for (const task of this.tasks.slice(0, 2)) {
      if (task.started) continue
      task.started = true
      void Promise.resolve().then(async () => {
        if (this.failure || this.signal.aborted) return
        await task.run((chunk) => {
          if (this.failure || this.signal.aborted) return
          if (this.tasks[0] === task) this.deliver(chunk)
          else task.chunks.push(chunk)
        })
      }).then(() => {
        task.complete = true
        this.flush()
      }).catch((error: unknown) => {
        this.failure = error instanceof Error ? error : new Error(String(error))
        this.tasks = []
        for (const waiter of this.waiters.splice(0)) waiter.reject(this.failure)
      })
    }
  }

  private flush(): void {
    while (this.tasks.length) {
      const task = this.tasks[0]
      if (!this.signal.aborted && !this.failure) for (const chunk of task.chunks.splice(0)) this.deliver(chunk)
      if (!task.complete) break
      this.tasks.shift()
    }
    if (!this.tasks.length) for (const waiter of this.waiters.splice(0)) waiter.resolve()
    else this.pump()
  }
}
