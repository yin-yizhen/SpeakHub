import { describe, expect, it, vi } from 'vitest'
import { activateExistingWindow, type ActivatableWindow } from './window-activation'

function createWindow(options: { destroyed?: boolean; minimized?: boolean } = {}) {
  return {
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    isMinimized: vi.fn(() => options.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  } satisfies ActivatableWindow
}

describe('activateExistingWindow', () => {
  it('does nothing when no usable window exists', () => {
    expect(() => activateExistingWindow(undefined)).not.toThrow()

    const window = createWindow({ destroyed: true })
    activateExistingWindow(window)

    expect(window.show).not.toHaveBeenCalled()
    expect(window.focus).not.toHaveBeenCalled()
  })

  it('restores a minimized window before showing and focusing it', () => {
    const window = createWindow({ minimized: true })

    activateExistingWindow(window)

    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('shows and focuses an existing non-minimized window without restoring it', () => {
    const window = createWindow()

    activateExistingWindow(window)

    expect(window.restore).not.toHaveBeenCalled()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })
})
