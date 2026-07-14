import type { WebContents } from 'electron'
import type { TranscriptEvent } from '../shared/types'
import type { SourceAdapter } from './chatgpt-adapter'

type PageMessage = { sourceMessageId: string; speaker: 'assistant' | 'user'; text: string; status: 'streaming' | 'complete' }

/** Gemini deliberately has an independent selector contract from ChatGPT. */
export function parseGeminiPage(root: ParentNode): PageMessage[] {
  const selectors: Array<[string, PageMessage['speaker']]> = [
    ['[data-test-id="user-query"], user-query, .query-text, [class*="user-query" i]', 'user'],
    ['[data-test-id="model-response"], model-response, .model-response-text, [class*="model-response" i]', 'assistant']
  ]
  const seen = new Set<string>()
  return selectors.flatMap(([selector, speaker]) => [...root.querySelectorAll<HTMLElement>(selector)].flatMap((node, index) => {
    const text = node.innerText?.trim() || node.textContent?.trim() || ''
    const sourceMessageId = node.dataset.messageId || node.id || `${speaker}-${index}`
    if (!text || seen.has(`${speaker}:${sourceMessageId}`)) return []
    seen.add(`${speaker}:${sourceMessageId}`)
    return [{ sourceMessageId, speaker, text, status: 'complete' as const }]
  }))
}

const observerScript = `(() => {
  if (window.__speaksubGeminiDrain) return;
  const queue = []; const seen = new Map();
  const selectors = [['[data-test-id="user-query"], user-query, .query-text, [class*="user-query" i]', 'user'], ['[data-test-id="model-response"], model-response, .model-response-text, [class*="model-response" i]', 'assistant']];
  const read = (emit = true) => selectors.forEach(([selector, speaker]) => document.querySelectorAll(selector).forEach((node, index) => {
    const text = (node.innerText || node.textContent || '').trim(); const sourceMessageId = node.getAttribute('data-message-id') || node.id || speaker + '-' + index; const key = speaker + ':' + sourceMessageId;
    const busy = Boolean(document.querySelector('button[aria-label*="Stop" i], button[aria-label*="停止"], [class*="loading" i]')); const status = speaker === 'assistant' && busy ? 'streaming' : 'complete'; const signature = status + '\\0' + text;
    if (!text || seen.get(key) === signature) return; seen.set(key, signature); if (emit) queue.push({ sourceMessageId, speaker, text, status });
  }));
  const observer = new MutationObserver(() => read(true)); observer.observe(document.body, { childList: true, subtree: true, characterData: true }); read(false);
  window.__speaksubGeminiDrain = () => queue.splice(0, queue.length);
  window.__speaksubGeminiStop = () => { observer.disconnect(); delete window.__speaksubGeminiDrain; delete window.__speaksubGeminiStop; };
})()`

export class GeminiAdapter implements SourceAdapter {
  private timer?: NodeJS.Timeout
  private supported = true

  constructor(private readonly contents: WebContents, private readonly onEvent: (event: Omit<TranscriptEvent, 'id' | 'sessionId'>) => void, private readonly onUnsupported: () => void) {}

  start(): void { this.supported = true; void this.contents.executeJavaScript(observerScript).catch(() => this.markUnsupported()); this.timer = setInterval(() => void this.drain(), 350) }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; void this.contents.executeJavaScript('window.__speaksubGeminiStop?.()').catch(() => undefined) }

  private async drain(): Promise<void> {
    if (!this.supported || this.contents.isDestroyed()) return
    try {
      const rows = await this.contents.executeJavaScript('window.__speaksubGeminiDrain?.() ?? null') as PageMessage[] | null
      if (!rows) return this.markUnsupported()
      for (const row of rows) this.onEvent({ ...row, receivedAt: new Date().toISOString() })
    } catch { this.markUnsupported() }
  }

  private markUnsupported(): void { if (this.supported) { this.supported = false; this.onUnsupported() } }
}
