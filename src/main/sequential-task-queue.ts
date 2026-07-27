export class SequentialTaskQueue {
  private tail = Promise.resolve()

  enqueue(task: () => Promise<void>): void {
    this.tail = this.tail.then(task)
  }

  done(): Promise<void> { return this.tail }
}
