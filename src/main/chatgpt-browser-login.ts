import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { Session } from 'electron'
import WebSocket, { type RawData } from 'ws'

const CHATGPT_LOGIN_URL = 'https://chatgpt.com/auth/login'
const LOGIN_TIMEOUT_MS = 5 * 60_000
const DEBUGGER_START_TIMEOUT_MS = 20_000
const SESSION_COOKIE_PATTERN = /^__Secure-(?:next-auth|authjs)\.session-token(?:\.\d+)?$/

export type ChromeCookie = {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  partitionKey?: unknown
}

type DevToolsVersion = {
  webSocketDebuggerUrl: string
}

type BrowserVersion = {
  userAgent?: string
}

type CookieResponse = {
  cookies: ChromeCookie[]
}

export type BrowserTargetInfo = {
  type: string
  url: string
}

type TargetResponse = {
  targetInfos: BrowserTargetInfo[]
}

export type ImportedChatGptLogin = {
  cookieCount: number
  skippedCookieCount: number
  userAgent?: string
}

type PendingCommand = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

class DevToolsClient {
  private nextId = 1
  private readonly pending = new Map<number, PendingCommand>()

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => this.receive(data))
    socket.on('close', () => this.rejectPending(new Error('登录浏览器已关闭。')))
    socket.on('error', (error) => this.rejectPending(error))
  }

  static connect(url: string): Promise<DevToolsClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      const onError = (error: Error): void => reject(error)
      socket.once('error', onError)
      socket.once('open', () => {
        socket.off('error', onError)
        resolve(new DevToolsClient(socket))
      })
    })
  }

  command<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      })
      this.socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  close(): void {
    this.socket.close()
  }

  private receive(data: RawData): void {
    let message: { id?: number; result?: unknown; error?: { message?: string } }
    try {
      message = JSON.parse(data.toString()) as typeof message
    } catch {
      return
    }
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(new Error(message.error.message ?? '浏览器认证命令失败。'))
      return
    }
    pending.resolve(message.result)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

export function isChatGptCookieDomain(domain: string): boolean {
  const normalized = domain.trim().replace(/^\./, '').toLowerCase()
  return normalized === 'chatgpt.com' || normalized.endsWith('.chatgpt.com')
}

export function hasChatGptSessionCookie(cookies: ChromeCookie[]): boolean {
  return cookies.some((cookie) => isChatGptCookieDomain(cookie.domain) && SESSION_COOKIE_PATTERN.test(cookie.name))
}

function isAuthenticationFlowUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.hostname === 'auth.openai.com' || url.hostname === 'accounts.google.com') return true
    return url.hostname === 'chatgpt.com' && (url.pathname === '/auth' || url.pathname.startsWith('/auth/'))
  } catch {
    return false
  }
}

export function hasCompletedChatGptLogin(targets: BrowserTargetInfo[]): boolean {
  const pages = targets.filter((target) => target.type === 'page')
  if (pages.some((target) => isAuthenticationFlowUrl(target.url))) return false
  return pages.some((target) => {
    try {
      const url = new URL(target.url)
      return url.protocol === 'https:' && url.hostname === 'chatgpt.com' && url.pathname !== '/auth' && !url.pathname.startsWith('/auth/')
    } catch {
      return false
    }
  })
}

export function selectChatGptCookiesForImport(cookies: ChromeCookie[]): ChromeCookie[] {
  const selected = new Map<string, ChromeCookie>()
  for (const cookie of cookies) {
    if (!cookie.secure || !isChatGptCookieDomain(cookie.domain)) continue
    const key = `${cookie.name}\u0000${cookie.domain.toLowerCase()}\u0000${cookie.path}`
    const current = selected.get(key)
    if (!current || (current.partitionKey && !cookie.partitionKey)) selected.set(key, cookie)
  }
  return [...selected.values()]
}

export function toElectronCookie(cookie: ChromeCookie): Electron.CookiesSetDetails {
  const host = cookie.domain.replace(/^\./, '')
  const hostPrefixed = cookie.name.startsWith('__Host-')
  const path = hostPrefixed ? '/' : cookie.path.startsWith('/') ? cookie.path : '/'
  const domainCookie = cookie.domain.startsWith('.') && !hostPrefixed
  const sameSite = cookie.sameSite === 'Strict'
    ? 'strict'
    : cookie.sameSite === 'Lax'
      ? 'lax'
      : cookie.sameSite === 'None'
        ? 'no_restriction'
        : undefined
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${host}${path}`,
    name: cookie.name,
    value: cookie.value,
    path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(domainCookie ? { domain: cookie.domain } : {}),
    ...(cookie.expires > 0 ? { expirationDate: cookie.expires } : {}),
    ...(sameSite ? { sameSite } : {})
  }
}

export function browserExecutableCandidates(environment: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [
    environment.LOCALAPPDATA,
    environment.PROGRAMFILES,
    environment['PROGRAMFILES(X86)']
  ].filter((value): value is string => Boolean(value))
  const relativePaths = [
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Microsoft', 'Edge', 'Application', 'msedge.exe']
  ]
  return roots.flatMap((root) => relativePaths.map((segments) => join(root, ...segments)))
}

export function browserLaunchArguments(profileDirectory: string, port: number): string[] {
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    CHATGPT_LOGIN_URL
  ]
}

function findBrowserExecutable(): string {
  const executable = browserExecutableCandidates().find((candidate) => existsSync(candidate))
  if (!executable) throw new Error('没有找到 Google Chrome 或 Microsoft Edge。请先安装其中一个浏览器。')
  return executable
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function findOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('无法为登录浏览器分配本地端口。'))
        return
      }
      const port = address.port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`登录浏览器尚未准备好（HTTP ${response.statusCode ?? 'unknown'}）。`))
        return
      }
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)
        } catch {
          reject(new Error('无法读取登录浏览器状态。'))
        }
      })
    })
    request.setTimeout(1_000, () => request.destroy(new Error('登录浏览器连接超时。')))
    request.once('error', reject)
  })
}

async function waitForDevTools(port: number): Promise<DevToolsVersion> {
  const deadline = Date.now() + DEBUGGER_START_TIMEOUT_MS
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const version = await fetchJson<DevToolsVersion>(`http://127.0.0.1:${port}/json/version`)
      if (version.webSocketDebuggerUrl) return version
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw lastError instanceof Error ? lastError : new Error('登录浏览器启动超时。')
}

async function waitForChatGptCookies(client: DevToolsClient): Promise<ChromeCookie[]> {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS
  let previousSessionSignature: string | undefined
  while (Date.now() < deadline) {
    const [result, targets] = await Promise.all([
      client.command<CookieResponse>('Storage.getCookies'),
      client.command<TargetResponse>('Target.getTargets')
    ])
    if (hasChatGptSessionCookie(result.cookies) && hasCompletedChatGptLogin(targets.targetInfos)) {
      const signature = result.cookies
        .filter((cookie) => isChatGptCookieDomain(cookie.domain) && SESSION_COOKIE_PATTERN.test(cookie.name))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((cookie) => `${cookie.name}:${cookie.value}`)
        .join('|')
      if (signature === previousSessionSignature) return selectChatGptCookiesForImport(result.cookies)
      previousSessionSignature = signature
    } else {
      previousSessionSignature = undefined
    }
    await delay(1_000)
  }
  throw new Error('等待 Google 登录超时。请重试并在五分钟内完成登录。')
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function closeLoginBrowser(client: DevToolsClient | undefined, child: ChildProcess | undefined): Promise<void> {
  if (client) {
    await client.command('Browser.close').catch(() => undefined)
    client.close()
  }
  if (!child || child.exitCode !== null) return
  await waitForExit(child, 3_000)
  if (child.exitCode === null) {
    child.kill()
    await waitForExit(child, 2_000)
  }
}

async function removeBrowserProfile(profileDirectory: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profileDirectory, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      await delay(300)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('无法删除 SpeakHub 保存的浏览器登录资料。')
}

export async function clearSavedChatGptBrowserLogin(profileDirectory: string): Promise<void> {
  await removeBrowserProfile(profileDirectory)
}

export async function importChatGptLoginFromBrowser(webSession: Session, profileDirectory: string): Promise<ImportedChatGptLogin> {
  const executable = findBrowserExecutable()
  await mkdir(profileDirectory, { recursive: true })
  const port = await findOpenPort()
  let child: ChildProcess | undefined
  let client: DevToolsClient | undefined
  try {
    child = spawn(executable, browserLaunchArguments(profileDirectory, port), {
      stdio: 'ignore',
      windowsHide: false
    })
    const devTools = await waitForDevTools(port)
    client = await DevToolsClient.connect(devTools.webSocketDebuggerUrl)
    const browserVersion = await client.command<BrowserVersion>('Browser.getVersion')
    const cookies = await waitForChatGptCookies(client)
    const sessionCookies = cookies.filter((cookie) => SESSION_COOKIE_PATTERN.test(cookie.name))
    const optionalCookies = cookies.filter((cookie) => !SESSION_COOKIE_PATTERN.test(cookie.name))
    for (const cookie of sessionCookies) await webSession.cookies.set(toElectronCookie(cookie))
    let skippedCookieCount = 0
    for (const cookie of optionalCookies) {
      try {
        await webSession.cookies.set(toElectronCookie(cookie))
      } catch {
        skippedCookieCount += 1
      }
    }
    webSession.flushStorageData()
    return {
      cookieCount: sessionCookies.length + optionalCookies.length - skippedCookieCount,
      skippedCookieCount,
      userAgent: browserVersion.userAgent
    }
  } finally {
    await closeLoginBrowser(client, child)
  }
}
