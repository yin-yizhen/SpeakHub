// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationStatus, PracticePreferences, ProviderSettings, ProviderSettingsInput, SpeakSubApi, SpeechAssetState, SubtitlePreferences, UpdateDownloadProgress, VoiceTurnPhase } from '../shared/types'
import { MIMO_HELP_LINKS, SPEECH_MODEL_DOWNLOAD_LINKS } from '../shared/help-links'

const audio = vi.hoisted(() => ({ captureStart: vi.fn(async (_onAudio?: (chunk: { sampleRate: 16000; format: 'float32'; samples: ArrayBuffer }) => void) => ({ echoCancellation: true })), captureStop: vi.fn(), playTone: vi.fn(), playerPlay: vi.fn(), playerInterrupt: vi.fn(), playerStop: vi.fn() }))

vi.mock('./local-speech-audio', () => ({
  LocalSpeechAudioCapture: class { start = audio.captureStart; stop = audio.captureStop },
  LocalSpeechAudioPlayer: class { play = audio.playerPlay; interrupt = audio.playerInterrupt; stop = audio.playerStop },
  microphoneSignalThreshold: 0.012,
  microphoneSignalLevel: (samples: Float32Array) => samples.length ? Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length) : 0,
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
let removeKokoroModel: ReturnType<typeof vi.fn>
let openSpeechAssetDirectory: ReturnType<typeof vi.fn>
let practicePreferences: PracticePreferences
let savePracticePreferences: ReturnType<typeof vi.fn>
let checkForUpdates: ReturnType<typeof vi.fn>
let downloadAndInstallUpdate: ReturnType<typeof vi.fn>
let updateProgressListener: ((progress: UpdateDownloadProgress) => void) | undefined
let copyCommunityGroupNumber: ReturnType<typeof vi.fn>
let getAppVersion: ReturnType<typeof vi.fn>
let checkLlmConnection: ReturnType<typeof vi.fn>
let checkAliyunConnection: ReturnType<typeof vi.fn>
let previewMimoTtsVoice: ReturnType<typeof vi.fn>
let saveProviderSettings: ReturnType<typeof vi.fn>
let connectionPageVisible: boolean
let connectionReady: boolean
let clearWebConnectionLogin: ReturnType<typeof vi.fn>
let reloadWebConnectionPage: ReturnType<typeof vi.fn>
let importWebConnectionLogin: ReturnType<typeof vi.fn>
let hideConnectionPage: ReturnType<typeof vi.fn>
let automationListener: ((status: AutomationStatus) => void) | undefined

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  audio.captureStart.mockClear(); audio.captureStop.mockClear(); audio.playTone.mockClear(); audio.playerPlay.mockClear(); audio.playerInterrupt.mockClear(); audio.playerStop.mockClear()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  startVoiceCapture = vi.fn(async () => undefined); stopVoiceCapture = vi.fn(async () => undefined)
  practiceEndedListener = undefined; microphoneListener = undefined; voicePhaseListener = undefined; automationListener = undefined; practiceSource = 'api-direct'
  connectionPageVisible = false
  connectionReady = true
  clearWebConnectionLogin = vi.fn(async () => ({ ready: false, pageVisible: true, activeProvider: 'chatgpt-web' as const, providers: { 'chatgpt-web': false } }))
  reloadWebConnectionPage = vi.fn(async () => undefined)
  importWebConnectionLogin = vi.fn(async () => ({ ready: true, pageVisible: true, activeProvider: 'chatgpt-web' as const, providers: { 'chatgpt-web': true } }))
  hideConnectionPage = vi.fn(async () => ({ ready: connectionReady, pageVisible: false, activeProvider: 'chatgpt-web' as const, providers: { 'chatgpt-web': connectionReady } }))
  providerSettings = { llmBaseUrl: 'https://api.example.com/v1', llmModel: 'example-chat', hasLlmKey: true, hasAliyunAsrKey: true, ttsProvider: 'kokoro', hasMimoTtsKey: false }
  speechAssetState = { vad: { status: 'ready', downloadedBytes: 1, totalBytes: 1, progress: 1 }, tts: { status: 'ready', downloadedBytes: 1, totalBytes: 1, progress: 1 } }
  downloadSpeechAssets = vi.fn(async (includeTts = true): Promise<SpeechAssetState> => ({
    vad: { status: 'ready', downloadedBytes: 1, totalBytes: 1, progress: 1 },
    tts: includeTts ? { status: 'ready', downloadedBytes: 1, totalBytes: 1, progress: 1 } : speechAssetState.tts
  }))
  removeKokoroModel = vi.fn(async () => ({ vad: { status: 'ready' as const, downloadedBytes: 1, totalBytes: 1, progress: 1 }, tts: { status: 'missing' as const, downloadedBytes: 0, totalBytes: 147_031_220, progress: 0 } }))
  openSpeechAssetDirectory = vi.fn(async () => undefined)
  practicePreferences = { source: practiceSource, mode: 'voice', scenarioTemplateId: 'daily', difficultyTemplateId: 'a1', correctionTemplateId: 'normal', focus: '', focusEnabled: false }
  savePracticePreferences = vi.fn(async (preferences: PracticePreferences) => { practicePreferences = preferences; return preferences })
  checkForUpdates = vi.fn(async () => ({ configured: true, currentVersion: '0.1.0', latestVersion: '0.1.0', updateAvailable: false }))
  downloadAndInstallUpdate = vi.fn(async () => ({ ok: true }))
  copyCommunityGroupNumber = vi.fn(async () => '1091142340')
  getAppVersion = vi.fn(async () => '0.1.5')
  checkLlmConnection = vi.fn(async () => ({ ok: true as const, message: '连接成功，模型可以正常回复。' }))
  checkAliyunConnection = vi.fn(async () => ({ ok: true as const, message: '阿里识别连接成功，Key 和网络可用；此检测不测试麦克风或扬声器。' }))
  previewMimoTtsVoice = vi.fn(async () => ({ sampleRate: 24000 as const, samples: Float32Array.from([0.1, -0.1]).buffer }))
  saveProviderSettings = vi.fn(async (input: ProviderSettingsInput) => {
    providerSettings = {
      ...providerSettings,
      ...(input.llmBaseUrl !== undefined ? { llmBaseUrl: input.llmBaseUrl } : {}),
      ...(input.llmModel !== undefined ? { llmModel: input.llmModel } : {}),
      ...(input.ttsProvider !== undefined ? { ttsProvider: input.ttsProvider } : {}),
      ...(input.mimoTtsVoice !== undefined ? { mimoTtsVoice: input.mimoTtsVoice } : {})
    }
    return providerSettings
  })
  updateProgressListener = undefined
  let microphone = { active: false, available: false, shortcut: 'F8' }
  toggleMicrophoneGate = vi.fn(async () => {
    microphone = { ...microphone, active: !microphone.active, available: true }
    microphoneListener?.(microphone)
    return microphone
  })
  const api = {
    getAppVersion,
    getState: vi.fn(async () => ({ session: undefined, settings, events: [], connection: { ready: connectionReady, pageVisible: connectionPageVisible, activeProvider: 'chatgpt-web', providers: { 'chatgpt-web': connectionReady } }, automation: { phase: 'idle', message: 'Ready.' }, source: practiceSource, mode: 'voice', lifecycle: 'idle', microphone, speechAssets: speechAssetState, speechUsage: { provider: 'aliyun-fun-asr', sessionSeconds: 0, month: '2026-07', monthlySeconds: 0, estimatedCny: 0 }, voicePhase: 'listening' })),
    clearWebConnectionLogin,
    reloadWebConnectionPage,
    importWebConnectionLogin,
    hideConnectionPage,
    getProviderSettings: vi.fn(async () => providerSettings),
    saveProviderSettings,
    checkLlmConnection,
    checkAliyunConnection,
    previewMimoTtsVoice,
    cancelMimoTtsPreview: vi.fn(async () => undefined),
    getArchiveDirectory: vi.fn(async () => 'D:/archive'),
    copyCommunityGroupNumber,
    getPromptTemplates: vi.fn(async () => ({ systemPrompt: '系统提示词', scenario: [{ id: 'daily', name: '日常聊天', prompt: '场景提示词' }, { id: 'travel', name: '旅行英语', prompt: '旅行场景提示词' }], difficulty: [{ id: 'a1', name: 'A1', prompt: '难度提示词' }, { id: 'b1', name: 'B1', prompt: 'B1 难度提示词' }], correction: [{ id: 'normal', name: '普通', prompt: '纠错提示词' }, { id: 'strict', name: '严格', prompt: '严格纠错提示词' }] })),
    savePromptTemplates: vi.fn(async (templates) => templates),
    getPracticePreferences: vi.fn(async () => practicePreferences),
    savePracticePreferences,
    startPractice: vi.fn(async () => {
      microphone = { ...microphone, active: true, available: true }
      microphoneListener?.(microphone)
      return { session: { id: 'session-1', startedAt: 'now', correctionStrength: 'normal' }, voiceStarted: false, source: practiceSource, mode: 'voice' as const }
    }),
    cancelPracticeStart: vi.fn(async () => undefined),
    startVoiceCapture,
    stopVoiceCapture,
    reportVoiceCaptureStatus: vi.fn(async () => undefined),
    sendVoiceAudio: vi.fn(async () => undefined),
    onTranscript: vi.fn(() => () => undefined),
    onSubtitleSettings: vi.fn(() => () => undefined),
    onAutomationStatus: vi.fn((listener) => { automationListener = listener; return () => { automationListener = undefined } }),
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
    getSpeechAssetInstallInfo: vi.fn(async () => ({
      root: 'C:\\Users\\test\\AppData\\Roaming\\speaksub\\speech-models',
      vadFile: 'C:\\Users\\test\\AppData\\Roaming\\speaksub\\speech-models\\silero-vad\\silero_vad.onnx',
      ttsDirectory: 'C:\\Users\\test\\AppData\\Roaming\\speaksub\\speech-models\\kokoro-int8-multi-lang-v1_1'
    })),
    openSpeechAssetDirectory,
    downloadSpeechAssets,
    removeKokoroModel,
    checkForUpdates,
    downloadAndInstallUpdate,
    openUpdateRelease: vi.fn(async () => ({ ok: true })),
    onUpdateProgress: vi.fn((listener) => { updateProgressListener = listener; return () => { updateProgressListener = undefined } })
  } as unknown as SpeakSubApi
  window.speaksub = api
})

afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks() })

const settle = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('unified voice microphone gate', () => {
  it('always returns to the main interface when the login is not ready', async () => {
    connectionPageVisible = true
    connectionReady = false
    act(() => root.render(<App/>)); await settle()

    expect(container.textContent).not.toContain('清除网页登录状态')
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === '返回主界面')!
    await act(async () => { button.click(); await Promise.resolve() })

    expect(hideConnectionPage).toHaveBeenCalledOnce()
  })

  it('starts a one-time browser login and returns to the embedded ChatGPT page', async () => {
    connectionPageVisible = true
    connectionReady = false
    act(() => root.render(<App/>)); await settle()

    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === '使用 Google 登录 ChatGPT')!
    await act(async () => { button.click(); await Promise.resolve() })

    expect(importWebConnectionLogin).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Google 登录已传回 SpeakHub')
    expect(container.textContent).toContain('返回主界面')
  })

  it('keeps Google login visible when the cached connection is ready', async () => {
    connectionPageVisible = true
    connectionReady = true
    act(() => root.render(<App/>)); await settle()

    expect(container.textContent).toContain('使用 Google 登录 ChatGPT')
    expect(container.textContent).toContain('返回主界面')
  })

  it('refreshes the connection page before offering a login reset', async () => {
    connectionPageVisible = true
    act(() => root.render(<App/>)); await settle()

    expect(container.textContent).toContain('刷新连接页')
    expect(container.textContent).not.toContain('清除缓存并重新登录')

    const refresh = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === '刷新连接页')!
    await act(async () => { refresh.click(); await Promise.resolve() })

    expect(reloadWebConnectionPage).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('正在绕过缓存刷新右侧 ChatGPT 页面')
    expect(container.textContent).toContain('清除缓存并重新登录')
  })

  it('shows an inline cache-and-login reset only after a connection failure', async () => {
    connectionPageVisible = true
    act(() => root.render(<App/>)); await settle()

    act(() => automationListener?.({ phase: 'failed', message: 'ChatGPT 页面加载失败。', recoverable: true }))
    const reset = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === '清除缓存并重新登录')!
    act(() => reset.click())

    expect(container.querySelector('.confirm-layer')).toBeNull()
    expect(container.querySelector('.connection-reset-inline')?.textContent).toContain('清除缓存并退出当前账号')
    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === '确认清除并退出')!
    await act(async () => { confirm.click(); await Promise.resolve() })

    expect(clearWebConnectionLogin).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('网页缓存和 ChatGPT 登录状态已清除')
  })

  it('shows the packaged application version in the top bar', async () => {
    act(() => root.render(<App/>)); await settle()

    const version = container.querySelector<HTMLElement>('.brand-version')
    expect(getAppVersion).toHaveBeenCalledOnce()
    expect(version?.textContent).toBe('v0.1.5')
    expect(version?.getAttribute('aria-label')).toBe('应用版本 v0.1.5')
  })

  it('keeps ChatGPT selected by default on a fresh launch', async () => {
    practiceSource = 'chatgpt-web'
    practicePreferences = { ...practicePreferences, source: 'chatgpt-web' }
    act(() => root.render(<App/>)); await settle()

    expect(container.querySelector<HTMLButtonElement>('.source-picker button.active')?.textContent).toBe('ChatGPT 网页')
    expect(container.querySelector('.prompt-preview')?.textContent).toContain('系统提示词')
    expect(container.querySelector('.prompt-preview')?.textContent).toContain('场景提示词')

    const manageButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === '管理系统提示词')!
    await act(async () => { manageButton.click(); await Promise.resolve() })

    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="系统提示词内容"]')?.value).toBe('系统提示词')
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('ChatGPT 网页会将相同内容合并进首条提示词')
  })

  it('opens a separate system prompt editor for API direct practice', async () => {
    act(() => root.render(<App/>)); await settle()

    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === '管理系统提示词')!
    await act(async () => { button.click(); await Promise.resolve() })

    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe('管理系统提示词')
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="系统提示词内容"]')?.value).toBe('系统提示词')
  })

  it('restores the default system prompt in the editor', async () => {
    act(() => root.render(<App/>)); await settle()

    const manageButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === '管理系统提示词')!
    await act(async () => { manageButton.click(); await Promise.resolve() })

    const resetButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === '恢复默认')!
    await act(async () => { resetButton.click(); await Promise.resolve() })

    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="系统提示词内容"]')?.value).toContain('你是一名英语口语陪练')
  })

  it('restores saved practice preferences and saves a new selection immediately', async () => {
    practicePreferences = { source: 'api-direct', mode: 'text', scenarioTemplateId: 'travel', difficultyTemplateId: 'b1', correctionTemplateId: 'strict', focus: '练习过去时。', focusEnabled: true }
    act(() => root.render(<App/>)); await settle()

    expect(container.querySelector<HTMLButtonElement>('.source-picker button.active')?.textContent).toBe('API 直连')
    expect(container.querySelector<HTMLButtonElement>('.topic-grid .active')?.textContent).toBe('旅行英语')
    expect(container.querySelector<HTMLTextAreaElement>('.practice-focus textarea')?.value).toBe('练习过去时。')
    expect(container.querySelector('.prompt-preview')?.textContent).toContain('将作为 system 发送给 AI 的完整提示词')
    expect(container.querySelector('.prompt-preview')?.textContent).toContain('系统提示词')
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
    expect(container.textContent).toContain('优先点击上方下载按钮')
    expect(container.textContent).toContain('C:\\Users\\test\\AppData\\Roaming\\speaksub\\speech-models')
    expect(container.querySelector<HTMLAnchorElement>(`a[href="${SPEECH_MODEL_DOWNLOAD_LINKS.vad}"]`)).not.toBeNull()
    expect(container.querySelector<HTMLAnchorElement>(`a[href="${SPEECH_MODEL_DOWNLOAD_LINKS.kokoro}"]`)).not.toBeNull()
    const download = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '下载VAD 与 Kokoro（约 148 MB）')!
    expect(downloadSpeechAssets).not.toHaveBeenCalled()
    await act(async () => { download.click(); await Promise.resolve() })
    expect(downloadSpeechAssets).toHaveBeenCalledWith(true)
    expect(container.textContent).toContain('当前语音方案所需的本地组件已就绪')
    expect(container.textContent).toContain('Kokoro · 本地备用朗读（非推荐）')
    const recommendationBadge = container.querySelector<HTMLElement>('.mimo-recommendation-badge')!
    expect(recommendationBadge.textContent).toBe('推荐使用 MiMo')
    expect(recommendationBadge.parentElement?.textContent).toBe('Kokoro · 本地备用朗读（非推荐）推荐使用 MiMo')
    expect(container.querySelector<HTMLButtonElement>('.kokoro-remove-trigger')?.disabled).toBe(true)
    expect(container.querySelector<HTMLSelectElement>('[name="ttsProvider"]')?.value).toBe('kokoro')
    expect([...container.querySelectorAll<HTMLOptionElement>('[name="ttsProvider"] option')].map((option) => option.textContent)).toEqual([
      '云端 Xiaomi MiMo V2.5 TTS（推荐）',
      '本地 Kokoro（备用）'
    ])
  })

  it('defaults an unset reading provider to the recommended MiMo option', async () => {
    providerSettings = { ...providerSettings, ttsProvider: undefined }
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    expect(container.querySelector<HTMLSelectElement>('[name="ttsProvider"]')?.value).toBe('mimo')
    expect(container.querySelector('.mimo-recommendation-badge')?.textContent).toBe('推荐使用 MiMo')
  })

  it('automatically saves the reading provider without clearing unfinished key input', async () => {
    providerSettings = { ...providerSettings, ttsProvider: 'kokoro' }
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    const unfinishedKey = container.querySelector<HTMLInputElement>('[name="llmApiKey"]')!
    unfinishedKey.value = 'not-saved-yet'
    const provider = container.querySelector<HTMLSelectElement>('[name="ttsProvider"]')!
    await act(async () => {
      provider.value = 'mimo'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(saveProviderSettings).toHaveBeenCalledWith({ ttsProvider: 'mimo' })
    expect(provider.value).toBe('mimo')
    expect(unfinishedKey.value).toBe('not-saved-yet')
    expect(container.querySelector('.tts-preference-save.saved')?.textContent).toBe('已自动保存')
  })

  it('restores the last saved reading provider when automatic saving fails', async () => {
    providerSettings = { ...providerSettings, ttsProvider: 'kokoro' }
    saveProviderSettings.mockRejectedValueOnce(new Error('保存失败，请检查本地设置权限。'))
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    const provider = container.querySelector<HTMLSelectElement>('[name="ttsProvider"]')!
    await act(async () => {
      provider.value = 'mimo'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(provider.value).toBe('kokoro')
    expect(container.querySelector('.tts-preference-save.error[role="alert"]')?.textContent).toContain('保存失败')
  })

  it('shows the selected MiMo voice and settings guidance in the practice heading', async () => {
    providerSettings = { ...providerSettings, ttsProvider: 'mimo', mimoTtsVoice: 'Milo', hasMimoTtsKey: true }
    act(() => root.render(<App/>)); await settle()

    expect(container.querySelector('.workbench-heading span')?.textContent).toBe('文本 API + 阿里双语识别 + MiMo Milo 朗读；音色可在设置中切换')
  })

  it('requires only VAD and a MiMo key for cloud TTS', async () => {
    providerSettings = { ...providerSettings, ttsProvider: 'mimo', mimoTtsVoice: 'Milo', hasMimoTtsKey: true }
    speechAssetState = {
      vad: { status: 'missing', downloadedBytes: 0, totalBytes: 643_854, progress: 0 },
      tts: { status: 'missing', downloadedBytes: 0, totalBytes: 147_031_220, progress: 0 }
    }
    act(() => root.render(<App/>)); await settle()

    const apiButton = [...container.querySelectorAll<HTMLButtonElement>('.source-picker button')].find((button) => button.textContent === 'API 直连')!
    await act(async () => { apiButton.click(); await Promise.resolve() })

    expect(container.querySelector('.settings-page')).not.toBeNull()
    expect(container.textContent).toContain('云端 Xiaomi MiMo V2.5 TTS')
    expect(container.textContent).not.toContain('还需下载约 148 MB')
    const download = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '下载VAD（约 1 MB）')!
    await act(async () => { download.click(); await Promise.resolve() })
    expect(downloadSpeechAssets).toHaveBeenCalledWith(false)
    expect(container.textContent).toContain('MiMo 云端朗读所需的本地组件已就绪；Kokoro 仅作为本地备用')
    expect([...container.querySelectorAll<HTMLElement>('.speech-assets strong')].some((item) => item.textContent === 'Silero VAD · 语音检测与抢话（语音对话必需）')).toBe(true)
    expect(container.textContent).toContain('Kokoro · 本地备用朗读（非推荐）')
    expect(container.querySelector('.mimo-recommendation-badge')?.textContent).toBe('推荐使用 MiMo')
    expect(container.querySelector('.kokoro-remove-trigger')).toBeNull()
  })

  it('keeps an installed Kokoro model visible in MiMo mode and deletes it only after confirmation', async () => {
    providerSettings = { ...providerSettings, ttsProvider: 'mimo', mimoTtsVoice: 'Mia', hasMimoTtsKey: true }
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    const removeButton = container.querySelector<HTMLButtonElement>('.kokoro-remove-trigger')!
    expect(removeButton.disabled).toBe(false)
    expect(removeKokoroModel).not.toHaveBeenCalled()
    await act(async () => { removeButton.click(); await Promise.resolve() })

    const dialog = container.querySelector<HTMLElement>('.kokoro-removal-dialog')!
    expect(dialog.textContent).toContain('Silero VAD、MiMo API Key、音色设置和练习记录不会受到影响')
    expect(removeKokoroModel).not.toHaveBeenCalled()
    await act(async () => { dialog.querySelector<HTMLButtonElement>('.kokoro-removal-confirm')!.click(); await Promise.resolve(); await Promise.resolve() })

    expect(removeKokoroModel).toHaveBeenCalledOnce()
    expect(container.querySelector('.kokoro-removal-dialog')).toBeNull()
    expect(container.querySelector('.kokoro-remove-trigger')).toBeNull()
    const kokoroRow = [...container.querySelectorAll<HTMLElement>('.speech-assets > div')].find((item) => item.textContent?.includes('Kokoro · 本地备用朗读'))!
    expect(kokoroRow.textContent).toContain('未下载')
    const vadRow = [...container.querySelectorAll<HTMLElement>('.speech-assets > div')].find((item) => item.textContent?.includes('Silero VAD'))!
    expect(vadRow.textContent).toContain('已就绪')
  })

  it('selects and previews each MiMo voice from local settings', async () => {
    providerSettings = { ...providerSettings, ttsProvider: 'mimo', mimoTtsVoice: 'Mia', hasMimoTtsKey: true }
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    const unfinishedKey = container.querySelector<HTMLInputElement>('[name="llmApiKey"]')!
    unfinishedKey.value = 'not-saved-yet'
    const milo = container.querySelector<HTMLButtonElement>('[aria-label="选择并试听 Milo"]')!
    await act(async () => { milo.click(); await Promise.resolve(); await Promise.resolve() })

    expect(milo.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector<HTMLInputElement>('[name="mimoTtsVoice"]')?.value).toBe('Milo')
    expect(saveProviderSettings).toHaveBeenCalledWith({ mimoTtsVoice: 'Milo' })
    expect(unfinishedKey.value).toBe('not-saved-yet')
    expect(container.querySelector('.tts-preference-save.saved')?.textContent).toBe('已自动保存')
    expect(previewMimoTtsVoice).toHaveBeenCalledWith({ voice: 'Milo', mimoTtsApiKey: undefined })
    expect(audio.playerPlay).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'mimo-preview',
      sampleRate: 24000,
      format: 'float32'
    }), expect.any(Function))
    expect(container.querySelector('.mimo-preview-result')?.textContent).toContain('正在播放 Milo')
  })

  it('keeps manual installation help visible when speech assets are ready and opens the real model directory', async () => {
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    expect(container.textContent).toContain('当前语音方案所需的本地组件已就绪')
    expect(container.textContent).toContain('下载与安装说明')
    expect(container.textContent).toContain('不要出现双层同名目录')
    const openDirectory = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '打开模型文件夹')!
    await act(async () => { openDirectory.click(); await Promise.resolve() })
    expect(openSpeechAssetDirectory).toHaveBeenCalledOnce()
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

    const helpButton = container.querySelector<HTMLButtonElement>('.aliyun-help-trigger:not(.mimo-help-trigger)')!
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

  it('shows the MiMo registration guide and opens only its official pages', async () => {
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    const helpButton = container.querySelector<HTMLButtonElement>('.mimo-help-trigger')!
    expect(helpButton.textContent).toBe('如何获取')
    await act(async () => { helpButton.click(); await Promise.resolve() })

    const dialog = container.querySelector<HTMLElement>('.mimo-help-dialog')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.textContent).toContain('如何开通 MiMo 云端朗读')
    expect(dialog.textContent).toContain('sk-…')
    expect(dialog.textContent).toContain('tp-…')
    expect(dialog.textContent).toContain('选择音色并试听')

    const links = [...dialog.querySelectorAll<HTMLAnchorElement>('.aliyun-help-actions a')]
    expect(links.map((link) => link.href)).toEqual([
      MIMO_HELP_LINKS.console,
      MIMO_HELP_LINKS.apiKeyGuide,
      MIMO_HELP_LINKS.ttsGuide
    ])
    expect(links.every((link) => link.target === '_blank')).toBe(true)

    await act(async () => { dialog.querySelector<HTMLButtonElement>('[aria-label="关闭 MiMo API 帮助"]')!.click(); await Promise.resolve() })
    expect(container.querySelector('.mimo-help-dialog')).toBeNull()
  })

  it('shows only the Aliyun workflow and no local recognition option or model', async () => {
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    expect(container.textContent).toContain('阿里语音识别')
    expect(container.textContent).toContain('语音朗读辅助组件')
    expect(container.textContent).not.toContain('本地识别')
    expect(container.textContent).not.toContain('Zipformer')
    expect(container.textContent).not.toContain('Whisper')
    expect(container.querySelector('[name="speechRecognitionProvider"]')).toBeNull()
  })

  it('detects a usable local microphone signal without calling provider APIs', async () => {
    const samples = Float32Array.from({ length: 320 }, (_, index) => Math.sin(index / 5) * 0.08)
    audio.captureStart.mockImplementationOnce(async (onAudio) => {
      onAudio?.({ sampleRate: 16000, format: 'float32', samples: samples.buffer as ArrayBuffer })
      return { echoCancellation: true }
    })
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })
    vi.useFakeTimers()

    const microphoneTest = container.querySelector<HTMLButtonElement>('.microphone-test-trigger')!
    await act(async () => { microphoneTest.click(); await Promise.resolve() })
    expect(container.querySelector<HTMLProgressElement>('[aria-label="麦克风输入强度"]')?.value).toBeGreaterThan(0)
    expect(checkLlmConnection).not.toHaveBeenCalled()
    expect(checkAliyunConnection).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(4_000); await Promise.resolve() })
    expect(container.querySelector('.microphone-test.success')?.textContent).toContain('麦克风正常，已检测到声音')
    expect(audio.captureStop).toHaveBeenCalled()
  })

  it('distinguishes microphone permission from actually receiving sound', async () => {
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })
    vi.useFakeTimers()

    await act(async () => { container.querySelector<HTMLButtonElement>('.microphone-test-trigger')!.click(); await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(4_000); await Promise.resolve() })
    expect(container.querySelector('.microphone-test.error')?.textContent).toContain('已获得麦克风权限，但没有检测到声音')
  })

  it('explains how to recover when microphone permission is denied', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    audio.captureStart.mockRejectedValueOnce(denied)
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    await act(async () => { container.querySelector<HTMLButtonElement>('.microphone-test-trigger')!.click(); await Promise.resolve() })
    expect(container.querySelector('.microphone-test.error [role="alert"]')?.textContent).toContain('Windows 隐私设置')
  })

  it('checks the saved LLM and Aliyun credentials independently from the settings form', async () => {
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    const llmButton = container.querySelector<HTMLButtonElement>('.llm-check-trigger')!
    await act(async () => { llmButton.click(); await Promise.resolve() })
    expect(checkLlmConnection).toHaveBeenCalledWith({
      llmBaseUrl: 'https://api.example.com/v1',
      llmModel: 'example-chat',
      llmApiKey: undefined
    })
    expect(container.querySelector('.provider-check.success')?.textContent).toContain('模型可以正常回复')

    const aliyunButton = container.querySelector<HTMLButtonElement>('.aliyun-check-trigger')!
    await act(async () => { aliyunButton.click(); await Promise.resolve() })
    expect(checkAliyunConnection).toHaveBeenCalledWith({ aliyunAsrApiKey: undefined })
    expect([...container.querySelectorAll('.provider-check.success')].some((item) => item.textContent?.includes('Key 和网络可用'))).toBe(true)
  })

  it('shows independent loading and error feedback for provider checks', async () => {
    let rejectLlm!: (error: Error) => void
    checkLlmConnection.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLlm = reject }))
    checkAliyunConnection.mockRejectedValueOnce(new Error("Error invoking remote method 'providers:check-aliyun': Error: 阿里识别鉴权失败，请检查 DashScope API Key。"))
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    const llmButton = container.querySelector<HTMLButtonElement>('.llm-check-trigger')!
    await act(async () => { llmButton.click(); await Promise.resolve() })
    expect(llmButton.disabled).toBe(true)
    expect(llmButton.textContent).toContain('正在检测')
    expect(container.querySelector<HTMLButtonElement>('.aliyun-check-trigger')?.disabled).toBe(false)

    await act(async () => { rejectLlm(new Error('大模型鉴权失败（HTTP 401）')); await Promise.resolve() })
    expect(container.querySelector('.provider-check.error [role="alert"]')?.textContent).toContain('HTTP 401')

    const aliyunButton = container.querySelector<HTMLButtonElement>('.aliyun-check-trigger')!
    await act(async () => { aliyunButton.click(); await Promise.resolve() })
    expect([...container.querySelectorAll('[role="alert"]')].some((item) => item.textContent?.includes('阿里识别鉴权失败'))).toBe(true)
    expect(container.textContent).not.toContain('Error invoking remote method')
  })

  it('redirects API direct to settings when the text API is not configured', async () => {
    practiceSource = 'chatgpt-web'
    providerSettings = { hasLlmKey: false, ttsProvider: 'kokoro', hasMimoTtsKey: false }
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

  it('lets a second click cancel a practice that is still starting and ignores its late result', async () => {
    let finishStart!: (result: Awaited<ReturnType<SpeakSubApi['startPractice']>>) => void
    vi.mocked(window.speaksub.startPractice).mockImplementationOnce(() => new Promise((resolve) => { finishStart = resolve }))
    act(() => root.render(<App/>)); await settle()

    await act(async () => { container.querySelector<HTMLButtonElement>('.session-config .primary-action')!.click(); await Promise.resolve() })
    const cancel = container.querySelector<HTMLButtonElement>('[aria-label="取消正在启动的练习"]')!
    expect(cancel.disabled).toBe(false)
    expect(cancel.textContent).toContain('再次点击取消')

    await act(async () => { cancel.click(); await Promise.resolve() })
    expect(window.speaksub.cancelPracticeStart).toHaveBeenCalledOnce()
    expect(container.querySelector<HTMLButtonElement>('.session-config .primary-action')?.textContent).toBe('确认并开始')

    await act(async () => {
      finishStart({ session: { id: 'late-session', startedAt: 'now', correctionStrength: 'normal' }, voiceStarted: false, source: 'api-direct', mode: 'voice' })
      await Promise.resolve()
    })
    expect(container.querySelector('.finish-action')).toBeNull()
    expect(container.textContent).toContain('已取消本次启动')
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

describe('application updates', () => {
  const nextRelease = {
    configured: true,
    currentVersion: '0.1.0',
    latestVersion: '0.1.1',
    updateAvailable: true,
    release: {
      tagName: 'v0.1.1',
      name: 'SpeakHub v0.1.1',
      publishedAt: '2026-07-28T00:00:00Z',
      notes: '新增启动更新检测\n修复下载进度显示',
      htmlUrl: 'https://github.com/yin-yizhen/SpeakHub/releases/tag/v0.1.1'
    },
    asset: { name: 'SpeakHub-0.1.1-Setup.exe', size: 100 }
  }

  it('checks five seconds after startup and shows the release notes for a newer version', async () => {
    vi.useFakeTimers()
    checkForUpdates.mockResolvedValueOnce(nextRelease)
    act(() => root.render(<App/>)); await settle()
    expect(checkForUpdates).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    const dialog = container.querySelector<HTMLElement>('.update-dialog')!
    expect(checkForUpdates).toHaveBeenCalledOnce()
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.textContent).toContain('当前 0.1.0 → 最新 0.1.1')
    expect(dialog.textContent).toContain('新增启动更新检测')
    expect(dialog.textContent).toContain('修复下载进度显示')
  })

  it('skips only the displayed version while manual checks still report the current version', async () => {
    vi.useFakeTimers()
    checkForUpdates.mockResolvedValueOnce(nextRelease)
    act(() => root.render(<App/>)); await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    const skip = [...container.querySelectorAll<HTMLButtonElement>('.update-dialog button')].find((button) => button.textContent === '跳过此版本')!
    await act(async () => { skip.click(); await Promise.resolve() })
    expect(container.querySelector('.update-dialog')).toBeNull()
    expect(localStorage.getItem('speakhub-skipped-update-version-v1')).toBe('0.1.1')

    checkForUpdates.mockResolvedValueOnce({ configured: true, currentVersion: '0.1.0', latestVersion: '0.1.0', updateAvailable: false })
    await act(async () => { container.querySelectorAll<HTMLButtonElement>('.studio-nav button')[2].click(); await Promise.resolve() })
    const manualCheck = container.querySelector<HTMLButtonElement>('.app-update-card .quiet-action')!
    await act(async () => { manualCheck.click(); await Promise.resolve(); await Promise.resolve() })
    expect(container.querySelector('.app-update-card')?.textContent).toContain('当前已是最新版本 0.1.0')
  })

  it('shows progress and the official Release fallback when installation cannot start', async () => {
    vi.useFakeTimers()
    checkForUpdates.mockResolvedValueOnce(nextRelease)
    downloadAndInstallUpdate.mockImplementationOnce(async () => {
      updateProgressListener?.({ status: 'downloading', channel: 'GitHub', received: 50, total: 100, percent: 50 })
      return { ok: false, error: 'GitHub 下载失败（HTTP 503）。', releaseUrl: nextRelease.release.htmlUrl }
    })
    act(() => root.render(<App/>)); await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    const download = [...container.querySelectorAll<HTMLButtonElement>('.update-dialog button')].find((button) => button.textContent === '立即更新')!
    await act(async () => { download.click(); await Promise.resolve(); await Promise.resolve() })

    expect(container.querySelector('.update-dialog')?.textContent).toContain('GitHub 下载失败（HTTP 503）。')
    expect([...container.querySelectorAll<HTMLButtonElement>('.update-dialog button')].some((button) => button.textContent === '打开 GitHub Release')).toBe(true)
  })
})

describe('community support entry', () => {
  it('copies the QQ group number and opens the original payment code in an optional support dialog', async () => {
    act(() => root.render(<App/>)); await settle()
    const settingsButton = [...container.querySelectorAll<HTMLButtonElement>('.studio-nav button')].find((button) => button.textContent === '设置')!
    await act(async () => { settingsButton.click(); await Promise.resolve() })

    const card = container.querySelector<HTMLElement>('.community-support-card')!
    expect(card.textContent).toContain('免费开源，欢迎交流学习 AI')
    const join = [...card.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '加入 QQ 群 1091142340')!
    await act(async () => { join.click(); await Promise.resolve() })
    expect(copyCommunityGroupNumber).toHaveBeenCalledOnce()
    expect(card.textContent).toContain('QQ群号已复制')

    const support = [...card.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '请作者喝杯咖啡')!
    await act(async () => { support.click(); await Promise.resolve() })
    const dialog = container.querySelector<HTMLElement>('.community-support-dialog')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.textContent).toContain('支持与否都欢迎使用')
    expect(dialog.querySelector<HTMLImageElement>('img')?.alt).toBe('微信赞助收款码')

    await act(async () => { dialog.querySelector<HTMLButtonElement>('[aria-label="关闭赞助弹窗"]')!.click(); await Promise.resolve() })
    expect(container.querySelector('.community-support-dialog')).toBeNull()
  })
})
