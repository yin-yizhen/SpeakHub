import { describe, expect, it, vi } from 'vitest'
import { SpeechSynthesisQueue } from './speech-synthesis-queue'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('SpeechSynthesisQueue', () => {
  it('streams before synthesis completes, prepares the next segment, and preserves audio order', async () => {
    const output: string[] = [], started: number[] = []
    const gates = [deferred(), deferred(), deferred()]
    const queue = new SpeechSynthesisQueue<string>(chunk => output.push(chunk), new AbortController().signal)
    gates.forEach((gate, index) => queue.enqueue(async emit => {
      started.push(index)
      emit(`${index}-a`)
      await gate.promise
      emit(`${index}-b`)
    }))
    await Promise.resolve()
    expect(started).toEqual([0, 1])
    expect(output).toEqual(['0-a'])
    gates[1].resolve()
    await Promise.resolve(); await Promise.resolve()
    expect(started).toEqual([0, 1])
    expect(output).toEqual(['0-a'])
    gates[0].resolve()
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]))
    gates[2].resolve()
    await queue.done()
    expect(output).toEqual(['0-a', '0-b', '1-a', '1-b', '2-a', '2-b'])
  })

  it('suppresses buffered and late audio and never starts queued requests after interruption', async () => {
    const controller = new AbortController()
    const output: number[] = []
    const gates = [deferred(), deferred()]
    const queue = new SpeechSynthesisQueue<number>(chunk => output.push(chunk), controller.signal)
    gates.forEach((gate, index) => queue.enqueue(async emit => { emit(index); await gate.promise; emit(index + 10) }))
    let thirdStarted = false
    queue.enqueue(async () => { thirdStarted = true })
    await Promise.resolve()
    expect(output).toEqual([0])
    controller.abort()
    gates.forEach(gate => gate.resolve())
    await queue.done()
    expect(output).toEqual([0])
    expect(thirdStarted).toBe(false)
  })

  it('reports prefetched failures and drops later audio without an unhandled rejection', async () => {
    const gate = deferred()
    const output: number[] = []
    const queue = new SpeechSynthesisQueue<number>(chunk => output.push(chunk), new AbortController().signal)
    queue.enqueue(async emit => { await gate.promise; emit(1) })
    queue.enqueue(async () => { throw new Error('synthesis failed') })
    await expect(queue.done()).rejects.toThrow('synthesis failed')
    gate.resolve()
    await Promise.resolve(); await Promise.resolve()
    expect(output).toEqual([])
  })
})
