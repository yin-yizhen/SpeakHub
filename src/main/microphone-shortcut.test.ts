import { describe, expect, it } from 'vitest'
import { normalizeMicrophoneShortcut, replaceGlobalMicrophoneShortcut, shortcutFromKeyboardEvent } from './microphone-shortcut'

describe('microphone shortcuts', () => {
  it('accepts function keys and normalized modifier combinations', () => {
    expect(normalizeMicrophoneShortcut('f8')).toBe('F8')
    expect(normalizeMicrophoneShortcut('shift + control + m')).toBe('Ctrl+Shift+M')
  })

  it('rejects unsafe bare keys and reserved Windows combinations', () => {
    expect(() => normalizeMicrophoneShortcut('m')).toThrow('require Ctrl')
    expect(() => normalizeMicrophoneShortcut('Alt+F4')).toThrow('reserved')
  })

  it('records a browser key event as a valid accelerator', () => {
    expect(shortcutFromKeyboardEvent({ key: 'm', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false })).toBe('Ctrl+Shift+M')
    expect(shortcutFromKeyboardEvent({ key: 'Shift', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false })).toBeUndefined()
  })

  it('restores the previous global shortcut when the new one conflicts', () => {
    const registered: string[] = []
    const registry = { unregister: (shortcut: string) => registered.push(`remove:${shortcut}`), register: (shortcut: string) => { registered.push(`add:${shortcut}`); return shortcut === 'F8' } }
    expect(() => replaceGlobalMicrophoneShortcut(registry, 'F8', 'Ctrl+Shift+M', () => undefined)).toThrow('unavailable')
    expect(registered).toEqual(['remove:F8', 'add:Ctrl+Shift+M', 'add:F8'])
  })
})
