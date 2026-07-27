const functionKey = /^F(?:[1-9]|1[0-9]|2[0-4])$/
const letterOrDigit = /^[A-Z0-9]$/
const modifierNames = new Map([['CTRL', 'Ctrl'], ['CONTROL', 'Ctrl'], ['ALT', 'Alt'], ['SHIFT', 'Shift']])
const forbidden = new Set(['Alt+F4', 'Ctrl+Alt+Delete'])

export const defaultMicrophoneShortcut = 'F8'

export interface GlobalShortcutRegistry {
  register: (shortcut: string, callback: () => void) => boolean
  unregister: (shortcut: string) => void
}

export function normalizeMicrophoneShortcut(value: string): string {
  const parts = value.trim().split('+').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) throw new Error('Please press a shortcut.')
  const modifiers = new Set<string>()
  let key: string | undefined
  for (const part of parts) {
    const modifier = modifierNames.get(part.toUpperCase())
    if (modifier) { modifiers.add(modifier); continue }
    if (key) throw new Error('A shortcut can contain only one non-modifier key.')
    key = part.length === 1 ? part.toUpperCase() : part.toUpperCase()
  }
  if (!key || (!functionKey.test(key) && !letterOrDigit.test(key))) throw new Error('Use F1–F24, or a letter/number with a modifier key.')
  if (letterOrDigit.test(key) && !modifiers.size) throw new Error('Letters and numbers require Ctrl, Alt, or Shift.')
  const ordered = ['Ctrl', 'Alt', 'Shift'].filter((modifier) => modifiers.has(modifier))
  const shortcut = [...ordered, key].join('+')
  if (forbidden.has(shortcut)) throw new Error('That shortcut is reserved by Windows.')
  return shortcut
}

export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | undefined {
  if (event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift' || event.key === 'Meta') return undefined
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key.toUpperCase()
  const parts = [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean)
  try { return normalizeMicrophoneShortcut(parts.join('+')) } catch { return undefined }
}

export function replaceGlobalMicrophoneShortcut(registry: GlobalShortcutRegistry, previous: string, next: string, callback: () => void): string {
  const shortcut = normalizeMicrophoneShortcut(next)
  registry.unregister(previous)
  if (registry.register(shortcut, callback)) return shortcut
  registry.register(previous, callback)
  throw new Error(`The shortcut ${shortcut} is unavailable. Choose another key combination.`)
}
