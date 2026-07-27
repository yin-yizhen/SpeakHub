import type { VoiceTurnPhase } from '../shared/types'

export function bargeInDelayMs(phase: VoiceTurnPhase, echoCancellationAvailable: boolean): number {
  // Silero has already required 250 ms of speech before speech-started.
  const phaseDelay = phase === 'thinking' ? 0 : 50
  return phaseDelay + (echoCancellationAvailable ? 0 : 200)
}
