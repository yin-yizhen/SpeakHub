/** Self-contained so the exact same parser can run inside Electron's web page. */
export function readChatGPTMessages(root: ParentNode): Array<{ sourceMessageId: string; speaker: string; text: string }> {
  const selector = '[data-content-search-unit-key], article[data-testid^="conversation-turn-"], [data-message-author-role]'
  const candidates = [...root.querySelectorAll<HTMLElement>(selector)]
  const nodes = candidates.filter(node => !candidates.some(parent => parent !== node && parent.contains(node)))
  return nodes.flatMap((node, index) => {
    const attributed = node.hasAttribute('data-message-author-role') ? node : node.querySelector<HTMLElement>('[data-message-author-role]')
    const unitKey = node.getAttribute('data-content-search-unit-key') ?? ''
    const speaker = attributed?.getAttribute('data-message-author-role') || unitKey.match(/:(user|assistant)$/)?.[1]
    if (speaker !== 'user' && speaker !== 'assistant') return []
    const content = node.querySelector<HTMLElement>(speaker === 'user'
      ? '[data-user-message-bubble] [data-search-result-target], [data-user-message-bubble]'
      : '[data-markdown-text-style="assistant-message"]') ?? attributed ?? node
    const copy = content.cloneNode(true) as HTMLElement
    copy.querySelectorAll('button, [role="button"], [data-conversation-role], [aria-hidden="true"]').forEach(element => element.remove())
    // textContent includes the complete collapsed user prompt, without clipping
    // it to the visible “show more” preview. Preserve paragraph boundaries.
    copy.querySelectorAll('p, li, pre, br').forEach(element => element.append('\n'))
    const text = (copy.textContent ?? '').trim()
    const selected = node.querySelector('[data-chatgpt-selection-message-id]')
    const sourceMessageId = node.getAttribute('data-message-id') || attributed?.getAttribute('data-message-id')
      || selected?.getAttribute('data-chatgpt-selection-message-id')
      || node.getAttribute('data-chatgpt-search-message-ids')?.trim().split(/\s+/)[0]
      || node.id || unitKey || `turn-${index}`
    return text ? [{ sourceMessageId, speaker, text }] : []
  })
}
