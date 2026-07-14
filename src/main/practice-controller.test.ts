import { describe, expect, it, vi } from 'vitest'
import { PracticeController } from './practice-controller'
import type { PracticeEndResult, PracticeStartResult } from '../shared/types'

const startResult = (): PracticeStartResult => ({ session: { id: 's1', startedAt: 'now', correctionStrength: 'normal' }, source: 'api-direct', mode: 'text', voiceStarted: false })
const endResult = (): PracticeEndResult => ({ session: { ...startResult().session, endedAt: 'later' }, voiceStopped: true })

describe('PracticeController', () => {
  it('coalesces duplicate starts and ends', async () => {
    const controller = new PracticeController(); let active: PracticeStartResult | undefined
    const start = vi.fn(async () => { await Promise.resolve(); active = startResult(); return active })
    const first = controller.start(start, () => active); const second = controller.start(start, () => active)
    await expect(Promise.all([first, second])).resolves.toHaveLength(2); expect(start).toHaveBeenCalledOnce()
    const end = vi.fn(async () => { const result = endResult(); active = undefined; return result })
    const endFirst = controller.end(end, () => Boolean(active)); const endSecond = controller.end(end, () => Boolean(active))
    await expect(Promise.all([endFirst, endSecond])).resolves.toHaveLength(2); expect(end).toHaveBeenCalledOnce()
  })

  it('moves to error after a failed start and can be reset', async () => {
    const controller = new PracticeController()
    await expect(controller.start(async () => { throw new Error('boom') }, () => undefined)).rejects.toThrow('boom')
    expect(controller.lifecycle).toBe('error'); controller.reset(); expect(controller.lifecycle).toBe('idle')
  })

  it('waits for startup before ending', async () => {
    const controller = new PracticeController(); let active: PracticeStartResult | undefined; let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const starting = controller.start(async () => { await gate; active = startResult(); return active }, () => active)
    const ending = controller.end(async () => { active = undefined; return endResult() }, () => Boolean(active))
    release(); await starting; await expect(ending).resolves.toMatchObject({ voiceStopped: true }); expect(controller.lifecycle).toBe('idle')
  })
})
