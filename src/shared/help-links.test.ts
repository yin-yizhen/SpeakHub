import { describe, expect, it } from 'vitest'
import { ALIYUN_HELP_LINKS, isExternalHelpUrl, SPEECH_MODEL_DOWNLOAD_LINKS } from './help-links'

describe('external help links', () => {
  it('allows only the fixed official help and speech model destinations', () => {
    expect(Object.values(ALIYUN_HELP_LINKS).every(isExternalHelpUrl)).toBe(true)
    expect(Object.values(SPEECH_MODEL_DOWNLOAD_LINKS).every(isExternalHelpUrl)).toBe(true)
    expect(isExternalHelpUrl('https://example.com/')).toBe(false)
    expect(isExternalHelpUrl('javascript:alert(1)')).toBe(false)
  })
})
