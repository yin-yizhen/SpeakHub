import { describe, expect, it } from 'vitest'
import { SequentialTaskQueue } from './sequential-task-queue'

describe('SequentialTaskQueue', () => {
  it('preserves TTS generation and playback enqueue order while tasks resolve asynchronously', async () => {
    const queue = new SequentialTaskQueue()
    const order: number[] = []
    queue.enqueue(async () => { await Promise.resolve(); order.push(0) })
    queue.enqueue(async () => { order.push(1) })
    queue.enqueue(async () => { await Promise.resolve(); order.push(2) })
    await queue.done()
    expect(order).toEqual([0, 1, 2])
  })
})
