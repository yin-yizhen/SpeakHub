import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { SpeechAssetProgress, SpeechAssetState } from '../shared/types'

const execFileAsync = promisify(execFile)
const ready = (totalBytes: number): SpeechAssetProgress => ({ status: 'ready', downloadedBytes: totalBytes, totalBytes, progress: 1 })
const missing = (totalBytes: number): SpeechAssetProgress => ({ status: 'missing', downloadedBytes: 0, totalBytes, progress: 0 })

export const speechAssetManifest = {
  asr: {
    directory: 'zipformer-small-bilingual-zh-en-32-int8',
    files: [
      { name: 'encoder.int8.onnx', source: 'exp/32/encoder-epoch-99-avg-1.int8.onnx', size: 42_980_793, sha256: 'db6f51551762e40e549166fe041ea3e45464370b595e9ad23f06478ec3794fbb' },
      { name: 'decoder.int8.onnx', source: 'exp/32/decoder-epoch-99-avg-1.int8.onnx', size: 3_486_740, sha256: '4b618d383af304cfae281dbf0a53e8bf442c2f0502256cd5694bd6567ebdd834' },
      { name: 'joiner.int8.onnx', source: 'exp/32/joiner-epoch-99-avg-1.int8.onnx', size: 3_228_485, sha256: 'bdda356d6f9b8c2d7cee9ee0e26075fa537490f7fd06520be408d287073667b9' },
      { name: 'tokens.txt', source: 'data/lang_char_bpe/tokens.txt', size: 56_317, sha256: 'a8e0e4ec53810e433789b54a5c0134a7eaa2ffca595a6334d54c00da858841d3' }
    ],
    baseUrl: 'https://huggingface.co/csukuangfj/k2fsa-zipformer-bilingual-zh-en-t/resolve/main/'
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

type Fetcher = typeof fetch
type Extractor = (archive: string, destination: string) => Promise<void>

export function speechModelRoot(options: { isPackaged: boolean; executablePath: string; userDataDirectory: string }): string {
  return options.isPackaged
    ? join(dirname(options.executablePath), 'speech-models')
    : join(options.userDataDirectory, 'speech-models')
}

export class SpeechModelManager {
  private current: SpeechAssetState
  private active?: Promise<SpeechAssetState>
  private listeners = new Set<(state: SpeechAssetState) => void>()

  constructor(
    readonly root: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly extractor: Extractor = async (archive, destination) => {
      await execFileAsync('tar', ['-xjf', archive, '-C', destination])
    }
  ) {
    mkdirSync(root, { recursive: true })
    this.current = {
      asr: this.hasAsr() ? ready(this.asrTotal) : missing(this.asrTotal),
      tts: this.hasTts() ? ready(speechAssetManifest.tts.archive.size) : missing(speechAssetManifest.tts.archive.size)
    }
  }

  get paths(): { asr: string; tts: string } {
    return { asr: join(this.root, speechAssetManifest.asr.directory), tts: join(this.root, speechAssetManifest.tts.directory) }
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

  private get asrTotal(): number { return speechAssetManifest.asr.files.reduce((sum, file) => sum + file.size, 0) }

  private publish(asset: 'asr' | 'tts', next: SpeechAssetProgress): void {
    this.current = { ...this.current, [asset]: next }
    const snapshot = this.state()
    for (const listener of this.listeners) listener(snapshot)
  }

  private hasAsr(): boolean {
    const directory = this.paths.asr
    return speechAssetManifest.asr.files.every((file) => existsSync(join(directory, file.name)) && statSync(join(directory, file.name)).size === file.size)
  }

  private hasTts(): boolean {
    const directory = this.paths.tts
    return speechAssetManifest.tts.required.every((name) => existsSync(join(directory, name)))
  }

  private async downloadAll(): Promise<SpeechAssetState> {
    try {
      if (!this.hasAsr()) await this.downloadAsr()
      if (!this.hasTts()) await this.downloadTts()
      return this.state()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const asset = this.current.asr.status === 'downloading' ? 'asr' : 'tts'
      this.publish(asset, { ...this.current[asset], status: 'error', error: message })
      throw error
    }
  }

  private async downloadAsr(): Promise<void> {
    const directory = this.paths.asr
    mkdirSync(directory, { recursive: true })
    let completed = 0
    this.publish('asr', { status: 'downloading', downloadedBytes: 0, totalBytes: this.asrTotal, progress: 0 })
    for (const file of speechAssetManifest.asr.files) {
      const destination = join(directory, file.name)
      if (existsSync(destination) && statSync(destination).size === file.size) { completed += file.size; continue }
      await this.download(`${speechAssetManifest.asr.baseUrl}${file.source}`, destination, file.size, file.sha256, (bytes) => {
        const downloadedBytes = completed + bytes
        this.publish('asr', { status: 'downloading', downloadedBytes, totalBytes: this.asrTotal, progress: downloadedBytes / this.asrTotal })
      })
      completed += file.size
    }
    this.publish('asr', ready(this.asrTotal))
  }

  private async downloadTts(): Promise<void> {
    const manifest = speechAssetManifest.tts
    const archive = join(this.root, manifest.archive.name)
    const extractRoot = join(this.root, `${manifest.directory}.extracting`)
    this.publish('tts', { status: 'downloading', downloadedBytes: 0, totalBytes: manifest.archive.size, progress: 0 })
    await this.download(manifest.archive.url, archive, manifest.archive.size, manifest.archive.sha256, (downloadedBytes) => {
      this.publish('tts', { status: 'downloading', downloadedBytes, totalBytes: manifest.archive.size, progress: downloadedBytes / manifest.archive.size })
    })
    rmSync(extractRoot, { recursive: true, force: true })
    mkdirSync(extractRoot, { recursive: true })
    await this.extractor(archive, extractRoot)
    const extracted = join(extractRoot, manifest.directory)
    if (!manifest.required.every((name) => existsSync(join(extracted, name)))) throw new Error('Kokoro 模型压缩包缺少必要文件。')
    rmSync(this.paths.tts, { recursive: true, force: true })
    renameSync(extracted, this.paths.tts)
    rmSync(extractRoot, { recursive: true, force: true })
    rmSync(archive, { force: true })
    this.publish('tts', ready(manifest.archive.size))
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
}
