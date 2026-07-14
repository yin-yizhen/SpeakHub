import type { WebContents } from 'electron'
import { normalizeSpeaker } from '../shared/transcript'
import type { TranscriptEvent } from '../shared/types'

type PageMessage = { sourceMessageId: string; speaker: string; text: string; status: 'streaming' | 'complete' }

/** Future sources such as Gemini only need to implement this lifecycle. */
export interface SourceAdapter {
  start(): void
  stop(): void
}

/** Testable selector contract for the current ChatGPT conversation DOM. */
export function parseChatGPTPage(root: ParentNode): PageMessage[] {
  const turns = [...root.querySelectorAll<HTMLElement>('article[data-testid^="conversation-turn-"]')]
  const nodes = turns.length ? turns : [...root.querySelectorAll<HTMLElement>('[data-message-author-role]')]
  return nodes.flatMap((node, index) => {
    const attributed = node.dataset.messageAuthorRole ? node : node.querySelector<HTMLElement>('[data-message-author-role]')
    const speaker = attributed?.dataset.messageAuthorRole
    const text = node.innerText?.trim() || node.textContent?.trim() || ''
    const sourceMessageId = node.dataset.messageId || attributed?.dataset.messageId || node.id || `turn-${index}`
    return speaker && text ? [{ sourceMessageId, speaker, text, status: 'complete' as const }] : []
  })
}

const observerScript = `(() => {
  if (window.__speaksubDrain) return;
  const queue = []; const seen = new Map();
  const read = (emit = true) => {
    const turns = [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')];
    const nodes = turns.length ? turns : [...document.querySelectorAll('[data-message-author-role]')];
    nodes.forEach((node, index) => {
      const attributed = node.getAttribute('data-message-author-role') ? node : node.querySelector('[data-message-author-role]');
      const speaker = attributed?.getAttribute('data-message-author-role');
      const text = (node.innerText || '').trim();
      if (!speaker || !text) return;
      const sourceMessageId = node.getAttribute('data-message-id') || attributed?.getAttribute('data-message-id') || node.id || 'turn-' + index;
      const busy = Boolean(document.querySelector('button[data-testid*="stop"], button[aria-label*="Stop"], button[aria-label*="停止"]'));
      const status = speaker === 'assistant' && busy ? 'streaming' : 'complete'; const signature = status + '\\0' + text;
      if (seen.get(sourceMessageId) === signature) return;
      seen.set(sourceMessageId, signature);
      if (emit) queue.push({ sourceMessageId, speaker, text, status });
    });
  };
  const observer = new MutationObserver(() => read(true)); observer.observe(document.body, { childList: true, subtree: true, characterData: true }); read(false);
  window.__speaksubDrain = () => queue.splice(0, queue.length);
  window.__speaksubStop = () => { observer.disconnect(); delete window.__speaksubDrain; delete window.__speaksubStop; };
})()`

export class ChatGPTAdapter implements SourceAdapter {
  private timer?: NodeJS.Timeout
  private supported = true

  constructor(private readonly contents: WebContents, private readonly onEvent: (event: Omit<TranscriptEvent, 'id' | 'sessionId'>) => void, private readonly onUnsupported: () => void) {}

  start(): void {
    this.supported = true
    void this.contents.executeJavaScript(observerScript).catch(() => this.markUnsupported())
    this.timer = setInterval(() => void this.drain(), 350)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    void this.contents.executeJavaScript('window.__speaksubStop?.()').catch(() => undefined)
  }

  private async drain(): Promise<void> {
    if (!this.supported || this.contents.isDestroyed()) return
    try {
      const rows = await this.contents.executeJavaScript('window.__speaksubDrain?.() ?? null') as PageMessage[] | null
      if (!rows) return this.markUnsupported()
      for (const row of rows) {
        const speaker = normalizeSpeaker(row.speaker)
        if (!speaker) continue
        this.onEvent({ sourceMessageId: row.sourceMessageId, speaker, text: row.text, status: row.status, receivedAt: new Date().toISOString() })
      }
    } catch { this.markUnsupported() }
  }

  private markUnsupported(): void { if (this.supported) { this.supported = false; this.onUnsupported() } }
}
