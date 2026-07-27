// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readSkippedUpdateVersion, shouldShowUpdatePrompt, SKIPPED_UPDATE_VERSION_KEY, writeSkippedUpdateVersion } from './update-prompt'

describe('update prompt preference', () => {
  beforeEach(() => localStorage.clear())

  it('persists and clears the skipped version', () => {
    writeSkippedUpdateVersion(' 0.1.1 ')
    expect(localStorage.getItem(SKIPPED_UPDATE_VERSION_KEY)).toBe('0.1.1')
    expect(readSkippedUpdateVersion()).toBe('0.1.1')
    writeSkippedUpdateVersion('')
    expect(readSkippedUpdateVersion()).toBe('')
  })

  it('shows a newer version unless that exact version was skipped', () => {
    expect(shouldShowUpdatePrompt('0.1.1', '')).toBe(true)
    expect(shouldShowUpdatePrompt('0.1.1', '0.1.1')).toBe(false)
    expect(shouldShowUpdatePrompt('0.1.2', '0.1.1')).toBe(true)
    expect(shouldShowUpdatePrompt('', '0.1.1')).toBe(false)
  })
})
