import { describe, expect, it } from 'vitest'
import { embeddedConnectionBounds, resizeBounds, subtitleBounds, subtitleHeight } from './window-layout'

describe('subtitle window placement', () => {
  it('centres the overlay above the taskbar area', () => {
    expect(subtitleBounds({ x: 0, y: 0, width: 1440, height: 900 }, 900, 156)).toEqual({ x: 270, y: 702, width: 900, height: 156 })
  })

  it('leaves enough room for four lines at the configured font size', () => {
    expect(subtitleHeight(25, 4)).toBe(229)
    expect(subtitleHeight(38, 4)).toBeGreaterThan(subtitleHeight(25, 4))
  })

  it('places the embedded connection page flush against the SpeakSub sidebar', () => {
    expect(embeddedConnectionBounds({ width: 1320, height: 820 })).toEqual({ x: 420, y: 0, width: 900, height: 820 })
  })

  it('resizes all sides while keeping the opposite edge fixed', () => {
    expect(resizeBounds({ x: 100, y: 100, width: 600, height: 220 }, 'left', 80, 0)).toEqual({ x: 180, y: 100, width: 520, height: 220 })
    expect(resizeBounds({ x: 100, y: 100, width: 600, height: 220 }, 'top-left', 80, 40)).toEqual({ x: 180, y: 140, width: 520, height: 180 })
  })

  it('keeps subtitle resize above the caller supplied readable height', () => {
    const readableHeight = subtitleHeight(25, 4)
    expect(resizeBounds({ x: 100, y: 100, width: 600, height: 260 }, 'top', 0, 120, undefined, readableHeight)).toEqual({ x: 100, y: 131, width: 600, height: readableHeight })
  })
})
