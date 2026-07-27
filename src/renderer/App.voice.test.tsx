// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeakSubApi, SubtitlePreferences, VoiceTurnPhase } from '../shared/types'

const audio = vi.hoisted(() => ({ captureStart: vi.fn(async () => undefined), captureStop: vi.fn(), playTone: vi.fn(), playerPlay: vi.fn(), playerInterrupt: vi.fn(), playerStop: vi.fn() }))

vi.mock('./local-speech-audio', () => ({
  LocalSpeechAudioCapture: class { start = audio.captureStart; stop = audio.captureStop },
  LocalSpeechAudioPlayer: class { play = audio.playerPlay; interrupt = audio.playerInterrupt; stop = audio.playerStop },
  playMicrophoneToggleTone: audio.playTone
}))

import { App } from './App'

const settings: SubtitlePreferences = {
  mode: 'assistant', layout: 'split', background: 'glass', backgroundColor: '#0e1713', backgroundOpacity: 0.86,
  assistantColor: '#f1f6f3', userColor: '#fff1c9', fontSize: 25, opacity: 0.94, locked: false, visible: false, maxLines: 4
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let startVoiceCapture: ReturnType<typeof vi.fn>
let stopVoiceCapture: ReturnType<typeof vi.fn>
let practiceEndedListener: ((result: Parameters<SpeakSubApi['onPracticeEnded']>[0] extends (result: infer Result) => void ? Result : never) => void) | undefined
let microphoneListener: ((state: Parameters<SpeakSubApi['onMicrophoneGateState']>[0] extends (state: infer State) => void ? State : never) => void) | undefined
let toggleMicrophoneGate: ReturnType<typeof vi.fn>
let practiceSource: 'api-direct' | 'chatgpt-web'
let voicePhaseListener: ((phase: VoiceTurnPhase) => void) | undefined

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  audio.captureStart.mockClear(); audio.captureStop.mockClear(); audio.playTone.mockClear(); audio.playerPlay.mockClear(); audio.playerInterrupt.mockClear(); audio.playerStop.mockClear()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  startVoiceCapture = vi.fn(async () => undefined); stopVoiceCapture = vi.fn(async () => undefined)
  practiceEndedListener = undefined; microphoneListener = undefined; voicePhaseListener = undefined; practiceSource = 'api-direct'
  let microphone = { active: false, available: false, shortcut: 'F8' }
  toggleMicrophoneGate = vi.fn(async () => {
    microphone = { ...microphone, active: !microphone.active, available: true }
    microphoneListener?.(microphone)
    return microphone
  })
  const api = {
    getState: vi.fn(async () => ({ session: undefined, settings, events: [], connection: { ready: true, pageVisible: false, activeProvider: 'chatgpt-web', providers: { 'chatgpt-web': true } }, automation: { phase: 'idle', message: 'Ready.' }, source: practiceSource, mode: 'voice', lifecycle: 'idle', microphone, speechAssets: { asr: { status: 'ready', downloadedBytes: 1, totalBytes: 1, progress: 1 }, tts: { status: 'ready', downloadedBytes: 1, totalBytes: 1, progress: 1 } }, voicePhase: 'listening' })),
    getProviderSettings: vi.fn(async () => ({ hasLlmKey: true })),
    getArchiveDirectory: vi.fn(async () => 'D:/archive'),
    startPractice: vi.fn(async () => ({ session: { id: 'session-1', startedAt: 'now', correctionStrength: 'normal' }, voiceStarted: false, source: practiceSource, mode: 'voice' as const })),
    startVoiceCapture,
    stopVoiceCapture,
    sendVoiceAudio: vi.fn(async () => undefined),
    onTranscript: vi.fn(() => () => undefined),
    onSubtitleSettings: vi.fn(() => () => undefined),
    onAutomationStatus: vi.fn(() => () => undefined),
    onPracticeEnded: vi.fn((listener) => { practiceEndedListener = listener; return () => { practiceEndedListener = undefined } }),
    onConnectionState: vi.fn(() => () => undefined),
    onVoiceAudio: vi.fn(() => () => undefined),
    onVoiceInterrupt: vi.fn(() => () => undefined),
    onSpeechAssetState: vi.fn(() => () => undefined),
    onVoicePhase: vi.fn((listener) => { voicePhaseListener = listener; return () => { voicePhaseListener = undefined } }),
    onMicrophoneGateState: vi.fn((listener) => { microphoneListener = listener; return () => { microphoneListener = undefined } }),
    toggleMicrophoneGate,
    setMicrophoneGate: vi.fn(async () => microphone),
    saveMicrophoneShortcut: vi.fn(async (shortcut: string) => shortcut)
  } as unknown as SpeakSubApi
  window.speaksub = api
})

afterEach(() => { act(() => root.unmount()); container.remove() })

const settle = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('unified voice microphone gate', () => {
  it('keeps the API microphone off until the shared button toggles the gate, with tones for both transitions', async () => {
    act(() => root.render(<App/>)); await settle()
    expect(container.querySelector('.connection-pill')).toBeNull()
    const start = container.querySelector<HTMLButtonElement>('.session-config .primary-action')!
    await act(async () => { start.click(); await Promise.resolve() })

    expect(startVoiceCapture).not.toHaveBeenCalled()
    expect(audio.captureStart).not.toHaveBeenCalled()

    const microphoneButton = container.querySelector<HTMLButtonElement>('.microphone-control .primary-action')!
    await act(async () => { microphoneButton.click(); await Promise.resolve() })
    expect(toggleMicrophoneGate).toHaveBeenCalledOnce()
    expect(startVoiceCapture).toHaveBeenCalledOnce()
    expect(audio.captureStart).toHaveBeenCalledOnce()
    expect(audio.playTone).toHaveBeenLastCalledWith(true)
    expect(container.textContent).toContain('麦克风已开启')

    await act(async () => { container.querySelector<HTMLButtonElement>('.microphone-control .finish-action')!.click(); await Promise.resolve() })
    expect(audio.captureStop).toHaveBeenCalled()
    expect(stopVoiceCapture).toHaveBeenCalled()
    expect(audio.playTone).toHaveBeenLastCalledWith(false)
    expect(container.textContent).toContain('麦克风已暂停')
  })

  it('uses the same gate for ChatGPT voice without starting the API audio capture', async () => {
    practiceSource = 'chatgpt-web'
    act(() => root.render(<App/>)); await settle()
    await act(async () => { container.querySelector<HTMLButtonElement>('.session-config .primary-action')!.click(); await Promise.resolve() })
    await act(async () => { container.querySelector<HTMLButtonElement>('.microphone-control .primary-action')!.click(); await Promise.resolve() })

    expect(toggleMicrophoneGate).toHaveBeenCalledOnce()
    expect(audio.captureStart).not.toHaveBeenCalled()
    expect(container.textContent).toContain('麦克风已开启')
  })

  it('stops actual API capture during AI output and resumes it after the half-duplex turn', async () => {
    act(() => root.render(<App/>)); await settle()
    await act(async () => { container.querySelector<HTMLButtonElement>('.session-config .primary-action')!.click(); await Promise.resolve() })
    await act(async () => { container.querySelector<HTMLButtonElement>('.microphone-control .primary-action')!.click(); await Promise.resolve() })
    expect(audio.captureStart).toHaveBeenCalledOnce()

    await act(async () => { voicePhaseListener?.('thinking'); await Promise.resolve() })
    expect(audio.captureStop).toHaveBeenCalled()
    expect(container.textContent).toContain('麦克风已临时停采')

    await act(async () => { voicePhaseListener?.('listening'); await Promise.resolve() })
    expect(audio.captureStart).toHaveBeenCalledTimes(2)
  })

  it('returns the main practice UI to idle when the overlay ends the shared session', async () => {
    act(() => root.render(<App/>)); await settle()
    const start = container.querySelector<HTMLButtonElement>('.session-config .primary-action')!
    await act(async () => { start.click(); await Promise.resolve() })
    expect(container.querySelector('.finish-action')).not.toBeNull()

    await act(async () => {
      practiceEndedListener?.({
        session: { id: 'session-1', startedAt: 'now', endedAt: 'later', correctionStrength: 'normal' },
        review: { topic: 'Overlay session', summary: 'Finished from the subtitle overlay.', issues: [], vocabulary: [], nextPractice: 'Keep practicing.' },
        voiceStopped: true
      })
      await Promise.resolve()
    })

    expect(audio.playerStop).toHaveBeenCalledOnce()
    expect(container.querySelector('.finish-action')).toBeNull()
    expect(container.querySelector<HTMLButtonElement>('.session-config .primary-action')?.textContent).toBe('确认并开始')
    expect(container.querySelector('.review-panel')?.textContent).toContain('Overlay session')
  })
})
