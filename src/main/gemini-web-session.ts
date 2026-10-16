import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { browserLaunchArguments, DevToolsClient, findBrowserExecutable, findOpenPort, waitForDevTools, toElectronCookie, type ChromeCookie } from './chatgpt-browser-login'
import type { WebContents } from 'electron'
import { readAIStudioSnapshot } from './ai-studio-page-dom'
import { installChatGPTMicrophoneGate } from './chatgpt-microphone-input'
import type { MicrophoneInputSelection, TranscriptEvent } from '../shared/types'

const LIVE_URL = 'https://aistudio.google.com/live?model=gemini-3.8-live'
type Target = { id: string; type: string; url: string; webSocketDebuggerUrl: string }
type Evaluation<T> = { result: { value: T }; exceptionDetails?: unknown }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
function normalizedText(value: string): string { return value.replace(/\s+/g, ' ').trim() }
export function selectAIStudioLoginCookies(cookies: ChromeCookie[]): ChromeCookie[] {
  return cookies.filter(cookie => cookie.secure && !cookie.partitionKey && ['google.com', 'aistudio.google.com'].includes(cookie.domain.replace(/^\./, '').toLowerCase()))
}
type EmbeddedHost = { contents: () => WebContents; show: () => void; hide: () => void }

export class GeminiWebSession {
  private port?: number
  private browser?: DevToolsClient
  private page?: DevToolsClient
  private targetId?: string
  private timer?: ReturnType<typeof setInterval>
  private reading = false
  private captureGeneration = 0
  private epoch = ''
  private previousDocument?: number
  private previousCount = 0
  private seen = new Map<string, string>()
  private failures = 0
  private onEvent?: (event: Omit<TranscriptEvent, 'id' | 'sessionId'>) => void
  private onWarning?: (message: string) => void
  private selection?: MicrophoneInputSelection
  private microphoneActive = false
  private missing = 0

  constructor(private readonly userData: string, private readonly legacyStatePath?: string, private readonly embedded?: EmbeddedHost) {}

  private async targets(): Promise<Target[]> {
    return await fetch(`http://127.0.0.1:${this.port}/json/list`, { signal: AbortSignal.timeout(2000) }).then(response => response.json()) as Target[]
  }

  private async connectBrowser(): Promise<void> {
    if (this.browser) {
      try { await this.targets(); return } catch { this.browser.close(); this.browser = undefined; this.page?.close(); this.page = undefined }
    }
    const profile = join(this.userData, 'ai-studio-login-browser')
    const statePath = join(this.userData, 'ai-studio-browser-state.json')
    mkdirSync(profile, { recursive: true })
    for (const path of [statePath, this.legacyStatePath]) {
      if (!path || !existsSync(path)) continue
      try {
        const saved = JSON.parse(readFileSync(path, 'utf8')) as { port?: number; profile?: string }
        if (saved.profile !== profile || !Number.isInteger(saved.port) || saved.port! < 1024 || saved.port! > 65535) continue
        this.port = saved.port
        const targets = await this.targets()
        if (!targets.some(target => target.type === 'page' && /^https:\/\/(?:aistudio|accounts)\.google\.com\//.test(target.url))) continue
        const version = await waitForDevTools(this.port!)
        this.browser = await DevToolsClient.connect(version.webSocketDebuggerUrl)
        writeFileSync(statePath, JSON.stringify({ port: this.port, profile }), 'utf8')
        return
      } catch { /* A prior dedicated browser may have been closed. */ }
    }
    this.port = await findOpenPort()
    const child = spawn(findBrowserExecutable(), browserLaunchArguments(profile, this.port, LIVE_URL), { stdio: 'ignore', detached: true, windowsHide: false })
    child.unref()
    const version = await waitForDevTools(this.port)
    this.browser = await DevToolsClient.connect(version.webSocketDebuggerUrl)
    writeFileSync(statePath, JSON.stringify({ port: this.port, profile }), 'utf8')
  }

  async open(): Promise<void> {
    if (this.embedded) {
      this.embedded.show()
      if (!this.embedded.contents().getURL().startsWith('https://aistudio.google.com/live')) await this.embedded.contents().loadURL(LIVE_URL)
      return
    }
    await this.connectBrowser()
    const targets = await this.targets()
    const target = targets.find(candidate => candidate.id === this.targetId) ?? targets.find(candidate => candidate.type === 'page' && candidate.url.startsWith('https://aistudio.google.com/'))
    if (target) await this.browser!.command('Target.activateTarget', { targetId: target.id })
    else await this.browser!.command('Target.createTarget', { url: LIVE_URL })
  }

  private async evaluate<T>(expression: string): Promise<T> {
    const script = `(() => { if (location.origin !== 'https://aistudio.google.com' || location.pathname !== '/live') throw new Error('请在应用内登录并打开 AI Studio Live 页面。'); return (${expression}); })()`
    if (this.embedded) return await this.embedded.contents().executeJavaScript(script) as T
    if (!this.page) throw new Error('Gemini 网页尚未连接。')
    const response = await this.page.command<Evaluation<T>>('Runtime.evaluate', {
      expression: script,
      returnByValue: true, awaitPromise: true, timeout: 5000
    })
    if (response.exceptionDetails) throw new Error('无法操作 Gemini Live 网页，请打开 Gemini 窗口检查登录、网络或页面状态。')
    return response.result.value
  }

  async prepare(signal: AbortSignal, selection: MicrophoneInputSelection, microphoneActive: boolean): Promise<void> {
    const check = (): void => { if (signal.aborted) throw new Error('已取消 Gemini 启动。') }
    check()
    if (this.embedded) {
      this.muteOutput()
      this.embedded.show()
      await this.embedded.contents().loadURL(LIVE_URL)
      for (let attempt = 0; attempt < 60; attempt++) {
        check()
        try {
          if (await this.evaluate<boolean>(`Boolean(document.querySelector('ms-bidi-ui textarea'))`)) {
            this.selection = selection; this.microphoneActive = microphoneActive
            await this.installMicrophone(); check()
            this.embedded.contents().setAudioMuted(false)
            return
          }
        } catch { /* Main-frame authentication/navigation is still underway. */ }
        await delay(350)
      }
      throw new Error('请打开 Gemini 连接页，点击“使用 Google 登录 Gemini”完成浏览器登录，再重新开始。')
    }
    await this.connectBrowser(); check()
    // A new tab preserves earlier conversations and gives each practice its own
    // capture epoch. Never clear an existing Live conversation to start another.
    const target = await this.browser!.command<{ targetId: string }>('Target.createTarget', { url: LIVE_URL })
    this.targetId = target.targetId
    this.page?.close(); this.page = undefined
    for (let attempt = 0; attempt < 60; attempt++) {
      check()
      const page = (await this.targets()).find(candidate => candidate.id === this.targetId)
      if (page?.webSocketDebuggerUrl) {
        const endpoint = new URL(page.webSocketDebuggerUrl)
        if (endpoint.hostname !== '127.0.0.1' || Number(endpoint.port) !== this.port) throw new Error('Gemini 浏览器连接地址无效。')
        this.page ??= await DevToolsClient.connect(endpoint.toString())
        try {
          if (await this.evaluate<boolean>(`Boolean(document.querySelector('ms-bidi-ui textarea'))`)) {
            check()
            this.selection = selection; this.microphoneActive = microphoneActive
            await this.installMicrophone()
            check(); return
          }
        } catch { /* Google sign-in or document startup can still be underway. */ }
      }
      await delay(350)
    }
    throw new Error('请先在弹出的 Chrome 窗口完成 Google 登录，再回到 SpeakHub 重新开始 Gemini 练习。')
  }

  private async installMicrophone(): Promise<void> {
    await this.evaluate(`(() => {
      const result = (${installChatGPTMicrophoneGate.toString()})(); if (!result.ok) throw new Error(result.message);
      window.__speaksubMicrophoneGate.setInputDevice(${JSON.stringify(this.selection)});
      window.__speaksubMicrophoneGate.setActive(${this.microphoneActive});
      if (!window.__speaksubGeminiVoiceInputReady) {
        const tracks = new Set(); const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async constraints => { const stream = await original(constraints); stream.getAudioTracks().forEach(track => tracks.add(track)); return stream; };
        window.__speaksubGeminiVoiceInputReady = () => [...tracks].some(track => track.readyState === 'live');
      }
      return true;
    })()`)
  }

  async setMicrophone(active: boolean): Promise<void> {
    this.microphoneActive = active
    if (this.page || this.embedded) await this.installMicrophone()
  }

  async send(text: string, reuseMatchingDraft = false): Promise<void> {
    const freePage = await this.evaluate<boolean>(`Boolean(document.querySelector('ms-paid-api-key-button button[aria-label="No API key selected"]'))`)
    if (!freePage) throw new Error('Gemini 网页未确认处于“未选择 API Key”状态。请打开网页切回免费体验，再发送；SpeakHub 不会代你启用付费 Key。')
    const sent = await this.evaluate<'empty' | 'matching' | false>(`(() => {
      const input = document.querySelector('ms-bidi-input textarea');
      const button = document.querySelector('ms-run-button button');
      if (!input || input.disabled || !button) return false;
      if (input.value.trim()) {
        if (${reuseMatchingDraft} && (${normalizedText.toString()})(input.value) === ${JSON.stringify(normalizedText(text))}) { input.focus(); return 'matching'; }
        throw new Error('Gemini 输入框已有草稿，请先处理草稿。');
      }
      input.focus();
      return 'empty';
    })()`)
    if (!sent) throw new Error('Gemini 输入框尚不可用，请在网页检查登录或结束上一次语音。')
    if (sent === 'empty') await this.inputCommand('Input.insertText', { text })
    for (let attempt = 0; attempt < 20; attempt++) {
      const clicked = await this.clickControl('ms-run-button button')
      if (clicked) {
        let warned = false
        for (let verify = 0; verify < 480; verify++) {
          const acknowledgement = await this.evaluate<boolean>(`Boolean(document.querySelector('button[aria-label="Agree to the copyright acknowledgement"]')?.getClientRects().length)`)
          if (acknowledgement && !warned) { warned = true; this.embedded?.show(); this.onWarning?.('Google 网页要求版权确认，请在应用内 Gemini 连接页亲自阅读并处理；SpeakHub 不会代你接受。') }
          const accepted = await this.evaluate<boolean>(`(${readAIStudioSnapshot.toString()})(document).rows.some(row => row.speaker === 'user' && (${normalizedText.toString()})(row.text) === ${JSON.stringify(normalizedText(text))})`)
          if (accepted) return
          await delay(250)
        }
        throw new Error(warned ? 'Google 网页确认尚未完成。请重新开始后在 Gemini 连接页亲自处理版权提示；SpeakHub 不会代你接受。' : 'Gemini 尚未确认收到提示词，请检查网页；程序不会重复发送。')
      }
      await delay(100)
    }
    throw new Error('Gemini 发送按钮不可用，请检查网页。')
  }

  private async clickControl(selector: string): Promise<boolean> {
    const point = await this.evaluate<{ x: number; y: number } | null>(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return null; const rect = button.getBoundingClientRect(); if (!rect.width || !rect.height) return null; return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`)
    if (!point) return false
    await this.inputCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await this.inputCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    return true
  }

  private async inputCommand(method: string, params: Record<string, unknown>): Promise<void> {
    if (!this.embedded) { await this.page!.command(method, params); return }
    const contents = this.embedded.contents()
    // Native window input requires a focused/visible parent. CDP routes trusted
    // input to this exact renderer even while its BaseWindow is hidden.
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
    await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await contents.debugger.sendCommand(method, params)
  }

  hide(): void { this.embedded?.hide() }

  async importLogin(): Promise<void> {
    if (!this.embedded) throw new Error('Gemini 内嵌页面尚未创建。')
    await this.connectBrowser()
    const deadline = Date.now() + 5 * 60_000
    let verified = false
    while (Date.now() < deadline) {
      const target = (await this.targets()).find(candidate => candidate.type === 'page' && candidate.url.startsWith('https://aistudio.google.com/live'))
      if (target) {
        const page = await DevToolsClient.connect(target.webSocketDebuggerUrl)
        try {
          const state = await page.command<Evaluation<boolean>>('Runtime.evaluate', { expression: `location.origin === 'https://aistudio.google.com' && !!document.querySelector('ms-bidi-ui textarea') && !!document.querySelector('ms-account-switcher')`, returnByValue: true })
          verified = state.result.value === true
        } finally { page.close() }
      }
      if (verified) break
      await delay(1000)
    }
    if (!verified) throw new Error('等待 Google 登录超时，请重新打开登录窗口。')
    const { cookies } = await this.browser!.command<{ cookies: ChromeCookie[] }>('Storage.getCookies')
    const selected = selectAIStudioLoginCookies(cookies)
    if (!selected.length) throw new Error('尚未取得 AI Studio 所需的登录会话。')
    const contents = this.embedded.contents()
    const { userAgent } = await this.browser!.command<{ userAgent: string }>('Browser.getVersion')
    contents.setUserAgent(userAgent)
    for (const cookie of selected) await contents.session.cookies.set(toElectronCookie(cookie))
    contents.session.flushStorageData()
    await contents.session.cookies.flushStore()
    await contents.loadURL(LIVE_URL)
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        if (await this.evaluate<boolean>(`Boolean(document.querySelector('ms-bidi-ui textarea') && document.querySelector('ms-account-switcher'))`)) {
          this.embedded.show()
          await this.browser!.command('Browser.close').catch(() => undefined)
          this.browser?.close(); this.browser = undefined
          return
        }
      } catch { /* Validate the embedded page, not cookie presence alone. */ }
      await delay(300)
    }
    throw new Error('浏览器已登录，但应用内 Gemini 尚未就绪，请刷新连接页后重试。')
  }

  startCapture(onEvent: NonNullable<GeminiWebSession['onEvent']>, onWarning: NonNullable<GeminiWebSession['onWarning']>): void {
    this.stopCapture()
    this.epoch = randomUUID(); this.previousDocument = undefined; this.previousCount = 0; this.missing = 0; this.failures = 0; this.seen.clear()
    this.onEvent = onEvent; this.onWarning = onWarning
    this.timer = setInterval(() => void this.drain(), 350)
    void this.drain()
  }

  stopCapture(): void {
    clearInterval(this.timer); this.timer = undefined; this.captureGeneration += 1
  }

  private async snapshot() {
    return this.evaluate<ReturnType<typeof readAIStudioSnapshot> & { document: number }>(`({ ...(${readAIStudioSnapshot.toString()})(document), document: performance.timeOrigin })`)
  }

  private async drain(forceComplete = false): Promise<void> {
    if (this.reading) return
    this.reading = true
    const generation = this.captureGeneration
    try {
      const snapshot = await this.snapshot()
      if (generation !== this.captureGeneration) return
      this.failures = 0
      if ((this.previousDocument !== undefined && snapshot.document !== this.previousDocument) || snapshot.turnCount < this.previousCount) {
        this.epoch = randomUUID(); this.seen.clear()
        this.onWarning?.('Gemini 网页已重新加载或重置，新内容将作为新的对话片段保存。')
        await this.installMicrophone()
      }
      this.previousDocument = snapshot.document; this.previousCount = snapshot.turnCount
      if (snapshot.emptyUserTurns > this.missing) this.onWarning?.(`Gemini 网页有 ${snapshot.emptyUserTurns} 条用户语音缺少文字；已保存其余内容，复盘可能不完整。`)
      this.missing = snapshot.emptyUserTurns
      for (const row of snapshot.rows) {
        const sourceMessageId = `gemini-${this.epoch}-${row.sourceMessageId}`
        const status = forceComplete ? 'complete' : row.status
        const signature = `${status}\0${row.text}`
        if (this.seen.get(sourceMessageId) === signature) continue
        this.seen.set(sourceMessageId, signature)
        this.onEvent?.({ ...row, sourceMessageId, status, interrupted: forceComplete && row.status === 'streaming' ? true : undefined, receivedAt: new Date().toISOString() })
      }
    } catch (error) {
      if (generation === this.captureGeneration && ++this.failures === 5) this.onWarning?.(error instanceof Error ? error.message : 'Gemini 网页采集暂时失败。')
    } finally { this.reading = false }
  }

  async enableVoice(): Promise<boolean> {
    // Clicking this normal page control can show Chrome's permission prompt.
    if (!await this.clickControl('[data-test="microphone-tooltip"]')) return false
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await this.evaluate<boolean>('Boolean(window.__speaksubGeminiVoiceInputReady?.())')) return true
      await delay(200)
    }
    return false
  }

  muteOutput(): void {
    if (!this.embedded) return
    const contents = this.embedded.contents()
    if (!contents.isDestroyed()) contents.setAudioMuted(true)
  }

  async pauseAndFlush(): Promise<void> {
    this.muteOutput()
    this.stopCapture()
    await this.setMicrophone(false).catch(() => undefined)
    await this.clickControl('ms-bidi-turn .streaming-output button[aria-label="Stop"]').catch(() => undefined)
    while (this.reading) await delay(30)
    await this.drain(true)
  }

  async disconnect(): Promise<void> {
    this.muteOutput()
    this.stopCapture()
    await this.setMicrophone(false).catch(() => undefined)
    await this.clickControl('button[aria-label="Disconnect"]').catch(() => undefined)
  }

  async cancel(): Promise<void> {
    await this.disconnect()
    if (this.embedded) { this.embedded.contents().stop(); return }
    if (this.browser && this.targetId) await this.browser.command('Target.closeTarget', { targetId: this.targetId }).catch(() => undefined)
    this.page?.close(); this.page = undefined; this.targetId = undefined
  }
}
