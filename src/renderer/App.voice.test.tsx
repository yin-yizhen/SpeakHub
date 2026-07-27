// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PracticePreferences, ProviderSettings, SpeakSubApi, SpeechAssetState, SubtitlePreferences, VoiceTurnPhase } from '../shared/types'

const audio = vi.hoisted(() => ({ captureStart: vi.fn(async () => ({ echoCancellation: true })), captureStop: vi.fn(), playTone: vi.fn(), playerPlay: vi.fn(), playerInterrupt: vi.fn(), playerStop: vi.fn() }))

vi.mock('./local-speech-audio', () => ({
  LocalSpeechAudioCapture: class { start = audio.captureStart; stop = audio.captureStop },
  LocalSpeechAudioPlayer: class { play = audio.playerPlay; interrupt = audio.playerInterrupt; stop = audio.playerStop },
  playMicrophoneToggleTone: audio.playTone
}))

import { App } from './App'

const settings: SubtitlePreferences = {
  mode: 'assistant', background: 'glass', backgroundColor: '#0e1713', backgroundOpacity: 0.86,
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
let providerSettings: ProviderSettings
let speechAssetState: SpeechAssetState
let downloadSpeechAssets: ReturnType<typeof vi.fn>
let practicePreferences: PracticePreferences
let savePracticePreferences: ReturnType<typeof vi.fn>

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  audio.captureStart.mockClear(); audio.captureStop.mockClear(); audio.playTone.mockClear(); audio.playerPlay.mockClear(); audio.playerInterrupt.mockClear(); audio.playerStop.mockClear()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  startVoiceCapture = vi.fn(async () => undefined); stopVoiceCapture = vi.fn(async () => undefined)
  practiceEndedListener = undefined; microphoneListener = undefined; voicePhaseListener = undefined; practiceSource = 'api-direct'
  providerSettings = { llmBaseUrl: 'https://api.example.com/v1', llmModel: 'example-chat', hasLlmKey: true, hasAliyunAsrKey: true }
  speechAssetState = { vad: { status: 'ready', downloadedBytes: 1, totalBytes: 1, progress: 1 }, tts: { status: 'ready', downloadedBytes: 1, totalBytes: 1, progress: 1 } }
  downloadSpeechAssets = vi.fn(async () => ({ vad: { status: 'ready' as const, downloadedBytes: 1, totalBytes: 1, progress: 1 }, tts: { status: 'ready' as const, downloadedBytes: 1, totalBytes: 1, progress: 1 } }))
  practicePreferences = { source: practiceSource, mode: 'voice', scenarioTemplateId: 'daily', difficultyTemplateId: 'a1', correctionTemplateId: 'normal', focus: '', focusEnabled: false }
  savePracticePreferences = vi.fn(async (preferences: PracticePreferences) => { practicePreferences = preferences; return preferences })
  let microphone = { active: false, available: false, shortcut: 'F8' }
  toggleMicrophoneGate = vi.fn(async () => {
    microphone = { ...microphone, active: !microphone.active, available: true }
    microphoneListener?.(microphone)
    return microphone
  })
  const api = {
    getState: vi.fn(async () => ({ session: undefined, settings, events: [], connection: { ready: true, pageVisible: false, activeProvider: 'chatgpt-web', providers: { 'chatgpt-web': true } }, automation: { phase: 'idle', message: 'Ready.' }, source: practiceSource, mode: 'voice', lifecycle: 'idle', microphone, speechAssets: speechAssetState, speechUsage: { provider: 'aliyun-fun-asr', sessionSeconds: 0, month: '2026-07', monthlySeconds: 0, estimatedCny: 0 }, voicePhase: 'listening' })),
    getProviderSettings: vi.fn(async () => providerSettings),
    getArchiveDirectory: vi.fn(async () => 'D:/archive'),
    getPromptTemplates: vi.fn(async () => ({ scenario: [{ id: 'daily', name: '日常聊天', prompt: '场景提示词' }, { id: 'travel', name: '旅行英语', prompt: '旅行场景提示词' }], difficulty: [{ id: 'a1', name: 'A1', prompt: '难度提示词' }, { id: 'b1', name: 'B1', prompt: 'B1 难度提示词' }], correction: [{ id: 'normal', name: '普通', prompt: '纠错提示词' }, { id: 'strict', name: '严格', prompt: '严格纠错提示词' }] })),
    savePromptTemplates: vi.fn(async (templates) => templates),
    getPracticePreferences: vi.fn(async () => practicePreferences),
    savePracticePreferences,
    startPractice: vi.fn(async () => {
      microphone = { ...microphone, active: true, available: true }
      microphoneListener?.(microphone)
      return { session: { id: 'session-1', startedAt: 'now', correctionStrength: 'normal' }, voiceStarted: false, source: practiceSource, mode: 'voice' as const }
    }),
    startVoiceCapture,
    stopVoiceCapture,
    reportVoiceCaptureStatus: vi.fn(async () => undefined),
    sendVoiceAudio: vi.fn(async () => undefined),
    onTranscript: vi.fn(() => () => undefined),
    onSubtitleSettings: vi.fn(() => () => undefined),
    onAutomationStatus: vi.fn(() => () => undefined),
    onPracticeEnded: vi.fn((listener) => { practiceEndedListener = listener; return () => { practiceEndedListener = undefined } }),
    onConnectionState: vi.fn(() => () => undefined),
    onVoiceAudio: vi.fn(() => () => undefined),
    onVoiceInterrupt: vi.fn(() => () => undefined),
    onSpeechAssetState: vi.fn(() => () => undefined),
    onSpeechUsage: vi.fn(() => () => undefined),
    onVoicePhase: vi.fn((listener) => { voicePhaseListener = listener; return () => { voicePhaseListener = undefined } }),
    onMicrophoneGateState: vi.fn((listener) => { microphoneListener = listener; return () => { microphoneListener = undefined } }),
    toggleMicrophoneGate,
    setMicrophoneGate: vi.fn(async () => microphone),
    saveMicrophoneShortcut: vi.fn(async (shortcut: string) => shortcut),
    downloadSpeechAssets
  } as unknown as SpeakSubApi
  window.speaksub = api
})

afterEach(() => { act(() => root.unmount()); container.remove() })

const settle = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('unified voice microphone gate', () => {
  it('keeps ChatGPT selected by default on a fresh launch', async () => {
    practiceSource = 'chatgpt-web'
    practicePreferences = { ...practicePreferences, source: 'chatgpt-web' }
    act(() => root.render(<App/>)); await settle()

    expect(container.querySelector<HTMLButtonElement>('.source-picker button.active')?.textContent).toBe('ChatGPT 网页')
    expect(container.querySelector('.prompt-preview')?.textContent).toContain('默认使用英语回复')
    expect(container.querySelector('.prompt-preview')?.textContent).toContain('英文内容应占回复的至少 80%')
  })

  it('restores saved practice preferences and saves a new selection immediately', async () => {
    practicePreferences = { source: 'api-direct', mode: 'text', scenarioTemplateId: 'travel', difficultyTemplateId: 'b1', correctionTemplateId: 'strict', focus: '练习过去时。', focusEnabled: true }
    act(() => root.render(<App/>)); await settle()

    expect(container.querySelector<HTMLButtonElement>('.source-picker button.active')?.textContent).toBe('API 直连')
    expect(container.querySelector<HTMLButtonElement>('.topic-grid .active')?.textContent).toBe('旅行英语')
    expect(container.querySelector<HTMLTextAreaElement>('.practice-focus textarea')?.value).toBe('练习过去时。')
    expect(container.querySelector('.prompt-preview')?.textContent).toContain('将作为 system 发送给 AI 的完整提示词')
    expect(container.querySelector('.prompt-preview')?.textContent).toContain('英文内容应占回复的至少 80%')
    expect(container.querySelector('.prompt-preview')?.textContent).toContain('本次重点：')
    expect(container.querySelector('.prompt-preview')?.textContent).toContain('练习过去时。')

    const daily = [...container.querySelectorAll<HTMLButtonElement>('.topic-grid button')].find((button) => button.textContent === '日常聊天')!
    await act(async () => { daily.click(); await Promise.resolve() })
    expect(savePracticePreferences).toHaveBeenLastCalledWith(expect.objectContaining({ scenarioTemplateId: 'daily', source: 'api-direct', mode: 'text', focus: '练习过去时。', focusEnabled: true }))
  })

  it('redirects a configured text API to settings when Aliyun helper assets are missing and downloads only after a click', async () => {
    practiceSource = 'chatgpt-web'
    speechAssetState = {
      vad: { status: 'missing', downloadedBytes: 0, totalBytes: 643_854, progress: 0 },
      tts: { status: 'missing', downloadedBytes: 0, totalBytes: 147_031_220, progress: 0 }
    }
    act(() => root.render(<App/>)); await settle()

    const apiButton = [...container.querySelectorAll<HTMLButtonElement>('.source-picker button')].find((button) => button.textContent === 'API 直连')!
    await act(async () => { apiButton.click(); await Promise.resolve() })

    expect(container.querySelector('.settings-page')).not.toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('约 148 MB')
    const download = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '下载VAD 与 Kokoro（约 148 MB）')!
    expect(downloadSpeechAssets).not.toHaveBeenCalled()
    await act(async () => { download.click(); await Promise.resolve() })
    expect(downloadSpeechAssets).toHaveBeenCalledWith()
    expect(container.textContent).toContain('阿里语音工作流所需组件已就绪')
  })

  it('requires a separate DashScope key before starting Aliyun recognition', async () => {
    practiceSource = 'chatgpt-web'
    providerSettings = { ...providerSettings, hasAliyunAsrKey: false }
    act(() => root.render(<App/>)); await settle()

    const apiButton = [...container.querySelectorAll<HTMLButtonElement>('.source-picker button')].find((button) => button.textContent === 'API 直连')!
    await act(async () => { apiButton.click(); await Promise.resolve() })

    expect(container.querySelector('.settings-page')).not.toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('DashScope API Key')
  })

  it('shows the Aliyun registration guide and opens only its official pages', async () => {
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    const helpButton = container.querySelector<HTMLButtonElement>('.aliyun-help-trigger')!
    expect(helpButton.textContent).toBe('如何获取')
    await act(async () => { helpButton.click(); await Promise.resolve() })

    const dialog = container.querySelector<HTMLElement>('.aliyun-help-dialog')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.textContent).toContain('如何开通阿里语音识别')
    expect(dialog.textContent).toContain('华北 2（北京）')
    expect(dialog.textContent).toContain('sk-sp-')

    const links = [...dialog.querySelectorAll<HTMLAnchorElement>('.aliyun-help-actions a')]
    expect(links.map((link) => link.href)).toEqual([
      'https://bailian.console.aliyun.com/',
      'https://help.aliyun.com/zh/model-studio/get-api-key/',
      'https://help.aliyun.com/zh/model-studio/new-free-quota/'
    ])
    expect(links.every((link) => link.target === '_blank')).toBe(true)

    await act(async () => { dialog.querySelector<HTMLButtonElement>('[aria-label="关闭阿里 API 帮助"]')!.click(); await Promise.resolve() })
    expect(container.querySelector('.aliyun-help-dialog')).toBeNull()
  })

  it('shows only the Aliyun workflow and no local recognition option or model', async () => {
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    expect(container.textContent).toContain('阿里语音识别')
    expect(container.textContent).toContain('阿里语音辅助组件')
    expect(container.textContent).not.toContain('本地识别')
    expect(container.textContent).not.toContain('Zipformer')
    expect(container.textContent).not.toContain('Whisper')
    expect(container.querySelector('[name="speechRecognitionProvider"]')).toBeNull()
  })

  it('redirects API direct to settings when the text API is not configured', async () => {
    practiceSource = 'chatgpt-web'
    providerSettings = { hasLlmKey: false }
    act(() => root.render(<App/>)); await settle()

    const apiButton = [...container.querySelectorAll<HTMLButtonElement>('.source-picker button')].find((button) => button.textContent === 'API 直连')!
    await act(async () => { apiButton.click(); await Promise.resolve() })

    expect(container.querySelector('.settings-page')).not.toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Base URL、模型名和 API Key')
    expect(downloadSpeechAssets).not.toHaveBeenCalled()
  })

  it('starts API voice practice with the microphone enabled, then lets the shared button pause it', async () => {
    act(() => root.render(<App/>)); await settle()
    expect(container.querySelector('.connection-pill')).toBeNull()
    const start = container.querySelector<HTMLButtonElement>('.session-config .primary-action')!
    await act(async () => { start.click(); await Promise.resolve() })

    await vi.waitFor(() => expect(startVoiceCapture).toHaveBeenCalledOnce())
    expect(audio.captureStart).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('正在听你说')

    const microphoneButton = container.querySelector<HTMLButtonElement>('.microphone-control .finish-action')!
    await act(async () => { microphoneButton.click(); await Promise.resolve() })
    expect(toggleMicrophoneGate).toHaveBeenCalledOnce()
    expect(audio.captureStop).toHaveBeenCalled()
    expect(stopVoiceCapture).toHaveBeenCalled()
    expect(audio.playTone).toHaveBeenLastCalledWith(false)
    expect(container.textContent).toContain('麦克风已暂停')
  })

  it('uses the same gate for ChatGPT voice without starting the API audio capture', async () => {
    practiceSource = 'chatgpt-web'
    practicePreferences = { ...practicePreferences, source: 'chatgpt-web' }
    act(() => root.render(<App/>)); await settle()
    await act(async () => { container.querySelector<HTMLButtonElement>('.session-config .primary-action')!.click(); await Promise.resolve() })

    expect(toggleMicrophoneGate).not.toHaveBeenCalled()
    expect(audio.captureStart).not.toHaveBeenCalled()
    expect(container.textContent).toContain('麦克风已开启')
  })

  it('keeps API capture running while AI thinks and speaks so the user can interrupt', async () => {
    act(() => root.render(<App/>)); await settle()
    await act(async () => { container.querySelector<HTMLButtonElement>('.session-config .primary-action')!.click(); await Promise.resolve() })
    await vi.waitFor(() => expect(audio.captureStart).toHaveBeenCalledOnce())
    expect(audio.captureStart).toHaveBeenCalledOnce()

    const stopsBeforeThinking = audio.captureStop.mock.calls.length
    await act(async () => { voicePhaseListener?.('thinking'); await Promise.resolve() })
    expect(audio.captureStop).toHaveBeenCalledTimes(stopsBeforeThinking)
    expect(audio.captureStart).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('可随时打断 AI')

    await act(async () => { voicePhaseListener?.('listening'); await Promise.resolve() })
    expect(audio.captureStart).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('正在听你说')
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

  it('closes the prompt editor from its fixed top-right close button', async () => {
    act(() => root.render(<App/>)); await settle()
    await act(async () => { container.querySelector<HTMLButtonElement>('.prompt-category .quiet-action')!.click(); await Promise.resolve() })
    expect(container.querySelector('.template-editor')).not.toBeNull()

    await act(async () => { container.querySelector<HTMLButtonElement>('.template-editor-close')!.click(); await Promise.resolve() })
    expect(container.querySelector('.template-editor')).toBeNull()
  })
})
