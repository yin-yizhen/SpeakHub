import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { SpeechAssetProgress, SpeechAssetState } from '../shared/types'

const execFileAsync = promisify(execFile)
const ready = (totalBytes: number): SpeechAssetProgress => ({ status: 'ready', downloadedBytes: totalBytes, totalBytes, progress: 1 })
const missing = (totalBytes: number, downloadedBytes = 0): SpeechAssetProgress => ({ status: 'missing', downloadedBytes, totalBytes, progress: downloadedBytes / totalBytes })

export const speechAssetManifest = {
  vad: {
    directory: 'silero-vad',
    name: 'silero_vad.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
    size: 643_854,
    sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6'
  },
  tts: {
    directory: 'kokoro-int8-multi-lang-v1_1',
    archive: {
      name: 'kokoro-int8-multi-lang-v1_1.tar.bz2',
      url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2',
      size: 147_031_220,
      sha256: 'a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6'
    },
    required: ['model.int8.onnx', 'voices.bin', 'tokens.txt', 'lexicon-zh.txt', 'lexicon-us-en.txt', 'espeak-ng-data', 'dict']
  }
} as const

const obsoleteAsrDirectories = ['zipformer-bilingual-zh-en-int8', 'zipformer-small-bilingual-zh-en-32-int8'] as const

type Fetcher = typeof fetch
type Extractor = (archive: string, destination: string) => Promise<void>

export function tarExecutable(options: { platform?: NodeJS.Platform; systemRoot?: string } = {}): string {
  if ((options.platform ?? process.platform) !== 'win32') return 'tar'
  return join(options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
}

export function tarExtractionCommand(
  archive: string,
  destination: string,
  options: { platform?: NodeJS.Platform; systemRoot?: string } = {}
): { executable: string; args: string[] } {
  return {
    executable: tarExecutable(options),
    args: ['-xf', archive, '-C', destination]
  }
}

export async function extractTarArchive(archive: string, destination: string): Promise<void> {
  const command = tarExtractionCommand(archive, destination)
  await execFileAsync(command.executable, command.args)
}

export function speechModelRoot(options: { isPackaged: boolean; executablePath: string; userDataDirectory: string }): string {
  return join(options.userDataDirectory, 'speech-models')
}

export class SpeechModelManager {
  private current: SpeechAssetState
  private active?: Promise<SpeechAssetState>
  private listeners = new Set<(state: SpeechAssetState) => void>()

  constructor(
    readonly root: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly extractor: Extractor = extractTarArchive
  ) {
    mkdirSync(root, { recursive: true })
    this.migrateVadAndRemoveObsoleteAsr()
    this.current = {
      vad: this.hasVad() ? ready(speechAssetManifest.vad.size) : missing(speechAssetManifest.vad.size),
      tts: this.hasTts() ? ready(speechAssetManifest.tts.archive.size) : missing(speechAssetManifest.tts.archive.size)
    }
  }

  get paths(): { vad: string; tts: string } {
    return {
      vad: join(this.root, speechAssetManifest.vad.directory, speechAssetManifest.vad.name),
      tts: join(this.root, speechAssetManifest.tts.directory)
    }
  }

  state(): SpeechAssetState { return structuredClone(this.current) }

  subscribe(listener: (state: SpeechAssetState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state())
    return () => this.listeners.delete(listener)
  }

  ensureAll(): Promise<SpeechAssetState> {
    this.active ??= this.downloadAll().finally(() => { this.active = undefined })
    return this.active
  }

  private publish(asset: keyof SpeechAssetState, next: SpeechAssetProgress): void {
    this.current = { ...this.current, [asset]: next }
    const snapshot = this.state()
    for (const listener of this.listeners) listener(snapshot)
  }

  private hasVad(): boolean {
    return existsSync(this.paths.vad) && statSync(this.paths.vad).size === speechAssetManifest.vad.size
  }

  private hasTts(): boolean {
    const directory = this.paths.tts
    return speechAssetManifest.tts.required.every((name) => existsSync(join(directory, name)))
  }

  private async downloadAll(): Promise<SpeechAssetState> {
    this.reconcileLocalAssets()
    try {
      if (!this.hasVad()) await this.downloadVad()
      if (!this.hasTts()) await this.downloadTts()
      return this.state()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const asset = (['vad', 'tts'] as const).find((name) => this.current[name].status === 'downloading') ?? 'tts'
      this.publish(asset, { ...this.current[asset], status: 'error', error: message })
      throw error
    }
  }

  private async downloadVad(): Promise<void> {
    const manifest = speechAssetManifest.vad
    mkdirSync(dirname(this.paths.vad), { recursive: true })
    this.publish('vad', { status: 'downloading', downloadedBytes: 0, totalBytes: manifest.size, progress: 0 })
    await this.download(manifest.url, this.paths.vad, manifest.size, manifest.sha256, (downloadedBytes) => {
      this.publish('vad', { status: 'downloading', downloadedBytes, totalBytes: manifest.size, progress: downloadedBytes / manifest.size })
    })
    this.publish('vad', ready(manifest.size))
  }

  private async downloadTts(): Promise<void> {
    const manifest = speechAssetManifest.tts
    const archive = join(this.root, manifest.archive.name)
    const extractRoot = join(this.root, `${manifest.directory}.extracting`)
    this.publish('tts', { status: 'downloading', downloadedBytes: 0, totalBytes: manifest.archive.size, progress: 0 })
    if (await this.isVerifiedFile(archive, manifest.archive.size, manifest.archive.sha256)) {
      this.publish('tts', { status: 'downloading', downloadedBytes: manifest.archive.size, totalBytes: manifest.archive.size, progress: 1 })
    } else {
      rmSync(archive, { force: true })
      await this.download(manifest.archive.url, archive, manifest.archive.size, manifest.archive.sha256, (downloadedBytes) => {
        this.publish('tts', { status: 'downloading', downloadedBytes, totalBytes: manifest.archive.size, progress: downloadedBytes / manifest.archive.size })
      })
    }
    rmSync(extractRoot, { recursive: true, force: true })
    mkdirSync(extractRoot, { recursive: true })
    try {
      await this.extractor(archive, extractRoot)
      const extracted = join(extractRoot, manifest.directory)
      if (!manifest.required.every((name) => existsSync(join(extracted, name)))) throw new Error('Kokoro 模型压缩包缺少必要文件。')
      rmSync(this.paths.tts, { recursive: true, force: true })
      renameSync(extracted, this.paths.tts)
      rmSync(extractRoot, { recursive: true, force: true })
      rmSync(archive, { force: true })
      this.publish('tts', ready(manifest.archive.size))
    } catch (error) {
      rmSync(extractRoot, { recursive: true, force: true })
      throw error
    }
  }

  private reconcileLocalAssets(): void {
    const vadPresent = this.hasVad()
    const ttsPresent = this.hasTts()
    if (vadPresent && this.current.vad.status !== 'ready') this.publish('vad', ready(speechAssetManifest.vad.size))
    if (!vadPresent && this.current.vad.status === 'ready') this.publish('vad', missing(speechAssetManifest.vad.size))
    if (ttsPresent && this.current.tts.status !== 'ready') this.publish('tts', ready(speechAssetManifest.tts.archive.size))
    if (!ttsPresent && this.current.tts.status === 'ready') this.publish('tts', missing(speechAssetManifest.tts.archive.size))
  }

  private async isVerifiedFile(path: string, expectedSize: number, expectedHash: string): Promise<boolean> {
    if (!existsSync(path) || statSync(path).size !== expectedSize) return false
    const hash = createHash('sha256')
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(path)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('error', reject)
      stream.on('end', resolve)
    })
    return hash.digest('hex') === expectedHash
  }

  private async download(url: string, destination: string, expectedSize: number, expectedHash: string, onProgress: (bytes: number) => void): Promise<void> {
    const temporary = `${destination}.part`
    rmSync(temporary, { force: true })
    const response = await this.fetcher(url)
    if (!response.ok || !response.body) throw new Error(`模型下载失败（HTTP ${response.status}）。`)
    const reader = response.body.getReader()
    const hash = createHash('sha256')
    const handle = openSync(temporary, 'w')
    let downloaded = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        writeSync(handle, value)
        hash.update(value)
        downloaded += value.byteLength
        onProgress(downloaded)
      }
    } finally {
      closeSync(handle)
    }
    if (downloaded !== expectedSize) throw new Error(`模型文件大小校验失败：需要 ${expectedSize}，实际 ${downloaded}。`)
    const actualHash = hash.digest('hex')
    if (actualHash !== expectedHash) throw new Error('模型文件 SHA-256 校验失败。')
    renameSync(temporary, destination)
  }

  private migrateVadAndRemoveObsoleteAsr(): void {
    const destination = this.paths.vad
    for (const directoryName of obsoleteAsrDirectories) {
      const directory = join(this.root, directoryName)
      const legacyVad = join(directory, speechAssetManifest.vad.name)
      if (!existsSync(destination) && existsSync(legacyVad) && statSync(legacyVad).size === speechAssetManifest.vad.size) {
        mkdirSync(dirname(destination), { recursive: true })
        renameSync(legacyVad, destination)
      }
      rmSync(directory, { recursive: true, force: true })
    }
  }
}
