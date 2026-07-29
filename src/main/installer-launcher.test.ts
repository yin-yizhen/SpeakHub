import { describe, expect, it, vi } from 'vitest'
import { launchInstallerAndQuit, type SpawnedInstaller } from './installer-launcher'

class FakeInstaller implements SpawnedInstaller {
  readonly unref = vi.fn()
  private readonly listeners = new Map<'spawn' | 'error', Array<(...args: unknown[]) => void>>()

  once(event: 'spawn' | 'error', listener: (() => void) | ((error: Error) => void)): unknown {
    const registered = this.listeners.get(event) ?? []
    registered.push(listener as (...args: unknown[]) => void)
    this.listeners.set(event, registered)
    return this
  }

  emitSpawn(): void { for (const listener of this.listeners.get('spawn') ?? []) listener() }
  emitError(error: Error): void { for (const listener of this.listeners.get('error') ?? []) listener(error) }
}

describe('installer launcher', () => {
  it('starts the installer independently before scheduling application exit', async () => {
    const installer = new FakeInstaller()
    const quit = vi.fn()
    let scheduled: (() => void) | undefined
    const launch = launchInstallerAndQuit('C:\\updates\\SpeakHub-0.1.8-Setup.exe', {
      quit,
      spawnInstaller: vi.fn(() => installer),
      schedule: (callback) => { scheduled = callback }
    })

    installer.emitSpawn()

    await expect(launch).resolves.toBe('')
    expect(installer.unref).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()
    scheduled?.()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('keeps the application open when launching the installer fails', async () => {
    const installer = new FakeInstaller()
    const quit = vi.fn()
    const launch = launchInstallerAndQuit('C:\\updates\\SpeakHub-0.1.8-Setup.exe', {
      quit,
      spawnInstaller: vi.fn(() => installer)
    })

    installer.emitError(new Error('Access denied'))

    await expect(launch).resolves.toBe('Access denied')
    expect(quit).not.toHaveBeenCalled()
  })

  it('returns a synchronous launch error without quitting', async () => {
    const quit = vi.fn()

    await expect(launchInstallerAndQuit('C:\\updates\\SpeakHub-0.1.8-Setup.exe', {
      quit,
      spawnInstaller: () => { throw new Error('Blocked by policy') }
    })).resolves.toBe('Blocked by policy')

    expect(quit).not.toHaveBeenCalled()
  })
})
