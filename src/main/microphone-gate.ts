import type { MicrophoneGateState, PracticeMode } from '../shared/types'

export class MicrophoneGate {
  active = false
  private preferredActive?: boolean

  state(sessionActive: boolean, mode: PracticeMode, shortcut: string): MicrophoneGateState {
    return { active: sessionActive ? mode === 'voice' && this.active : this.preferredActive ?? false, available: !sessionActive || mode === 'voice', shortcut }
  }

  async set(active: boolean, sessionActive: boolean, mode: PracticeMode, apply: (active: boolean) => Promise<void>): Promise<void> {
    if (sessionActive && mode !== 'voice') return
    if (sessionActive) await apply(active)
    this.preferredActive = active
    // A pre-practice choice never starts capture or transmits audio.
    if (sessionActive) this.active = active
  }

  start(mode: PracticeMode): void { this.active = mode === 'voice' && (this.preferredActive ?? true) }
  end(): void { this.active = false }
}

export function shouldResetMicrophoneGateForNavigation(isMainFrame: boolean, isInPlace: boolean): boolean {
  return isMainFrame && !isInPlace
}
