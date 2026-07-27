import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SpeechModelManager, speechAssetManifest, speechModelRoot } from './speech-model-manager'

const hash = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')
const originals = {
  vad: { size: speechAssetManifest.vad.size, sha256: speechAssetManifest.vad.sha256 },
  tts: { size: speechAssetManifest.tts.archive.size, sha256: speechAssetManifest.tts.archive.sha256 }
}
const vadData = Uint8Array.from([7, 7, 7])
const ttsData = Uint8Array.from([9, 8, 7, 6])

beforeAll(() => {
  Object.assign(speechAssetManifest.vad, { size: vadData.byteLength, sha256: hash(vadData) })
  Object.assign(speechAssetManifest.tts.archive, { size: ttsData.byteLength, sha256: hash(ttsData) })
})

afterAll(() => {
  Object.assign(speechAssetManifest.vad, originals.vad)
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
  return new Response(url.endsWith(speechAssetManifest.vad.name) ? vadData : ttsData)
}

describe('SpeechModelManager', () => {
  it('stores packaged models beside the installed executable and keeps development models in userData', () => {
    expect(speechModelRoot({ isPackaged: true, executablePath: 'C:\\Users\\test\\AppData\\Local\\Programs\\SpeakSub\\SpeakSub.exe', userDataDirectory: 'C:\\Users\\test\\AppData\\Roaming\\speaksub' }))
      .toBe('C:\\Users\\test\\AppData\\Local\\Programs\\SpeakSub\\speech-models')
    expect(speechModelRoot({ isPackaged: false, executablePath: 'D:\\tools\\electron.exe', userDataDirectory: 'C:\\Users\\test\\AppData\\Roaming\\speaksub' }))
      .toBe('C:\\Users\\test\\AppData\\Roaming\\speaksub\\speech-models')
  })

  it('migrates the shared VAD and removes obsolete local recognition models', () => {
    const directory = mkdtempSync(join(tmpdir(), 'speakhub-model-migration-'))
    try {
      const obsolete = join(directory, 'zipformer-bilingual-zh-en-int8')
      mkdirSync(obsolete, { recursive: true })
      writeFileSync(join(obsolete, speechAssetManifest.vad.name), vadData)
      writeFileSync(join(obsolete, 'whisper-base-decoder.int8.onnx'), 'obsolete')

      const manager = new SpeechModelManager(directory)

      expect(manager.state().vad.status).toBe('ready')
      expect(existsSync(manager.paths.vad)).toBe(true)
      expect(existsSync(obsolete)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('downloads only verified VAD and Kokoro assets and reuses them offline', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'speakhub-cloud-models-'))
    try {
      const fetcher = vi.fn(async (url: string | URL | Request) => responseFor(String(url)))
      const extractor = vi.fn(async (_archive: string, destination: string) => createExtractedModel(destination))
      const manager = new SpeechModelManager(directory, fetcher as typeof fetch, extractor)
      const states: string[] = []
      manager.subscribe((state) => states.push(`${state.vad.status}:${state.tts.status}`))

      await expect(manager.ensureAll()).resolves.toMatchObject({ vad: { status: 'ready' }, tts: { status: 'ready' } })
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(extractor).toHaveBeenCalledOnce()
      expect(states).toContain('downloading:missing')
      expect(states).toContain('ready:downloading')
      expect(existsSync(manager.paths.vad)).toBe(true)
      expect(existsSync(join(manager.paths.tts, 'model.int8.onnx'))).toBe(true)
      expect(existsSync(join(directory, `${speechAssetManifest.tts.archive.name}.part`))).toBe(false)

      const offlineFetch = vi.fn()
      const reused = new SpeechModelManager(directory, offlineFetch as typeof fetch, extractor)
      await expect(reused.ensureAll()).resolves.toMatchObject({ vad: { status: 'ready' }, tts: { status: 'ready' } })
      expect(offlineFetch).not.toHaveBeenCalled()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps a failed VAD checksum out of the final path and succeeds on retry', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'speakhub-model-retry-'))
    try {
      createExtractedModel(directory)
      let corrupt = true
      const fetcher = vi.fn(async () => new Response(corrupt ? Uint8Array.from([0, 0, 0]) : vadData))
      const manager = new SpeechModelManager(directory, fetcher as typeof fetch)

      await expect(manager.ensureAll()).rejects.toThrow('SHA-256')
      expect(manager.state().vad.status).toBe('error')
      expect(existsSync(manager.paths.vad)).toBe(false)
      expect(statSync(`${manager.paths.vad}.part`).size).toBe(3)

      corrupt = false
      await expect(manager.ensureAll()).resolves.toMatchObject({ vad: { status: 'ready' }, tts: { status: 'ready' } })
      expect(existsSync(`${manager.paths.vad}.part`)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
