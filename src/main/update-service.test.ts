import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDownloadCandidates, compareVersions, parseGithubRelease, UpdateService } from './update-service'

const releaseUrl = 'https://github.com/yin-yizhen/SpeakHub/releases/tag/v0.1.1'
const downloadUrl = 'https://github.com/yin-yizhen/SpeakHub/releases/download/v0.1.1/SpeakHub-0.1.1-Setup.exe'
const installer = Buffer.from([0x4d, 0x5a, 1, 2, 3, 4])
const installerDigest = createHash('sha256').update(installer).digest('hex')
const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'speakhub-update-'))
  temporaryDirectories.push(directory)
  return directory
}

function release(options: { version?: string; digest?: string; size?: number; assets?: unknown[] } = {}) {
  const version = options.version ?? '0.1.1'
  return {
    tag_name: `v${version}`,
    name: `SpeakHub v${version}`,
    body: '新增启动更新检测\n修复下载进度显示',
    published_at: '2026-07-28T00:00:00Z',
    html_url: `https://github.com/yin-yizhen/SpeakHub/releases/tag/v${version}`,
    assets: options.assets ?? [{
      name: `SpeakHub-${version}-Setup.exe`,
      size: options.size ?? installer.length,
      digest: options.digest === undefined ? `sha256:${installerDigest}` : options.digest,
      browser_download_url: `https://github.com/yin-yizhen/SpeakHub/releases/download/v${version}/SpeakHub-${version}-Setup.exe`
    }]
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('GitHub Release update parsing', () => {
  it('compares stable x.y.z versions and rejects invalid tags', () => {
    expect(compareVersions('v0.1.1', '0.1.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
    expect(() => compareVersions('latest', '0.1.0')).toThrow(/x\.y\.z/)
  })

  it('returns release notes and selects the setup executable', () => {
    const parsed = parseGithubRelease(release({
      assets: [
        { name: 'notes.txt', size: 1, browser_download_url: `${downloadUrl}.txt` },
        { name: 'portable.exe', size: 1, browser_download_url: downloadUrl.replace('Setup', 'Portable') },
        { name: 'SpeakHub-0.1.1-Setup.exe', size: installer.length, digest: `sha256:${installerDigest}`, browser_download_url: downloadUrl }
      ]
    }), '0.1.0')
    expect(parsed.info.updateAvailable).toBe(true)
    expect(parsed.info.release?.notes).toContain('启动更新检测')
    expect(parsed.info.asset).toEqual({ name: 'SpeakHub-0.1.1-Setup.exe', size: installer.length })
  })

  it('does not offer mirrors when GitHub did not provide a SHA-256 digest', () => {
    const withoutDigest = parseGithubRelease(release({ digest: '' }), '0.1.0').asset!
    expect(buildDownloadCandidates(withoutDigest)).toEqual([{ name: 'GitHub', url: downloadUrl }])
    const withDigest = parseGithubRelease(release(), '0.1.0').asset!
    expect(buildDownloadCandidates(withDigest).map((candidate) => candidate.name)).toEqual(['GitHub', 'GH Proxy', 'GHFast'])
  })

  it('rejects foreign release and asset URLs', () => {
    expect(() => parseGithubRelease({ ...release(), html_url: 'https://example.com/releases/v0.1.1' }, '0.1.0')).toThrow(/地址无效/)
    const parsed = parseGithubRelease(release({ assets: [{ name: 'Setup.exe', size: 10, browser_download_url: 'https://example.com/Setup.exe' }] }), '0.1.0')
    expect(parsed.info.asset).toBeUndefined()
  })
})

describe('UpdateService', () => {
  it('handles an empty release repository without interrupting startup', async () => {
    const service = new UpdateService({
      currentVersion: '0.1.0',
      downloadDirectory: temporaryDirectory(),
      fetcher: vi.fn(async () => new Response('{}', { status: 404 })),
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(async () => undefined)
    })
    await expect(service.check()).resolves.toMatchObject({ updateAvailable: false, currentVersion: '0.1.0', latestVersion: '0.1.0' })
  })

  it('reports the current version when the latest release is not newer', async () => {
    const service = new UpdateService({
      currentVersion: '0.1.0',
      downloadDirectory: temporaryDirectory(),
      fetcher: vi.fn(async () => Response.json(release({ version: '0.1.0' }))),
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(async () => undefined)
    })
    await expect(service.check()).resolves.toMatchObject({ updateAvailable: false, currentVersion: '0.1.0', latestVersion: '0.1.0' })
  })

  it('downloads, reports progress, verifies the digest, and opens the installer', async () => {
    const calls: string[] = []
    const opened: string[] = []
    const directory = temporaryDirectory()
    const service = new UpdateService({
      currentVersion: '0.1.0',
      downloadDirectory: directory,
      fetcher: vi.fn(async (input) => {
        const url = String(input)
        calls.push(url)
        return url.includes('/releases/latest') ? Response.json(release()) : new Response(installer, { status: 200 })
      }),
      openPath: vi.fn(async (filePath) => { opened.push(filePath); return '' }),
      openExternal: vi.fn(async () => undefined)
    })
    const progress: string[] = []
    expect((await service.check()).updateAvailable).toBe(true)
    await expect(service.downloadAndInstall((event) => progress.push(event.status))).resolves.toMatchObject({ ok: true })
    expect(calls).toHaveLength(2)
    expect(progress).toContain('downloading')
    expect(progress).toContain('verifying')
    expect(progress.at(-1)).toBe('ready')
    expect(opened[0]).toMatch(/SpeakHub-0\.1\.1-Setup\.exe$/)
    expect([...readFileSync(opened[0])]).toEqual([...installer])
  })

  it('falls back to a mirror only when the digest can authenticate it', async () => {
    const calls: string[] = []
    const service = new UpdateService({
      currentVersion: '0.1.0',
      downloadDirectory: temporaryDirectory(),
      fetcher: vi.fn(async (input) => {
        const url = String(input)
        calls.push(url)
        if (url.includes('/releases/latest')) return Response.json(release())
        if (url === downloadUrl) return new Response('blocked', { status: 503 })
        return new Response(installer, { status: 200 })
      }),
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(async () => undefined)
    })
    await service.check()
    await expect(service.downloadAndInstall(() => undefined)).resolves.toMatchObject({ ok: true })
    expect(calls[2]).toBe(`https://gh-proxy.com/${downloadUrl}`)
  })

  it('rejects a hash mismatch and removes partial or invalid files', async () => {
    const directory = temporaryDirectory()
    const service = new UpdateService({
      currentVersion: '0.1.0',
      downloadDirectory: directory,
      fetcher: vi.fn(async (input) => String(input).includes('/releases/latest')
        ? Response.json(release({ digest: `sha256:${'0'.repeat(64)}` }))
        : new Response(installer, { status: 200 })),
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(async () => undefined)
    })
    await service.check()
    const result = await service.downloadAndInstall(() => undefined)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/SHA-256/)
    expect(existsSync(join(directory, 'SpeakHub-0.1.1-Setup.exe'))).toBe(false)
    expect(existsSync(join(directory, 'SpeakHub-0.1.1-Setup.exe.download'))).toBe(false)
  })

  it('rejects a truncated or non-Windows installer', async () => {
    const service = new UpdateService({
      currentVersion: '0.1.0',
      downloadDirectory: temporaryDirectory(),
      fetcher: vi.fn(async (input) => String(input).includes('/releases/latest')
        ? Response.json(release({ digest: '', size: 10 }))
        : new Response(Buffer.from('html'), { status: 200 })),
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(async () => undefined)
    })
    await service.check()
    await expect(service.downloadAndInstall(() => undefined)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/大小不匹配/) })
  })

  it('times out stalled download connections and leaves no partial installer', async () => {
    const directory = temporaryDirectory()
    const service = new UpdateService({
      currentVersion: '0.1.0',
      downloadDirectory: directory,
      connectTimeoutMs: 2,
      fetcher: vi.fn(async (input, init) => {
        if (String(input).includes('/releases/latest')) return Response.json(release({ digest: '' }))
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }),
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(async () => undefined)
    })
    await service.check()
    await expect(service.downloadAndInstall(() => undefined)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/连接超时/) })
    expect(existsSync(join(directory, 'SpeakHub-0.1.1-Setup.exe.download'))).toBe(false)
  })

  it('times out a response that stops delivering bytes', async () => {
    const service = new UpdateService({
      currentVersion: '0.1.0',
      downloadDirectory: temporaryDirectory(),
      stallTimeoutMs: 2,
      fetcher: vi.fn(async (input) => {
        if (String(input).includes('/releases/latest')) return Response.json(release({ digest: '' }))
        return new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }), { status: 200 })
      }),
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(async () => undefined)
    })
    await service.check()
    await expect(service.downloadAndInstall(() => undefined)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/长时间没有数据/) })
  })

  it('opens only the validated repository release page', async () => {
    const openExternal = vi.fn(async () => undefined)
    const service = new UpdateService({
      currentVersion: '0.1.0',
      downloadDirectory: temporaryDirectory(),
      fetcher: vi.fn(async () => Response.json(release())),
      openPath: vi.fn(async () => ''),
      openExternal
    })
    await service.check()
    await expect(service.openRelease()).resolves.toMatchObject({ ok: true, releaseUrl })
    expect(openExternal).toHaveBeenCalledWith(releaseUrl)
  })
})
