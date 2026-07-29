import { spawn } from 'node:child_process'

export interface SpawnedInstaller {
  once(event: 'spawn', listener: () => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  unref(): void
}

export type SpawnInstaller = (filePath: string, args: string[], options: { detached: true; stdio: 'ignore'; windowsHide: false }) => SpawnedInstaller

export interface InstallerLauncherOptions {
  quit: () => void
  spawnInstaller?: SpawnInstaller
  schedule?: (callback: () => void, delayMs: number) => unknown
  exitDelayMs?: number
}

const defaultSpawnInstaller: SpawnInstaller = (filePath, args, options) => spawn(filePath, args, options)

/** Starts the NSIS installer independently, then releases the old app's file locks. */
export function launchInstallerAndQuit(filePath: string, options: InstallerLauncherOptions): Promise<string> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (error = '') => {
      if (settled) return
      settled = true
      resolve(error)
    }

    try {
      const installer = (options.spawnInstaller ?? defaultSpawnInstaller)(filePath, [], { detached: true, stdio: 'ignore', windowsHide: false })
      installer.once('error', (error) => finish(error.message || '无法启动安装程序。'))
      installer.once('spawn', () => {
        installer.unref()
        finish()
        ;(options.schedule ?? setTimeout)(options.quit, options.exitDelayMs ?? 150)
      })
    } catch (error) {
      finish(error instanceof Error ? error.message : '无法启动安装程序。')
    }
  })
}
