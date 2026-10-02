import type { WebContents } from 'electron'
import { normalizeSpeaker } from '../shared/transcript'
import type { TranscriptEvent } from '../shared/types'
import { readChatGPTMessages } from './chatgpt-page-dom'

type PageMessage = { sourceMessageId: string; speaker: string; text: string; status: 'streaming' | 'complete' }

/** Web practice adapters share this small lifecycle. */
export interface SourceAdapter {
  start(): void
  stop(): void
}

/** Testable selector contract for the current ChatGPT conversation DOM. */
export function parseChatGPTPage(root: ParentNode): PageMessage[] {
  return readChatGPTMessages(root).map(row => ({ ...row, status: 'complete' }))
}

const observerScript = `(() => {
  if (window.__speaksubDrain) return;
  const readMessages = ${readChatGPTMessages.toString()};
  const queue = []; const seen = new Map();
  const read = (emit = true) => {
    readMessages(document).forEach(({sourceMessageId, speaker, text}) => {
      const busy = [...document.querySelectorAll('button[data-testid="stop-button"], button[aria-label="Stop generating" i], button[aria-label="Stop" i], button[aria-label="停止生成"], button[aria-label="停止"]')].some(button => button.getClientRects().length > 0);
      const status = speaker === 'assistant' && busy ? 'streaming' : 'complete'; const signature = status + '\\0' + text;
      if (seen.get(sourceMessageId) === signature) return;
      seen.set(sourceMessageId, signature);
      if (emit) queue.push({ sourceMessageId, speaker, text, status });
    });
  };
  const observer = new MutationObserver(() => read(true)); observer.observe(document.body, { childList: true, subtree: true, characterData: true }); read(true);
  // Final generation state can change via attributes alone. Re-read before
  // draining so the last streaming chunk always receives a complete update.
  window.__speaksubDrain = () => { read(true); return queue.splice(0, queue.length); };
  window.__speaksubStop = () => { observer.disconnect(); delete window.__speaksubDrain; delete window.__speaksubStop; };
})()`

export class ChatGPTAdapter implements SourceAdapter {
  private timer?: NodeJS.Timeout
  private generation = 0
  private draining = false
  private failures = 0

  constructor(private readonly contents: WebContents, private readonly onEvent: (event: Omit<TranscriptEvent, 'id' | 'sessionId'>) => void, private readonly onUnsupported: () => void) {}

  start(): void {
    if (this.timer) return
    this.generation += 1
    this.failures = 0
    void this.drain()
    this.timer = setInterval(() => void this.drain(), 350)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.generation += 1
    void this.contents.executeJavaScript('window.__speaksubStop?.()').catch(() => undefined)
  }

  private async drain(): Promise<void> {
    if (this.draining || this.contents.isDestroyed()) return
    const generation = this.generation
    this.draining = true
    try {
      // Navigation can remove the page observer, or transiently reject execution.
      // Ensure and drain in one page call; every later poll can recover it.
      const rows = await this.contents.executeJavaScript(`(() => {
        if (!document.body) return null;
        ${observerScript};
        return window.__speaksubDrain?.() ?? null;
      })()`) as PageMessage[] | null
      if (generation !== this.generation) return
      if (!rows) { this.markUnsupported(); return }
      this.failures = 0
      for (const row of rows) {
        const speaker = normalizeSpeaker(row.speaker)
        if (!speaker) continue
        this.onEvent({ sourceMessageId: row.sourceMessageId, speaker, text: row.text, status: row.status, receivedAt: new Date().toISOString() })
      }
    } catch { if (generation === this.generation) this.markUnsupported() }
    finally { this.draining = false }
  }

  private markUnsupported(): void {
    this.failures += 1
    // Allow a short document transition before showing an error, but keep
    // polling after the warning so recovery never requires ending practice.
    if (this.failures === 5) this.onUnsupported()
  }
}
