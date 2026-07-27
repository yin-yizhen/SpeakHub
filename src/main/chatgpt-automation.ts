import type { WebContents } from 'electron'

export interface AutomationResult { ok: boolean; message: string }
export interface ConversationResult extends AutomationResult { conversationUrl?: string }

const composerSelector = '#prompt-textarea, textarea, [contenteditable], [role="textbox"], [placeholder], [aria-label], [aria-placeholder], [data-placeholder]'
const sendSelector = 'button[data-testid*="send"], button[aria-label*="Send"], button[aria-label*="发送"], button[title*="Send"], button[title*="发送"]'
const stopSelector = 'button[data-testid*="stop"], button[aria-label*="Stop"], button[aria-label*="停止"]'
const voiceSelector = 'button[data-testid*="voice"], button[aria-label*="voice" i], button[aria-label*="语音"], button[title*="voice" i], button[title*="语音"]'
const endVoiceSelector = [
  'button[data-testid*="end-voice" i]', 'button[data-testid*="leave-voice" i]', 'button[data-testid*="exit-voice" i]', 'button[data-testid*="voice-end" i]',
  'button[aria-label*="end voice" i]', 'button[aria-label*="leave voice" i]', 'button[aria-label*="exit voice" i]', 'button[aria-label*="end conversation" i]',
  'button[aria-label*="结束语音"]', 'button[aria-label*="退出语音"]', 'button[aria-label*="结束对话"]',
  'button[title*="end voice" i]', 'button[title*="leave voice" i]', 'button[title*="结束语音"]', 'button[title*="退出语音"]'
].join(', ')
const newChatSelector = 'a[href="/"], button[data-testid*="new-chat" i], button[aria-label*="new chat" i], button[aria-label*="新聊天"]'

const deleteLabels = ['delete', '删除']
const conversationMenuSelector = 'button[data-testid*="conversation-options" i], button[data-testid*="conversation-menu" i], button[aria-label*="more" i], button[aria-label*="options" i], button[aria-label*="menu" i], button[aria-label*="更多"], button[aria-label*="选项"]'

function labelOf(element: Element): string {
  return [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('data-testid')].filter(Boolean).join(' ').trim().toLowerCase()
}

function scoreComposer(element: HTMLElement): number {
  const attributes = [element.id, element.getAttribute('placeholder'), element.getAttribute('aria-label'), element.getAttribute('aria-placeholder'), element.getAttribute('data-placeholder')].filter(Boolean).join(' ').toLowerCase()
  let score = 0
  if (element.id === 'prompt-textarea') score += 200
  if (/问问\s*chatgpt|询问\s*chatgpt|message\s*chatgpt|chatgpt/.test(attributes)) score += 160
  if (element.isContentEditable || element.getAttribute('contenteditable') != null) score += 40
  if (element.matches('textarea, input, [role="textbox"]')) score += 25
  return score
}

export function findComposer(root: ParentNode): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(composerSelector)].sort((a, b) => scoreComposer(b) - scoreComposer(a)).find((element) => scoreComposer(element) > 0)
}
export function findSendButton(root: ParentNode): HTMLButtonElement | undefined { return root.querySelector<HTMLButtonElement>(sendSelector) ?? undefined }
export function findStopButton(root: ParentNode): HTMLButtonElement | undefined { return root.querySelector<HTMLButtonElement>(stopSelector) ?? undefined }
export function findVoiceButton(root: ParentNode): HTMLButtonElement | undefined { return root.querySelector<HTMLButtonElement>(voiceSelector) ?? undefined }
export function findEndVoiceButton(root: ParentNode): HTMLButtonElement | undefined { return root.querySelector<HTMLButtonElement>(endVoiceSelector) ?? undefined }

export function findConversationRow(root: ParentNode, conversationUrl: string): HTMLElement | undefined {
  const targetPath = new URL(conversationUrl).pathname
  const link = [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]')].find((candidate) => {
    try { return new URL(candidate.href, 'https://chatgpt.com').pathname === targetPath } catch { return false }
  })
  if (!link) return undefined
  let row = link.parentElement
  while (row && row !== (root instanceof Document ? root.body : root)) {
    if (row.querySelector(conversationMenuSelector)) return row
    row = row.parentElement
  }
  return undefined
}

export function findConversationMenuButton(row: ParentNode): HTMLButtonElement | undefined {
  const buttons = [...row.querySelectorAll<HTMLButtonElement>(conversationMenuSelector)].filter((button) => !button.disabled)
  return buttons.find((button) => /conversation-options|conversation-menu/.test(labelOf(button))) ?? buttons.find((button) => /more|options|menu|更多|选项/.test(labelOf(button)))
}

export function findDeleteMenuItem(menu: ParentNode): HTMLElement | undefined {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], button, [role="button"]')].find((item) => !('disabled' in item && Boolean((item as HTMLButtonElement).disabled)) && deleteLabels.includes(labelOf(item)))
}

export function findDeleteConfirmationButton(dialog: ParentNode): HTMLButtonElement | undefined {
  return [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')].find((button) => deleteLabels.includes(labelOf(button)))
}

export function fillComposer(composer: HTMLElement, prompt: string): void {
  composer.focus()
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), 'value')?.set?.call(composer, prompt)
  else composer.textContent = prompt
  composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }))
}

const pageComposerLocator = `(() => {
  const selector = ${JSON.stringify(composerSelector)};
  const isVisible = (element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 80 && rect.height > 12 && style.visibility !== 'hidden' && style.display !== 'none'; };
  const score = (element) => {
    const attributes = [element.id, element.getAttribute('placeholder'), element.getAttribute('aria-label'), element.getAttribute('aria-placeholder'), element.getAttribute('data-placeholder')].filter(Boolean).join(' ').toLowerCase();
    let value = 0;
    if (element.id === 'prompt-textarea') value += 200;
    if (/问问\\s*chatgpt|询问\\s*chatgpt|message\\s*chatgpt|chatgpt/.test(attributes)) value += 160;
    if (element.isContentEditable || element.hasAttribute('contenteditable')) value += 40;
    if (element.matches('textarea, input, [role="textbox"]')) value += 25;
    return value;
  };
  const candidates = [...document.querySelectorAll(selector)].filter(isVisible).map((element) => ({ element, score: score(element) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const composer = candidates[0]?.element;
  return { composer, diagnostics: candidates.slice(0, 4).map(({ element, score }) => ({ tag: element.tagName, id: element.id, placeholder: element.getAttribute('placeholder'), ariaLabel: element.getAttribute('aria-label'), dataPlaceholder: element.getAttribute('data-placeholder'), score })) };
})()`

const focusComposerScript = `(() => {
  const result = ${pageComposerLocator}; const composer = result.composer;
  if (!composer) return { focused: false, diagnostics: result.diagnostics };
  window.__speaksubComposer = composer; composer.focus(); return { focused: document.activeElement === composer || composer.contains(document.activeElement), diagnostics: result.diagnostics };
})()`

const clickComposerSendScript = `(() => {
  const composer = (${pageComposerLocator}).composer;
  if (!composer) return false;
  const scope = composer.closest('form') || composer.parentElement?.parentElement || document;
  const explicit = scope.querySelector(${JSON.stringify(sendSelector)});
  if (explicit && !explicit.disabled) { explicit.click(); return true; }
  const candidates = [...scope.querySelectorAll('button:not([disabled])')]
    .filter((button) => !/microphone|麦克风|voice|语音/i.test(button.getAttribute('aria-label') || button.getAttribute('title') || ''))
    .map((button) => ({ button, rect: button.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 20 && rect.height > 20 && rect.bottom > composer.getBoundingClientRect().top - 100)
    .sort((a, b) => b.rect.right - a.rect.right);
  if (!candidates[0]) return false;
  candidates[0].button.click(); return true;
})()`

const readComposerScript = `(() => { const composer = (${pageComposerLocator}).composer; return composer?.innerText || composer?.value || composer?.textContent || ''; })()`

const confirmPromptSentScript = `(prompt => new Promise((resolve) => {
  const token = prompt.slice(0, 20);
  const deadline = Date.now() + 5000;
  const read = () => {
    const composer = (${pageComposerLocator}).composer;
    const text = composer?.innerText || composer?.value || composer?.textContent || '';
    if (!text.includes(token)) return resolve(true);
    if (Date.now() >= deadline) return resolve(false);
    setTimeout(read, 120);
  };
  read();
}))`

const waitForReplyAndStartVoiceScript = `(() => new Promise((resolve) => {
  const selector = ${JSON.stringify(voiceSelector)}; const endSelector = ${JSON.stringify(endVoiceSelector)};
  const deadline = Date.now() + 45000; let sawBusy = false; let lastBusyAt = Date.now(); let assistantSeenAt = 0;
  const isVisible = element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 18 && rect.height > 18 && style.visibility !== 'hidden' && style.display !== 'none'; };
  const isBusy = () => Boolean(document.querySelector(${JSON.stringify(stopSelector)})) || /正在思考|生成中|Thinking/i.test(document.body.innerText || '');
  const hasAssistantReply = () => {
    const turns = [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')];
    const nodes = turns.length ? turns : [...document.querySelectorAll('[data-message-author-role]')];
    return nodes.some(node => {
      const attributed = node.getAttribute('data-message-author-role') ? node : node.querySelector('[data-message-author-role]');
      return attributed?.getAttribute('data-message-author-role') === 'assistant' && (node.innerText || node.textContent || '').trim().length > 0;
    });
  };
  const findStart = () => [...document.querySelectorAll(selector)].find(button => isVisible(button) && !button.disabled && !button.matches(endSelector));
  const attempt = () => {
    const now = Date.now(); const busy = isBusy(); const hasReply = hasAssistantReply();
    if (busy) { sawBusy = true; lastBusyAt = now; }
    if (hasReply && !assistantSeenAt) assistantSeenAt = now;
    const stableSince = Math.max(lastBusyAt, assistantSeenAt);
    const replyComplete = !busy && hasReply && now - stableSince >= 900;
    if (!replyComplete) {
      if (now >= deadline) { resolve({ ok: false, message: busy ? 'ChatGPT 仍在回复，等待语音入口超时。' : 'ChatGPT 未确认首条回复完成，未启动语音。' }); return; }
      setTimeout(attempt, 250); return;
    }
    const voice = findStart();
    if (voice) {
      voice.click();
      const confirmStarted = () => {
        if (!voice.isConnected || !isVisible(voice) || document.querySelector(endSelector)) { resolve({ ok: true, message: '已启动 ChatGPT 语音对话，正在发送练习提示词。' }); return; }
        if (Date.now() >= deadline) { resolve({ ok: false, message: '已点击 ChatGPT 的语音按钮，但语音对话界面没有打开。请在连接页手动检查登录状态后重试。' }); return; }
        setTimeout(confirmStarted, 150);
      };
      confirmStarted(); return;
    }
    if (Date.now() >= deadline) { resolve({ ok: false, message: 'ChatGPT 首条回复已完成，但未找到“启动语音功能”按钮。请打开连接页后重试。' }); return; }
    setTimeout(attempt, 200);
  };
  attempt();
}))()`

const endVoiceScript = `(() => {
  const selector = ${JSON.stringify(endVoiceSelector)};
  const isVisible = (element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 18 && rect.height > 18 && style.visibility !== 'hidden' && style.display !== 'none'; };
  const button = [...document.querySelectorAll(selector)].filter(isVisible).find((candidate) => !candidate.disabled);
  if (!button) return { ok: false, message: '未找到 ChatGPT 的结束语音按钮。请打开连接页，在 ChatGPT 中手动结束本次语音。' };
  button.click();
  return { ok: true, message: '已请求结束 ChatGPT 后台语音。' };
})()`

const newChatScript = `(() => {
  const selector = ${JSON.stringify(newChatSelector)};
  const button = [...document.querySelectorAll(selector)].find((element) => { const rect = element.getBoundingClientRect(); return rect.width > 10 && rect.height > 10; });
  if (!button) return false;
  button.click(); return true;
})()`

const captureConversationTitleScript = `(conversationUrl => new Promise((resolve) => {
  const targetPath = new URL(conversationUrl).pathname;
  const deadline = Date.now() + 15000;
  const findTitle = () => {
    const link = [...document.querySelectorAll('a[href*="/c/"]')].find(anchor => { try { return new URL(anchor.href).pathname === targetPath; } catch { return false; } });
    const title = link?.textContent?.trim();
    if (title && !['新聊天', 'New chat'].includes(title)) return resolve({ ok: true, conversationTitle: title });
    if (Date.now() >= deadline) return resolve({ ok: false });
    setTimeout(findTitle, 250);
  };
  findTitle();
}))`

const deleteConversationScript = `(target => new Promise((resolve) => {
  const targetIsTitle = target.startsWith('title:');
  const targetTitle = targetIsTitle ? target.slice('title:'.length).trim() : undefined;
  const targetPath = targetIsTitle ? undefined : new URL(target).pathname;
  const deadline = Date.now() + 15000;
  const deleteLabels = ['delete', '删除'];
  const isVisible = element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 8 && rect.height > 8 && style.visibility !== 'hidden' && style.display !== 'none'; };
  const labelOf = element => [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('data-testid')].filter(Boolean).join(' ').trim().toLowerCase();
  const targetLink = () => [...document.querySelectorAll('a[href*="/c/"]')].find(anchor => {
    if (targetIsTitle) return anchor.textContent?.trim() === targetTitle;
    try { return new URL(anchor.href).pathname === targetPath; } catch { return false; }
  });
  const rowFor = link => { let row = link.parentElement; while (row && row !== document.body) { const menu = [...row.querySelectorAll('button[data-testid*="conversation-options" i], button[data-testid*="conversation-menu" i], button[aria-label*="more" i], button[aria-label*="options" i], button[aria-label*="menu" i], button[aria-label*="更多"], button[aria-label*="选项"]')].find(button => isVisible(button) && !button.disabled); if (menu) return { row, menu }; row = row.parentElement; } return undefined; };
  const openDeleteMenu = () => [...document.querySelectorAll('[role="menu"]')].find(menu => isVisible(menu) && [...menu.querySelectorAll('[role="menuitem"], button, [role="button"]')].some(item => deleteLabels.includes(labelOf(item))));
  const deleteItem = menu => [...menu.querySelectorAll('[role="menuitem"], button, [role="button"]')].find(item => isVisible(item) && !item.disabled && deleteLabels.includes(labelOf(item)));
  const deleteDialog = () => [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].find(dialog => isVisible(dialog) && [...dialog.querySelectorAll('button:not([disabled])')].some(button => deleteLabels.includes(labelOf(button))));
  const confirmation = dialog => [...dialog.querySelectorAll('button:not([disabled])')].find(button => isVisible(button) && deleteLabels.includes(labelOf(button)));
  const fail = message => resolve({ ok: false, message });
  const wait = check => { const value = check(); if (value) return value; if (Date.now() >= deadline) return undefined; return null; };
  const findTarget = () => {
    const link = targetLink();
    if (!link) return Date.now() >= deadline ? fail('未在 ChatGPT 侧边栏找到已记录的 SpeakSub 对话。') : setTimeout(findTarget, 200);
    link.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const target = rowFor(link);
    if (!target) return Date.now() >= deadline ? fail('找到了目标对话，但未找到其专属更多菜单按钮。') : setTimeout(findTarget, 200);
    target.row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); target.row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); target.menu.click();
    waitForMenu();
  };
  const waitForMenu = () => { const menu = wait(openDeleteMenu); if (menu === null) return setTimeout(waitForMenu, 150); if (!menu) return fail('目标对话的更多菜单未出现删除操作。'); const item = deleteItem(menu); if (!item) return fail('目标对话的菜单中未找到删除操作。'); item.click(); waitForDialog(); };
  const waitForDialog = () => { const dialog = wait(deleteDialog); if (dialog === null) return setTimeout(waitForDialog, 150); if (!dialog) return fail('删除确认框未出现。'); const button = confirmation(dialog); if (!button) return fail('删除确认框中未找到确认删除按钮。'); button.click(); verify(); };
  const verify = () => { if (!targetLink()) return resolve({ ok: true, message: '已删除上一轮 SpeakSub ChatGPT 对话。' }); if (Date.now() >= deadline) return fail('ChatGPT 未确认目标对话已删除；记录将保留重试。'); setTimeout(verify, 200); };
  findTarget();
}))`

function pause(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }

export class ChatGPTAutomation {
  constructor(private readonly contents: WebContents) {}

  async isReady(): Promise<boolean> { return this.contents.executeJavaScript(`Boolean((${pageComposerLocator}).composer)`, true) as Promise<boolean> }

  async fillAndSendPrompt(prompt: string): Promise<AutomationResult> {
    const deadline = Date.now() + 45_000
    const promptPrefix = prompt.slice(0, 20)
    let latest: { focused: boolean; diagnostics: Array<Record<string, unknown>> } | undefined
    let enteredText = ''
    let attempt = 0
    while (Date.now() < deadline) {
      latest = await this.waitForComposerFocus(1_500)
      if (!latest.focused) { await pause(300); continue }
      if (attempt > 0) {
        this.contents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] })
        this.contents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] })
        this.contents.sendInputEvent({ type: 'keyDown', keyCode: 'BACKSPACE' })
        this.contents.sendInputEvent({ type: 'keyUp', keyCode: 'BACKSPACE' })
        await pause(150)
      }
      this.contents.insertText(prompt)
      await pause(350)
      enteredText = await this.contents.executeJavaScript(readComposerScript) as string
      if (enteredText.includes(promptPrefix)) break
      attempt += 1
      await pause(550)
    }
    if (!enteredText.includes(promptPrefix)) return { ok: false, message: latest?.focused ? 'ChatGPT 输入框在 45 秒内仍未接受提示词。请打开连接页检查网络或登录状态后重试。' : 'ChatGPT 页面在 45 秒内仍未准备好输入框。请打开连接页检查网络或登录状态后重试。' }
    const clicked = await this.contents.executeJavaScript(clickComposerSendScript, true) as boolean
    if (!clicked) { this.contents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' }); this.contents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' }) }
    let sent = await this.contents.executeJavaScript(`(${confirmPromptSentScript})(${JSON.stringify(prompt)})`, true) as boolean
    if (!sent && clicked) {
      this.contents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' }); this.contents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' })
      sent = await this.contents.executeJavaScript(`(${confirmPromptSentScript})(${JSON.stringify(prompt)})`, true) as boolean
    }
    if (!sent) return { ok: false, message: 'ChatGPT 未确认收到提示词：文本仍停留在输入框中。请打开连接页后重试。' }
    return { ok: true, message: clicked ? '提示词已发送，正在等待 ChatGPT 回复。' : '提示词已通过 Enter 发送，正在等待 ChatGPT 回复。' }
  }

  async startNewChat(): Promise<AutomationResult> {
    const clicked = await this.contents.executeJavaScript(newChatScript, true) as boolean
    if (!clicked) await this.contents.loadURL('https://chatgpt.com/')
    return { ok: true, message: clicked ? '已新建 ChatGPT 聊天。' : '已回到 ChatGPT 新聊天页。' }
  }

  private async waitForComposerFocus(timeoutMs = 8_000): Promise<{ focused: boolean; diagnostics: Array<Record<string, unknown>> }> {
    const deadline = Date.now() + timeoutMs
    let latest: { focused: boolean; diagnostics: Array<Record<string, unknown>> } = { focused: false, diagnostics: [] }
    do {
      latest = await this.contents.executeJavaScript(focusComposerScript, true) as typeof latest
      if (latest.focused) return latest
      if (Date.now() >= deadline) break
      await pause(200)
    } while (true)
    return latest
  }

  async captureConversationUrl(): Promise<ConversationResult> {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const url = this.contents.getURL()
      if (/^https:\/\/chatgpt\.com\/c\//.test(url)) return { ok: true, message: '已记录 SpeakSub 聊天。', conversationUrl: url }
      await pause(250)
    }
    return { ok: false, message: 'ChatGPT 未提供会话地址；本轮不会在下次启动时自动清理。' }
  }

  async captureConversationTitle(conversationUrl: string): Promise<string | undefined> {
    const result = await this.contents.executeJavaScript(`(${captureConversationTitleScript})(${JSON.stringify(conversationUrl)})`, true) as { ok: boolean; conversationTitle?: string }
    return result.ok && result.conversationTitle ? result.conversationTitle : undefined
  }

  async deleteConversation(conversationUrl: string): Promise<AutomationResult> {
    const normalizedUrl = conversationUrl.replace('/c/WEB:', '/c/')
    await this.contents.loadURL(normalizedUrl)
    return this.contents.executeJavaScript(`(${deleteConversationScript})(${JSON.stringify(normalizedUrl)})`, true) as Promise<AutomationResult>
  }

  async deleteConversationByTitle(conversationTitle: string): Promise<AutomationResult> {
    return this.contents.executeJavaScript(`(${deleteConversationScript})(${JSON.stringify(`title:${conversationTitle}`)})`, true) as Promise<AutomationResult>
  }

  async waitForReplyAndStartVoice(): Promise<AutomationResult> { return this.contents.executeJavaScript(waitForReplyAndStartVoiceScript, true) as Promise<AutomationResult> }

  async stopVoice(): Promise<AutomationResult> { return this.contents.executeJavaScript(endVoiceScript, true) as Promise<AutomationResult> }
}
