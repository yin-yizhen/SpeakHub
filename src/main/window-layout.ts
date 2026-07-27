export interface DisplayWorkArea { x: number; y: number; width: number; height: number }
export interface WindowBounds { x: number; y: number; width: number; height: number }
export type ResizeDirection = 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export function subtitleHeight(fontSize = 25, maxLines = 4): number {
  return Math.min(360, Math.max(220, Math.ceil(fontSize * maxLines * 1.75 + 54)))
}

export function subtitleBounds(workArea: DisplayWorkArea, width = Math.min(920, Math.round(workArea.width * 0.7)), height = 220): WindowBounds {
  return { x: Math.round(workArea.x + (workArea.width - width) / 2), y: Math.round(workArea.y + workArea.height - height - 42), width, height }
}

export function embeddedConnectionBounds(content: Pick<WindowBounds, 'width' | 'height'>, sidebarWidth = 420): WindowBounds {
  return { x: sidebarWidth, y: 0, width: Math.max(0, content.width - sidebarWidth), height: content.height }
}

export function resizeBounds(origin: WindowBounds, direction: ResizeDirection, deltaX: number, deltaY: number, minWidth = 420, minHeight = 150): WindowBounds {
  const right = origin.x + origin.width
  const bottom = origin.y + origin.height
  let x = origin.x
  let y = origin.y
  let width = origin.width
  let height = origin.height
  if (direction.includes('right')) width = Math.max(minWidth, origin.width + deltaX)
  if (direction.includes('left')) { width = Math.max(minWidth, origin.width - deltaX); x = right - width }
  if (direction.includes('bottom')) height = Math.max(minHeight, origin.height + deltaY)
  if (direction.includes('top')) { height = Math.max(minHeight, origin.height - deltaY); y = bottom - height }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}
