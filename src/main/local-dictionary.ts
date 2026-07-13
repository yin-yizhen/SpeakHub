import { brotliDecompressSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DictionaryResult } from '../shared/types'

type PackedEntry = [phonetic?: string, translation?: string, exchange?: string]
type Bucket = Record<string, PackedEntry>

const maxCachedBuckets = 5

function normalizeWord(query: string): string {
  return query.trim().toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '')
}

function bucketName(word: string): string {
  const first = word[0]
  return first >= 'a' && first <= 'z' ? first : 'other'
}

function candidateWords(word: string): string[] {
  const candidates = new Set([word])
  if (word.endsWith("'s")) candidates.add(word.slice(0, -2))
  if (word.endsWith("s'")) candidates.add(word.slice(0, -2))
  if (word.endsWith('ies') && word.length > 4) candidates.add(`${word.slice(0, -3)}y`)
  if (word.endsWith('es') && word.length > 3) candidates.add(word.slice(0, -2))
  if (word.endsWith('s') && word.length > 3) candidates.add(word.slice(0, -1))
  if (word.endsWith('ied') && word.length > 4) candidates.add(`${word.slice(0, -3)}y`)
  if (word.endsWith('ed') && word.length > 4) {
    candidates.add(word.slice(0, -2))
    candidates.add(word.slice(0, -1))
  }
  if (word.endsWith('ing') && word.length > 5) {
    candidates.add(word.slice(0, -3))
    candidates.add(word.slice(0, -3) + 'e')
  }
  return [...candidates]
}

export class LocalDictionary {
  private readonly buckets = new Map<string, Bucket>()

  constructor(private readonly dictionaryDir: string) {}

  lookup(query: string): DictionaryResult | undefined {
    const normalized = normalizeWord(query)
    if (!normalized) return undefined

    for (const candidate of candidateWords(normalized)) {
      const entry = this.loadBucket(bucketName(candidate))[candidate]
      if (!entry) continue
      return {
        query,
        phonetic: entry[0] || undefined,
        definitions: this.splitDefinitions(entry[1] ?? ''),
        naturalAlternative: candidate === normalized ? undefined : candidate
      }
    }

    return undefined
  }

  private loadBucket(bucket: string): Bucket {
    const cached = this.buckets.get(bucket)
    if (cached) return cached

    try {
      const compressed = readFileSync(join(this.dictionaryDir, `${bucket}.json.br`))
      const parsed = JSON.parse(brotliDecompressSync(compressed).toString('utf8')) as Bucket
      this.buckets.set(bucket, parsed)
      this.evictOldBuckets()
      return parsed
    } catch {
      return {}
    }
  }

  private evictOldBuckets(): void {
    while (this.buckets.size > maxCachedBuckets) {
      const oldest = this.buckets.keys().next().value
      if (!oldest) return
      this.buckets.delete(oldest)
    }
  }

  private splitDefinitions(translation: string): string[] {
    return translation.split(/\r?\n|\\n/g).map((line) => line.trim()).filter(Boolean).slice(0, 8)
  }
}
