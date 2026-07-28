export interface ActivatableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export function activateExistingWindow(window: ActivatableWindow | null | undefined): void {
  if (!window || window.isDestroyed()) return

  if (window.isMinimized()) {
    window.restore()
  }

  window.show()
  window.focus()
}
