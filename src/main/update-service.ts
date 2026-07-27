import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AvailableUpdateInfo, UpdateDownloadProgress, UpdateInstallResult } from '../shared/types'

const RELEASE_API_URL = 'https://api.github.com/repos/yin-yizhen/SpeakHub/releases/latest'
const RELEASE_PAGE_PREFIX = '/yin-yizhen/speakhub/releases'
const DOWNLOAD_PATH_PREFIX = '/yin-yizhen/speakhub/releases/download/'
const DOWNLOAD_MIRRORS = [
  { name: 'GH Proxy', prefix: 'https://gh-proxy.com/' },
  { name: 'GHFast', prefix: 'https://ghfast.top/' }
]
const CONNECT_TIMEOUT_MS = 20_000
const STALL_TIMEOUT_MS = 30_000

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface GithubAsset {
  name?: unknown
  size?: unknown
  digest?: unknown
  browser_download_url?: unknown
}

interface GithubRelease {
  tag_name?: unknown
  name?: unknown
  body?: unknown
  published_at?: unknown
  html_url?: unknown
  assets?: unknown
}

export interface ResolvedAsset {
  name: string
  size: number
  digest: string
  downloadUrl: string
}

interface ResolvedUpdate {
  info: AvailableUpdateInfo
  asset?: ResolvedAsset
}

export interface UpdateServiceOptions {
  currentVersion: string
  downloadDirectory: string
  fetcher?: Fetcher
  openPath: (filePath: string) => Promise<string>
  openExternal: (url: string) => Promise<void>
  connectTimeoutMs?: number
  stallTimeoutMs?: number
}

function normalizeVersion(value: unknown): string {
  const normalized = String(value ?? '').trim().replace(/^v/i, '')
  return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized : ''
}

export function compareVersions(leftValue: unknown, rightValue: unknown): number {
  const left = normalizeVersion(leftValue)
  const right = normalizeVersion(rightValue)
  if (!left || !right) throw new Error('版本号必须使用 x.y.z 格式。')
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index]
    if (difference !== 0) return difference
  }
  return 0
}

function validReleaseUrl(value: unknown): string {
  try {
    const url = new URL(String(value ?? ''))
    const pathname = url.pathname.toLowerCase()
    return url.protocol === 'https:' && url.hostname === 'github.com'
      && (pathname === RELEASE_PAGE_PREFIX || pathname.startsWith(`${RELEASE_PAGE_PREFIX}/`))
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}

function validDownloadUrl(value: unknown): string {
  try {
    const url = new URL(String(value ?? ''))
    return url.protocol === 'https:' && url.hostname === 'github.com'
      && url.pathname.toLowerCase().startsWith(DOWNLOAD_PATH_PREFIX)
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}

function sha256Digest(value: unknown): string {
  const digest = String(value ?? '').trim().toLowerCase()
  return /^sha256:[a-f0-9]{64}$/.test(digest) ? digest.slice('sha256:'.length) : ''
}

function safeFileName(value: unknown): string {
  const name = String(value ?? 'SpeakHub-Update-Setup.exe').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
  return name.toLowerCase().endsWith('.exe') ? name : `${name}.exe`
}

function pickInstaller(assets: unknown, latestVersion: string): ResolvedAsset | undefined {
  const candidates = (Array.isArray(assets) ? assets : [])
    .map((asset) => asset as GithubAsset)
    .filter((asset) => /\.exe$/i.test(String(asset.name ?? '')) && validDownloadUrl(asset.browser_download_url))
  const selected = candidates.find((asset) => /setup|installer/i.test(String(asset.name ?? '')))
    ?? candidates.find((asset) => String(asset.name ?? '').includes(latestVersion))
    ?? candidates[0]
  if (!selected) return undefined
  return {
    name: safeFileName(selected.name),
    size: Math.max(0, Number(selected.size) || 0),
    digest: sha256Digest(selected.digest),
    downloadUrl: validDownloadUrl(selected.browser_download_url)
  }
}

export function parseGithubRelease(value: unknown, currentVersionValue: string): ResolvedUpdate {
  const currentVersion = normalizeVersion(currentVersionValue)
  if (!currentVersion) throw new Error('当前应用版本号无效。')
  const release = (value && typeof value === 'object' ? value : {}) as GithubRelease
  const latestVersion = normalizeVersion(release.tag_name)
  if (!latestVersion) throw new Error('GitHub Release tag 必须使用 vX.Y.Z 格式。')
  const htmlUrl = validReleaseUrl(release.html_url)
  if (!htmlUrl) throw new Error('GitHub Release 地址无效。')
  const asset = pickInstaller(release.assets, latestVersion)
  return {
    info: {
      configured: true,
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      release: {
        tagName: String(release.tag_name ?? `v${latestVersion}`),
        name: String(release.name ?? '').trim() || `SpeakHub v${latestVersion}`,
        publishedAt: String(release.published_at ?? ''),
        notes: String(release.body ?? ''),
        htmlUrl
      },
      asset: asset ? { name: asset.name, size: asset.size } : undefined
    },
    asset
  }
}

export function buildDownloadCandidates(asset: ResolvedAsset): Array<{ name: string; url: string }> {
  const candidates = [{ name: 'GitHub', url: asset.downloadUrl }]
  if (!asset.digest) return candidates
  for (const mirror of DOWNLOAD_MIRRORS) candidates.push({ name: mirror.name, url: `${mirror.prefix}${asset.downloadUrl}` })
  return candidates
}

function progressPayload(status: UpdateDownloadProgress['status'], channel: string, received: number, total: number, message?: string): UpdateDownloadProgress {
  return {
    status,
    channel,
    received,
    total,
    percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : undefined,
    message
  }
}

export class UpdateService {
  private latest?: ResolvedUpdate
  private downloading = false
  private readonly fetcher: Fetcher

  constructor(private readonly options: UpdateServiceOptions) {
    this.fetcher = options.fetcher ?? fetch
  }

  async check(): Promise<AvailableUpdateInfo> {
    const response = await this.fetcher(RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'SpeakHubUpdater'
      }
    })
    if (response.status === 404) {
      const currentVersion = normalizeVersion(this.options.currentVersion)
      this.latest = undefined
      return {
        configured: true,
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        message: 'GitHub 上还没有可用的正式版本。'
      }
    }
    if (!response.ok) throw new Error(`检查更新失败（GitHub ${response.status}）。`)
    this.latest = parseGithubRelease(await response.json(), this.options.currentVersion)
    if (this.latest.info.updateAvailable && !this.latest.asset) {
      this.latest.info.message = '发现新版本，但 Release 中没有 Windows 安装包。'
    }
    return this.latest.info
  }

  async downloadAndInstall(onProgress: (progress: UpdateDownloadProgress) => void): Promise<UpdateInstallResult> {
    if (this.downloading) return { ok: false, error: '更新安装包正在下载，请稍候。', releaseUrl: this.latest?.info.release?.htmlUrl }
    this.downloading = true
    try {
      if (!this.latest) await this.check()
      const resolved = this.latest
      if (!resolved?.info.updateAvailable) return { ok: false, error: '当前已经是最新版本。', releaseUrl: resolved?.info.release?.htmlUrl }
      if (!resolved.asset) return { ok: false, error: 'Release 中没有可下载的 Windows 安装包。', releaseUrl: resolved.info.release?.htmlUrl }
      await mkdir(this.options.downloadDirectory, { recursive: true })
      const filePath = join(this.options.downloadDirectory, resolved.asset.name)
      const tempPath = `${filePath}.download`
      let lastError = '下载安装包失败。'
      for (const candidate of buildDownloadCandidates(resolved.asset)) {
        await rm(tempPath, { force: true }).catch(() => undefined)
        await rm(filePath, { force: true }).catch(() => undefined)
        try {
          onProgress(progressPayload('connecting', candidate.name, 0, resolved.asset.size))
          await this.downloadCandidate(candidate, resolved.asset, tempPath, onProgress)
          onProgress(progressPayload('verifying', candidate.name, resolved.asset.size, resolved.asset.size, '正在验证安装包…'))
          await this.validateInstaller(tempPath, resolved.asset)
          await rename(tempPath, filePath)
          onProgress(progressPayload('ready', candidate.name, resolved.asset.size, resolved.asset.size, '安装包已验证。'))
          const openError = await this.options.openPath(filePath)
          if (openError) return { ok: false, error: `无法打开安装程序：${openError}`, releaseUrl: resolved.info.release?.htmlUrl }
          return { ok: true, releaseUrl: resolved.info.release?.htmlUrl }
        } catch (error) {
          lastError = error instanceof Error ? error.message : '下载安装包失败。'
          await rm(tempPath, { force: true }).catch(() => undefined)
          await rm(filePath, { force: true }).catch(() => undefined)
        }
      }
      onProgress(progressPayload('failed', '', 0, resolved.asset.size, lastError))
      return { ok: false, error: lastError, releaseUrl: resolved.info.release?.htmlUrl }
    } finally {
      this.downloading = false
    }
  }

  async openRelease(): Promise<UpdateInstallResult> {
    const url = this.latest?.info.release?.htmlUrl ?? 'https://github.com/yin-yizhen/SpeakHub/releases/latest'
    if (!validReleaseUrl(url)) return { ok: false, error: '更新页面地址无效。' }
    try {
      await this.options.openExternal(url)
      return { ok: true, releaseUrl: url }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '无法打开更新页面。', releaseUrl: url }
    }
  }

  private async downloadCandidate(
    candidate: { name: string; url: string },
    asset: ResolvedAsset,
    tempPath: string,
    onProgress: (progress: UpdateDownloadProgress) => void
  ): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS)
    let response: Response
    try {
      try {
        response = await this.fetcher(candidate.url, {
          headers: { 'User-Agent': 'SpeakHubUpdater' },
          signal: controller.signal
        })
      } catch (error) {
        if (controller.signal.aborted) throw new Error(`${candidate.name} 连接超时。`)
        throw error
      }
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok) throw new Error(`${candidate.name} 下载失败（HTTP ${response.status}）。`)
    const reader = response.body?.getReader()
    if (!reader) throw new Error(`${candidate.name} 没有返回可读取的安装包。`)
    const handle = await open(tempPath, 'w')
    let received = 0
    try {
      while (true) {
        let stallTimer: ReturnType<typeof setTimeout> | undefined
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            stallTimer = setTimeout(() => {
              controller.abort()
              reject(new Error(`${candidate.name} 下载长时间没有数据。`))
            }, this.options.stallTimeoutMs ?? STALL_TIMEOUT_MS)
          })
        ]).finally(() => clearTimeout(stallTimer))
        if (result.done) break
        const chunk = Buffer.from(result.value)
        if (!chunk.length) continue
        await handle.write(chunk)
        received += chunk.length
        onProgress(progressPayload('downloading', candidate.name, received, asset.size))
      }
    } finally {
      await handle.close()
      try { reader.releaseLock() } catch { /* ignore cleanup errors */ }
    }
  }

  private async validateInstaller(filePath: string, asset: ResolvedAsset): Promise<void> {
    const fileStat = await stat(filePath)
    if (asset.size > 0 && fileStat.size !== asset.size) throw new Error(`安装包大小不匹配：应为 ${asset.size} 字节，实际为 ${fileStat.size} 字节。`)
    const handle = await open(filePath, 'r')
    try {
      const header = Buffer.alloc(2)
      const { bytesRead } = await handle.read(header, 0, 2, 0)
      if (bytesRead !== 2 || header[0] !== 0x4d || header[1] !== 0x5a) throw new Error('下载文件不是有效的 Windows 安装程序。')
    } finally {
      await handle.close()
    }
    if (asset.digest) {
      const digestHandle = await open(filePath, 'r')
      const hash = createHash('sha256')
      try {
        for await (const chunk of digestHandle.readableWebStream()) hash.update(Buffer.from(chunk as ArrayBuffer))
      } finally {
        await digestHandle.close()
      }
      if (hash.digest('hex') !== asset.digest) throw new Error('安装包 SHA-256 校验失败，已拒绝打开。')
    }
  }
}
