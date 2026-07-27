import { describe, expect, it } from 'vitest'
import { ALIYUN_HELP_LINKS, isExternalHelpUrl } from './help-links'

describe('external help links', () => {
  it('allows only the fixed official Alibaba Cloud help destinations', () => {
    expect(Object.values(ALIYUN_HELP_LINKS).every(isExternalHelpUrl)).toBe(true)
    expect(isExternalHelpUrl('https://example.com/')).toBe(false)
    expect(isExternalHelpUrl('javascript:alert(1)')).toBe(false)
  })
})
