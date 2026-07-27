import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SpeechModelManager, speechAssetManifest, speechModelRoot } from './speech-model-manager'

const hash = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')
const originals = {
  asr: speechAssetManifest.asr.files.map((file) => ({ size: file.size, sha256: file.sha256 })),
  tts: { size: speechAssetManifest.tts.archive.size, sha256: speechAssetManifest.tts.archive.sha256 }
}
const asrData = speechAssetManifest.asr.files.map((_, index) => Uint8Array.from([index + 1, index + 2, index + 3]))
const ttsData = Uint8Array.from([9, 8, 7, 6])

beforeAll(() => {
  speechAssetManifest.asr.files.forEach((file, index) => Object.assign(file, { size: asrData[index].byteLength, sha256: hash(asrData[index]) }))
  Object.assign(speechAssetManifest.tts.archive, { size: ttsData.byteLength, sha256: hash(ttsData) })
})

afterAll(() => {
  speechAssetManifest.asr.files.forEach((file, index) => Object.assign(file, originals.asr[index]))
  Object.assign(speechAssetManifest.tts.archive, originals.tts)
})

function createExtractedModel(destination: string): void {
  const root = join(destination, speechAssetManifest.tts.directory)
  mkdirSync(root, { recursive: true })
  for (const name of speechAssetManifest.tts.required) {
    const path = join(root, name)
    if (name === 'espeak-ng-data' || name === 'dict') mkdirSync(path)
    else writeFileSync(path, name)
  }
}

function responseFor(url: string): Response {
  const asrIndex = speechAssetManifest.asr.files.findIndex((file) => url.endsWith(file.source))
  return new Response(asrIndex >= 0 ? asrData[asrIndex] : ttsData)
}

describe('SpeechModelManager', () => {
  it('stores packaged models beside the installed executable and keeps development models in userData', () => {
    expect(speechModelRoot({ isPackaged: true, executablePath: 'C:\\Users\\test\\AppData\\Local\\Programs\\SpeakSub\\SpeakSub.exe', userDataDirectory: 'C:\\Users\\test\\AppData\\Roaming\\speaksub' }))
      .toBe('C:\\Users\\test\\AppData\\Local\\Programs\\SpeakSub\\speech-models')
    expect(speechModelRoot({ isPackaged: false, executablePath: 'D:\\tools\\electron.exe', userDataDirectory: 'C:\\Users\\test\\AppData\\Roaming\\speaksub' }))
      .toBe('C:\\Users\\test\\AppData\\Roaming\\speaksub\\speech-models')
  })

  it('reports already verified Zipformer bytes so the UI shows only the remaining Whisper and VAD download', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-partial-models-'))
    try {
      const asrRoot = join(directory, speechAssetManifest.asr.directory)
      mkdirSync(asrRoot, { recursive: true })
      speechAssetManifest.asr.files.slice(0, 4).forEach((file, index) => writeFileSync(join(asrRoot, file.name), asrData[index]))

      const state = new SpeechModelManager(directory).state()
      const existingBytes = speechAssetManifest.asr.files.slice(0, 4).reduce((sum, file) => sum + file.size, 0)
      expect(state.asr).toMatchObject({
        status: 'missing',
        downloadedBytes: existingBytes,
        totalBytes: speechAssetManifest.asr.files.reduce((sum, file) => sum + file.size, 0),
        progress: existingBytes / speechAssetManifest.asr.files.reduce((sum, file) => sum + file.size, 0)
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('downloads verified files, reports separate progress, atomically extracts, and reuses them offline', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-models-'))
    try {
      const fetcher = vi.fn(async (url: string | URL | Request) => responseFor(String(url)))
      const extractor = vi.fn(async (_archive: string, destination: string) => createExtractedModel(destination))
      const legacyDirectory = join(directory, 'zipformer-small-bilingual-zh-en-32-int8')
      mkdirSync(legacyDirectory)
      const manager = new SpeechModelManager(directory, fetcher as typeof fetch, extractor)
      const states: string[] = []
      manager.subscribe((state) => states.push(`${state.asr.status}:${state.tts.status}`))

      await expect(manager.ensureAll()).resolves.toMatchObject({ asr: { status: 'ready' }, tts: { status: 'ready' } })
      expect(fetcher).toHaveBeenCalledTimes(speechAssetManifest.asr.files.length + 1)
      expect(extractor).toHaveBeenCalledOnce()
      expect(states).toContain('downloading:missing')
      expect(states).toContain('ready:downloading')
      expect(existsSync(join(manager.paths.asr, speechAssetManifest.asr.files[0].name))).toBe(true)
      expect(existsSync(join(manager.paths.tts, 'model.int8.onnx'))).toBe(true)
      expect(existsSync(join(directory, `${speechAssetManifest.tts.archive.name}.part`))).toBe(false)
      expect(existsSync(legacyDirectory)).toBe(false)

      const offlineFetch = vi.fn()
      const reused = new SpeechModelManager(directory, offlineFetch as typeof fetch, extractor)
      await expect(reused.ensureAll()).resolves.toMatchObject({ asr: { status: 'ready' }, tts: { status: 'ready' } })
      expect(offlineFetch).not.toHaveBeenCalled()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps a failed checksum out of the final path and succeeds on retry', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-model-retry-'))
    try {
      const ttsRoot = join(directory, speechAssetManifest.tts.directory)
      createExtractedModel(directory)
      expect(existsSync(ttsRoot)).toBe(true)
      let corrupt = true
      const fetcher = vi.fn(async (url: string | URL | Request) => {
        const value = String(url)
        if (corrupt && value.endsWith(speechAssetManifest.asr.files[0].source)) return new Response(Uint8Array.from([0, 0, 0]))
        return responseFor(value)
      })
      const manager = new SpeechModelManager(directory, fetcher as typeof fetch)

      await expect(manager.ensureAll()).rejects.toThrow('SHA-256')
      expect(manager.state().asr.status).toBe('error')
      expect(existsSync(join(manager.paths.asr, speechAssetManifest.asr.files[0].name))).toBe(false)
      expect(statSync(join(manager.paths.asr, `${speechAssetManifest.asr.files[0].name}.part`)).size).toBe(3)

      corrupt = false
      await expect(manager.ensureAll()).resolves.toMatchObject({ asr: { status: 'ready' }, tts: { status: 'ready' } })
      expect(existsSync(join(manager.paths.asr, `${speechAssetManifest.asr.files[0].name}.part`))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
