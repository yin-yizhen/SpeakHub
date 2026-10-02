import type { BaseWindow, WebContentsView } from 'electron'
import { embeddedConnectionBounds } from './window-layout'

type HostWindow = Pick<BaseWindow, 'contentView' | 'getContentSize' | 'setContentSize'>

/** Move the same live page between the visible connection panel and a hidden host. */
export function placeChatGPTView(view: WebContentsView, studio: HostWindow, background: HostWindow, visible: boolean, sidebarWidth = 420): void {
  const [width, height] = studio.getContentSize()
  const connectionBounds = embeddedConnectionBounds({ width, height }, sidebarWidth)
  const target = visible ? studio : background
  const other = visible ? background : studio
  if (other.contentView.children.includes(view)) other.contentView.removeChildView(view)
  if (!target.contentView.children.includes(view)) target.contentView.addChildView(view)
  if (visible) {
    view.setBounds(connectionBounds)
  } else {
    const backgroundWidth = Math.max(420, connectionBounds.width)
    const backgroundHeight = Math.max(680, height)
    background.setContentSize(backgroundWidth, backgroundHeight)
    view.setBounds({ x: 0, y: 0, width: backgroundWidth, height: backgroundHeight })
  }
  // Hide the host window, never the page view itself: DOM automation still needs
  // a real viewport while the native page is absent from the main UI.
  view.setVisible(true)
}
