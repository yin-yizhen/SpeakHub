import { describe, expect, it, vi } from 'vitest'
import { ALIYUN_HELP_LINKS, SPEECH_MODEL_DOWNLOAD_LINKS } from '../shared/help-links'
import { openAllowedHelpUrl } from './external-help-navigation'

describe('external help navigation', () => {
  it('opens an allowlisted help page in the system browser', async () => {
    const openExternal = vi.fn(async () => undefined)
    const onError = vi.fn()

    expect(openAllowedHelpUrl(ALIYUN_HELP_LINKS.apiKeyGuide, openExternal, onError)).toBe(true)
    await Promise.resolve()

    expect(openExternal).toHaveBeenCalledWith(ALIYUN_HELP_LINKS.apiKeyGuide)
    expect(onError).not.toHaveBeenCalled()

    expect(openAllowedHelpUrl(SPEECH_MODEL_DOWNLOAD_LINKS.kokoro, openExternal, onError)).toBe(true)
    await Promise.resolve()
    expect(openExternal).toHaveBeenCalledWith(SPEECH_MODEL_DOWNLOAD_LINKS.kokoro)
  })

  it('blocks unknown pages and reports system browser failures', async () => {
    const openExternal = vi.fn(async () => { throw new Error('No default browser') })
    const onError = vi.fn()

    expect(openAllowedHelpUrl('https://example.com/', openExternal, onError)).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()

    expect(openAllowedHelpUrl(ALIYUN_HELP_LINKS.console, openExternal, onError)).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(onError).toHaveBeenCalledWith('No default browser')
  })
})
