import { describe, expect, it, vi } from 'vitest'
import { InterruptibleTaskHandoff } from './interruptible-task-handoff'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  return { promise: new Promise<void>((done) => { resolve = done }), resolve }
}

describe('InterruptibleTaskHandoff', () => {
  it('interrupts and settles the current task before starting its replacement', async () => {
    const handoff = new InterruptibleTaskHandoff()
    const first = deferred()
    const second = deferred()
    const interruptFirst = vi.fn()
    const startSecond = vi.fn(() => ({ promise: second.promise, interrupt: vi.fn() }))

    const firstResult = handoff.replace(() => ({ promise: first.promise, interrupt: interruptFirst }))
    await Promise.resolve()
    await Promise.resolve()
    const secondResult = handoff.replace(startSecond)

    await vi.waitFor(() => expect(interruptFirst).toHaveBeenCalledOnce())
    expect(startSecond).not.toHaveBeenCalled()

    first.resolve()
    await firstResult
    await vi.waitFor(() => expect(startSecond).toHaveBeenCalledOnce())

    second.resolve()
    await secondResult
  })

  it('interrupts the newest task when practice shutdown overlaps a replacement', async () => {
    const handoff = new InterruptibleTaskHandoff()
    const first = deferred()
    const second = deferred()
    const interruptFirst = vi.fn(() => first.resolve())
    const interruptSecond = vi.fn(() => second.resolve())

    void handoff.replace(() => ({ promise: first.promise, interrupt: interruptFirst }))
    await Promise.resolve()
    void handoff.replace(() => ({ promise: second.promise, interrupt: interruptSecond }))

    await handoff.interruptAndSettle()
    expect(interruptFirst).toHaveBeenCalled()
    expect(interruptSecond).toHaveBeenCalled()
  })
})
