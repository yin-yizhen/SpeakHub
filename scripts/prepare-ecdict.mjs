import { brotliCompressSync } from 'node:zlib'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const input = process.argv[2] ? resolve(process.argv[2]) : resolve('tmp/ecdict.csv')
const outputDir = process.argv[3] ? resolve(process.argv[3]) : resolve('resources/dictionaries/ecdict-en-zh')

function parseCsvLine(line) {
  const cells = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell)
  return cells
}

function bucketName(word) {
  const first = word[0]
  return first >= 'a' && first <= 'z' ? first : 'other'
}

const text = readFileSync(input, 'utf8')
const lines = text.split(/\r?\n/)
const header = parseCsvLine(lines.shift() ?? '')
const wordIndex = header.indexOf('word')
const phoneticIndex = header.indexOf('phonetic')
const translationIndex = header.indexOf('translation')
const exchangeIndex = header.indexOf('exchange')

if (wordIndex === -1 || translationIndex === -1) {
  throw new Error(`${basename(input)} does not look like an ECDICT CSV file`)
}

const buckets = new Map()
let count = 0

for (const line of lines) {
  if (!line.trim()) continue
  const cells = parseCsvLine(line)
  const word = cells[wordIndex]?.trim().toLowerCase()
  const translation = cells[translationIndex]?.trim()
  if (!word || !/^[a-z][a-z' -]*$/.test(word) || !translation) continue
  const phonetic = cells[phoneticIndex]?.trim() ?? ''
  const exchange = cells[exchangeIndex]?.trim() ?? ''
  const bucket = bucketName(word)
  const entries = buckets.get(bucket) ?? {}
  entries[word] = [phonetic, translation, exchange]
  buckets.set(bucket, entries)
  count += 1
}

rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })

for (const [bucket, entries] of buckets) {
  const raw = Buffer.from(JSON.stringify(entries))
  const compressed = brotliCompressSync(raw)
  writeFileSync(join(outputDir, `${bucket}.json.br`), compressed)
}

writeFileSync(join(outputDir, 'manifest.json'), JSON.stringify({
  source: 'ECDICT',
  generatedAt: new Date().toISOString(),
  entryCount: count,
  buckets: [...buckets.keys()].sort()
}, null, 2))

console.log(`Prepared ${count} ECDICT entries in ${outputDir}`)
