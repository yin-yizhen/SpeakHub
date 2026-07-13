import type { WebContents } from 'electron'
import type { AutomationResult, ConversationResult } from './chatgpt-automation'

const GEMINI_URL = 'https://gemini.google.com/app'
const composerSelector = 'rich-textarea [contenteditable="true"], textarea, [contenteditable="true"], [role="textbox"]'
const sendSelector = 'button[aria-label*="Send" i], button[data-test-id*="send" i], button[aria-label*="发送"]'
const newChatSelector = 'a[href="/app"], button[aria-label*="New chat" i], button[aria-label*="新对话"]'

export function findGeminiComposer(root: ParentNode): HTMLElement | undefined { return [...root.querySelectorAll<HTMLElement>(composerSelector)].find((element) => element.isContentEditable || element.matches('textarea, [role="textbox"]')) }
export function findGeminiSendButton(root: ParentNode): HTMLButtonElement | undefined { return root.querySelector<HTMLButtonElement>(sendSelector) ?? undefined }

function pause(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }

export class GeminiAutomation {
  constructor(private readonly contents: WebContents) {}

  async startNewChat(): Promise<AutomationResult> {
    await this.contents.loadURL(GEMINI_URL); await pause(600)
    return { ok: true, message: 'Gemini new chat is ready.' }
  }

  async fillAndSendPrompt(prompt: string): Promise<AutomationResult> {
    const focused = await this.contents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(composerSelector)}); if (!el) return false; el.focus(); window.__speaksubGeminiComposer = el; return true })()`, true) as boolean
    if (!focused) return { ok: false, message: 'Gemini composer was not found. Open the connection page and check the signed-in page.' }
    this.contents.insertText(prompt); await pause(250)
    const sent = await this.contents.executeJavaScript(`(() => { const el = window.__speaksubGeminiComposer; const button = document.querySelector(${JSON.stringify(sendSelector)}); if (button && !button.disabled) { button.click(); return true } if (el) { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); return true } return false })()`, true) as boolean
    return sent ? { ok: true, message: 'Gemini practice prompt sent.' } : { ok: false, message: 'Gemini send control was not found.' }
  }

  async captureConversationUrl(): Promise<ConversationResult> {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const url = this.contents.getURL()
      if (/^https:\/\/gemini\.google\.com\/app\/[A-Za-z0-9_-]+/.test(url)) return { ok: true, message: 'Gemini practice chat recorded.', conversationUrl: url }
      await pause(250)
    }
    return { ok: false, message: 'Gemini did not expose a conversation URL; automatic cleanup will be unavailable for this turn.' }
  }

  async deleteConversation(conversationUrl: string): Promise<AutomationResult> {
    await this.contents.loadURL(conversationUrl)
    const result = await this.contents.executeJavaScript(`(() => new Promise((resolve) => {
      const deadline = Date.now() + 10000; const text = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
      const tick = () => { const controls = [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')]; const more = controls.find((el) => /more|more options|更多|选项/.test(text(el))); if (more && !more.dataset.speaksubOpened) { more.dataset.speaksubOpened = '1'; more.click(); setTimeout(tick, 200); return; } const remove = controls.find((el) => /delete|删除/.test(text(el))); if (remove) { remove.click(); setTimeout(() => { [...document.querySelectorAll('button, [role="button"]')].find((el) => /delete|删除|confirm|确认/.test(text(el)))?.click(); resolve({ ok: true, message: 'Previous SpeakSub Gemini chat deleted.' }) }, 180); return; } if (Date.now() > deadline) resolve({ ok: false, message: 'Gemini delete control was not found; the recorded chat was kept for retry.' }); else setTimeout(tick, 250) }; tick();
    }))()`, true) as AutomationResult
    return result
  }
}
