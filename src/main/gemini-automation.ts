import type { WebContents } from 'electron'
import type { AutomationResult, ConversationResult } from './chatgpt-automation'

const GEMINI_URL = 'https://gemini.google.com/app'
const composerSelector = 'rich-textarea [contenteditable="true"], textarea, [contenteditable="true"], [role="textbox"]'
const sendSelector = 'button[aria-label*="Send" i], button[data-test-id*="send" i], button[aria-label*="发送"]'
const newChatSelector = 'a[href="/app"], button[aria-label*="New chat" i], button[aria-label*="新对话"]'
const voiceSelector = 'button[aria-label*="voice" i], button[aria-label*="语音"], button[data-test-id*="voice" i]'
const endVoiceSelector = 'button[aria-label*="end voice" i], button[aria-label*="leave voice" i], button[aria-label*="结束语音"], button[aria-label*="退出语音"], button[data-test-id*="end-voice" i]'

export function findGeminiComposer(root: ParentNode): HTMLElement | undefined { return [...root.querySelectorAll<HTMLElement>(composerSelector)].find((element) => element.isContentEditable || element.matches('textarea, [role="textbox"]')) }
export function findGeminiSendButton(root: ParentNode): HTMLButtonElement | undefined { return root.querySelector<HTMLButtonElement>(sendSelector) ?? undefined }
export function findGeminiVoiceButton(root: ParentNode): HTMLButtonElement | undefined { return root.querySelector<HTMLButtonElement>(voiceSelector) ?? undefined }
export function findGeminiEndVoiceButton(root: ParentNode): HTMLButtonElement | undefined { return root.querySelector<HTMLButtonElement>(endVoiceSelector) ?? undefined }

function pause(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }

export class GeminiAutomation {
  constructor(private readonly contents: WebContents) {}

  async isReady(): Promise<boolean> { return this.contents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(composerSelector)}))`, true) as Promise<boolean> }

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
    const result = await this.contents.executeJavaScript(`(targetUrl => new Promise((resolve) => {
      const target = new URL(targetUrl).pathname; const deadline = Date.now() + 12000; const text = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
      const targetLink = () => [...document.querySelectorAll('a[href*="/app/"]')].find((anchor) => { try { return new URL(anchor.href).pathname === target; } catch { return false; } });
      const tick = () => {
        const link = targetLink(); if (!link) { if (Date.now() > deadline) resolve({ ok: false, message: 'The exact recorded Gemini chat was not found; nothing was deleted.' }); else setTimeout(tick, 250); return; }
        const row = link.closest('li, [data-test-id], [role="listitem"], div'); const menu = [...(row?.querySelectorAll('button, [role="button"]') || [])].find((el) => /more|more options|更多|选项/.test(text(el)));
        if (menu && !menu.dataset.speaksubOpened) { menu.dataset.speaksubOpened = '1'; menu.click(); setTimeout(tick, 200); return; }
        const remove = [...document.querySelectorAll('[role="menuitem"], button')].find((el) => /delete|删除/.test(text(el))); if (remove) { remove.click(); setTimeout(() => {
          const confirm = [...document.querySelectorAll('button, [role="button"]')].find((el) => /delete|删除|confirm|确认/.test(text(el))); if (!confirm) { resolve({ ok: false, message: 'Gemini delete confirmation was not found.' }); return; } confirm.click();
          const verifyDeadline = Date.now() + 8000; const verify = () => { if (!targetLink()) resolve({ ok: true, message: 'Previous SpeakSub Gemini chat deleted.' }); else if (Date.now() > verifyDeadline) resolve({ ok: false, message: 'Gemini did not confirm deletion; the record was kept for retry.' }); else setTimeout(verify, 250) }; verify();
        }, 180); return; }
        if (Date.now() > deadline) resolve({ ok: false, message: 'Gemini delete control was not found for the recorded chat.' }); else setTimeout(tick, 250);
      }; tick();
    }))(${JSON.stringify(conversationUrl)})`, true) as AutomationResult
    return result
  }

  async waitForReplyAndStartVoice(): Promise<AutomationResult> {
    return this.contents.executeJavaScript(`(() => new Promise((resolve) => {
      const deadline = Date.now() + 45000;
      const selector = ${JSON.stringify(voiceSelector)};
      const tick = () => { const button = [...document.querySelectorAll(selector)].find((item) => !item.disabled && item.getBoundingClientRect().width > 18); if (button) { button.click(); resolve({ ok: true, message: 'Gemini voice has been requested.' }); return; } if (Date.now() > deadline) resolve({ ok: false, message: 'Gemini voice control was not found. Open the connection page and start voice manually.' }); else setTimeout(tick, 250); }; tick();
    }))()`, true) as Promise<AutomationResult>
  }

  async stopVoice(): Promise<AutomationResult> {
    return this.contents.executeJavaScript(`(() => { const button = [...document.querySelectorAll(${JSON.stringify(endVoiceSelector)})].find((item) => !item.disabled && item.getBoundingClientRect().width > 18); if (!button) return { ok: false, message: 'Gemini voice end control was not found. End voice manually on the connection page.' }; button.click(); return { ok: true, message: 'Gemini voice end requested.' }; })()`, true) as Promise<AutomationResult>
  }
}
