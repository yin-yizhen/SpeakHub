import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { LocalDictionary } from './local-dictionary'

const dictionaryDir = join(process.cwd(), 'resources', 'dictionaries', 'ecdict-en-zh')

describe('LocalDictionary', () => {
  it('loads a compressed ECDICT bucket and returns English-Chinese definitions', () => {
    const dictionary = new LocalDictionary(dictionaryDir)

    const result = dictionary.lookup('word')

    expect(result?.query).toBe('word')
    expect(result?.definitions.join('\n')).toContain('词')
  })

  it('normalizes simple inflected forms before lookup', () => {
    const dictionary = new LocalDictionary(dictionaryDir)

    const result = dictionary.lookup("word's")

    expect(result?.naturalAlternative).toBe('word')
    expect(result?.definitions.join('\n')).toContain('词')
  })
})
