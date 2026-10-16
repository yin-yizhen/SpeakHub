import { describe, expect, it, vi } from 'vitest'
import { placeChatGPTView } from './chatgpt-view-host'

function host(width: number, height: number) {
  const children: unknown[] = []
  return {
    contentView: {
      children,
      addChildView: vi.fn((view: unknown) => { children.push(view) }),
      removeChildView: vi.fn((view: unknown) => { children.splice(children.indexOf(view), 1) })
    },
    getContentSize: () => [width, height],
    setContentSize: vi.fn()
  }
}

describe('ChatGPT page host', () => {
  it('keeps Gemini and ChatGPT in separate hidden hosts while switching the visible provider', () => {
    const studio = host(1320, 860), chatBackground = host(900, 860), geminiBackground = host(900, 860)
    const chat = { setBounds: vi.fn(), setVisible: vi.fn() }, gemini = { setBounds: vi.fn(), setVisible: vi.fn() }
    placeChatGPTView(chat as never, studio as never, chatBackground as never, true)
    placeChatGPTView(gemini as never, studio as never, geminiBackground as never, false)
    placeChatGPTView(chat as never, studio as never, chatBackground as never, false)
    placeChatGPTView(gemini as never, studio as never, geminiBackground as never, true)
    expect(studio.contentView.children).toEqual([gemini])
    expect(chatBackground.contentView.children).toEqual([chat])
    placeChatGPTView(gemini as never, studio as never, geminiBackground as never, false)
    expect(studio.contentView.children).toEqual([])
    expect(geminiBackground.contentView.children).toEqual([gemini])
    expect(gemini.setVisible).not.toHaveBeenCalledWith(false)
  })
  it('removes the page from the studio while keeping its background viewport usable', () => {
    const studio = host(1320, 860)
    const background = host(900, 860)
    const view = { setBounds: vi.fn(), setVisible: vi.fn() }
    studio.contentView.addChildView(view)
    placeChatGPTView(view as never, studio as never, background as never, false)
    expect(studio.contentView.children).not.toContain(view)
    expect(background.contentView.children).toContain(view)
    expect(background.setContentSize).toHaveBeenCalledWith(900, 860)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 900, height: 860 })
    expect(view.setVisible).toHaveBeenCalledWith(true)
  })

  it('reuses the same page when opening and closing the connection panel, without duplicate attachments', () => {
    const studio = host(1320, 860)
    const background = host(900, 860)
    const view = { setBounds: vi.fn(), setVisible: vi.fn() }
    placeChatGPTView(view as never, studio as never, background as never, false)
    placeChatGPTView(view as never, studio as never, background as never, true)
    expect(studio.contentView.children).toEqual([view])
    expect(background.contentView.children).toEqual([])
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 420, y: 0, width: 900, height: 860 })
    placeChatGPTView(view as never, studio as never, background as never, true)
    expect(studio.contentView.children).toEqual([view])
    placeChatGPTView(view as never, studio as never, background as never, false)
    expect(studio.contentView.children).toEqual([])
    expect(background.contentView.children).toEqual([view])
    expect(view.setVisible).not.toHaveBeenCalledWith(false)
  })
})
