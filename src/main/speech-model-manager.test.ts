import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SpeechModelManager, speechAssetManifest } from './speech-model-manager'

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
  it('downloads verified files, reports separate progress, atomically extracts, and reuses them offline', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'speaksub-models-'))
    try {
      const fetcher = vi.fn(async (url: string | URL | Request) => responseFor(String(url)))
      const extractor = vi.fn(async (_archive: string, destination: string) => createExtractedModel(destination))
      const manager = new SpeechModelManager(directory, fetcher as typeof fetch, extractor)
      const states: string[] = []
      manager.subscribe((state) => states.push(`${state.asr.status}:${state.tts.status}`))

      await expect(manager.ensureAll()).resolves.toMatchObject({ asr: { status: 'ready' }, tts: { status: 'ready' } })
      expect(fetcher).toHaveBeenCalledTimes(5)
      expect(extractor).toHaveBeenCalledOnce()
      expect(states).toContain('downloading:missing')
      expect(states).toContain('ready:downloading')
      expect(existsSync(join(manager.paths.asr, 'encoder.int8.onnx'))).toBe(true)
      expect(existsSync(join(manager.paths.tts, 'model.int8.onnx'))).toBe(true)
      expect(existsSync(join(directory, `${speechAssetManifest.tts.archive.name}.part`))).toBe(false)

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
      expect(existsSync(join(manager.paths.asr, 'encoder.int8.onnx'))).toBe(false)
      expect(statSync(join(manager.paths.asr, 'encoder.int8.onnx.part')).size).toBe(3)

      corrupt = false
      await expect(manager.ensureAll()).resolves.toMatchObject({ asr: { status: 'ready' }, tts: { status: 'ready' } })
      expect(existsSync(join(manager.paths.asr, 'encoder.int8.onnx.part'))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
