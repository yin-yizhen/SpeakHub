import type { WebContents } from 'electron'
import { readChatGPTMessages } from './chatgpt-page-dom'
import { isStableChatGPTConversationUrl } from './chatgpt-marker'

export interface AutomationResult { ok: boolean; message: string }
export interface ConversationResult extends AutomationResult { conversationUrl?: string }

const composerSelector = '#prompt-textarea, textarea, [contenteditable], [role="textbox"], [placeholder], [aria-label], [aria-placeholder], [data-placeholder]'
const sendSelector = 'button[data-testid*="send"], button[aria-label*="Send"], button[aria-label*="发送"], button[title*="Send"], button[title*="发送"]'
const stopSelector = 'button[data-testid*="stop"], button[aria-label*="Stop"], button[aria-label*="停止"]'
const voiceSelector = [
  'button[data-testid="voice-mode-button"]',
  ...['开始语音', '开始语音聊天', '启动语音功能', '开启语音模式', 'Start voice', 'Start voice mode', 'Start voice chat', 'Use voice mode', 'Voice mode']
    .flatMap((label) => [`button[aria-label="${label}" i]`, `button[title="${label}" i]`])
].join(', ')
const endVoiceSelector = [
  'button[data-testid*="end-voice" i]', 'button[data-testid*="leave-voice" i]', 'button[data-testid*="exit-voice" i]', 'button[data-testid*="voice-end" i]',
  'button[aria-label*="end voice" i]', 'button[aria-label*="leave voice" i]', 'button[aria-label*="exit voice" i]', 'button[aria-label*="end conversation" i]',
  'button[aria-label*="结束语音"]', 'button[aria-label*="退出语音"]', 'button[aria-label*="结束对话"]',
  'button[title*="end voice" i]', 'button[title*="leave voice" i]', 'button[title*="结束语音"]', 'button[title*="退出语音"]'
].join(', ')
const stopGeneratingScript = `(() => {
  const button = document.querySelector(${JSON.stringify(stopSelector)});
  if (!(button instanceof HTMLButtonElement) || button.disabled || button.getClientRects().length === 0) return false;
  button.click();
  return true;
})()`

const deleteLabels = ['delete', '删除', 'delete chat', '删除聊天']
const conversationMenuSelector = 'button[data-testid*="conversation-options" i], button[data-testid*="conversation-menu" i], button[aria-label="聊天操作"], button[aria-label="Chat options" i], button[aria-label*="more" i], button[aria-label*="options" i], button[aria-label*="menu" i], button[aria-label*="更多"], button[aria-label*="选项"]'

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
    if ([...row.querySelectorAll('a[href*="/c/"]')].some(anchor => anchor !== link)) return undefined
    if (row.querySelector(conversationMenuSelector)) return row
    row = row.parentElement
  }
  return undefined
}

export function findConversationMenuButton(row: ParentNode): HTMLButtonElement | undefined {
  const buttons = [...row.querySelectorAll<HTMLButtonElement>(conversationMenuSelector)].filter((button) => !button.disabled)
  return buttons.find((button) => /conversation-options|conversation-menu/.test(labelOf(button))) ?? buttons.find((button) => /more|options|menu|更多|选项|聊天操作/.test(labelOf(button)))
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
  const candidates = [...document.querySelectorAll(selector)].filter(element => element.matches('textarea, input, [contenteditable], [role="textbox"]')).filter(isVisible).map((element) => ({ element, score: score(element) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const composer = candidates[0]?.element;
  return { composer, diagnostics: candidates.slice(0, 4).map(({ element, score }) => ({ tag: element.tagName, id: element.id, placeholder: element.getAttribute('placeholder'), ariaLabel: element.getAttribute('aria-label'), dataPlaceholder: element.getAttribute('data-placeholder'), score })) };
})()`

const authenticatedSessionScript = `(async () => {
  try {
    const response = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return false;
    const session = await response.json();
    return Boolean(session && typeof session === 'object' && (session.user || session.accessToken));
  } catch { return false; }
})()`

const focusComposerScript = `(() => {
  const result = ${pageComposerLocator}; const composer = result.composer;
  if (!composer) return { focused: false, diagnostics: result.diagnostics };
  composer.focus();
  const focused = document.activeElement === composer || composer.contains(document.activeElement);
  if (focused) {
    if (composer.matches('textarea, input')) composer.select();
    else {
      const range = document.createRange(); range.selectNodeContents(composer);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }
  }
  return { focused, diagnostics: result.diagnostics };
})()`

const refocusComposerScript = `(() => {
  const composer = (${pageComposerLocator}).composer;
  if (!composer) return false;
  composer.focus();
  return document.activeElement === composer || composer.contains(document.activeElement);
})()`

const clickComposerSendScript = `(() => new Promise(resolve => {
  const deadline = Date.now() + 5000;
  const isVisible = (element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 20 && rect.height > 20 && style.visibility !== 'hidden' && style.display !== 'none'; };
  const attempt = () => {
    const composer = (${pageComposerLocator}).composer;
    const form = composer?.closest('form');
    const root = form || document;
    const candidates = [...root.querySelectorAll('button:not([disabled])')].filter(button => isVisible(button) && button.getAttribute('aria-disabled') !== 'true'
      && (button.matches(${JSON.stringify(sendSelector)}) || (form && button.type === 'submit')));
    if (candidates.length === 1) { candidates[0].click(); resolve(true); return; }
    if (Date.now() >= deadline) { resolve(false); return; }
    setTimeout(attempt, 120);
  };
  attempt();
}))()`

const confirmPromptSentScript = `(prompt => new Promise((resolve) => {
  const readMessages = ${readChatGPTMessages.toString()};
  const normalize = text => text.replace(/\\s+/g, ' ').trim();
  const token = normalize(prompt);
  const deadline = Date.now() + 5000;
  const read = () => {
    const latestUser = readMessages(document).filter(row => row.speaker === 'user').at(-1);
    const composer = (${pageComposerLocator}).composer;
    const draft = composer ? (composer.value ?? composer.textContent ?? '').trim() : '';
    const sent = token && latestUser && normalize(latestUser.text) === token && !draft;
    if (sent) return resolve(true);
    if (Date.now() >= deadline) return resolve(false);
    setTimeout(read, 120);
  };
  read();
}))`

const promptSendStateScript = `(prompt => {
  const readMessages = ${readChatGPTMessages.toString()};
  const normalize = text => text.replace(/\\s+/g, ' ').trim();
  const expected = normalize(prompt);
  const latestUser = readMessages(document).filter(row => row.speaker === 'user').at(-1);
  const composer = (${pageComposerLocator}).composer;
  const draft = composer ? normalize(composer.value ?? composer.textContent ?? '') : '';
  const acknowledged = Boolean(latestUser && normalize(latestUser.text) === expected);
  const busy = [...document.querySelectorAll('button[aria-label="停止"], button[aria-label="停止生成"], button[aria-label="Stop" i], button[aria-label="Stop generating" i], button[data-testid="stop-button"]')].some(button => button.getClientRects().length > 0);
  return { acknowledged, retryable: !acknowledged && !busy && draft === expected, draftChanged: Boolean(draft && draft !== expected) };
})`

const waitForReplyAndStartVoiceScript = `(() => new Promise((resolve) => {
  const readMessages = ${readChatGPTMessages.toString()};
  const selector = ${JSON.stringify(voiceSelector)}; const endSelector = ${JSON.stringify(endVoiceSelector)};
  const deadline = Date.now() + 45000; const conversationUrl = location.href;
  let lastReply = ''; let stableSince = Date.now();
  const isVisible = element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 18 && rect.height > 18 && style.visibility !== 'hidden' && style.display !== 'none'; };
  const enabled = element => !element.disabled && element.getAttribute('aria-disabled') !== 'true';
  const voiceStarted = () => [...document.querySelectorAll(endSelector)].some(button => isVisible(button) && enabled(button));
  const isBusy = () => [...document.querySelectorAll('button[data-testid="stop-button"], button[aria-label="Stop generating" i], button[aria-label="Stop" i], button[aria-label="停止生成"], button[aria-label="停止"]')].some(isVisible);
  const hasAssistantReply = () => {
    // Read the response after the latest user message, not an older turn or
    // surrounding article controls (conversation-turn-*).
    const nodes = readMessages(document);
    const userIndex = nodes.findLastIndex(node => node.speaker === 'user');
    if (userIndex < 0) return '';
    const reply = nodes.slice(userIndex + 1).filter(node => node.speaker === 'assistant').at(-1);
    return reply?.text ?? '';
  };
  const findStart = () => {
    const candidates = [...document.querySelectorAll(selector)].filter(button => isVisible(button) && enabled(button) && !button.matches(endSelector) && !button.closest('aside, nav, [data-message-author-role], [data-content-search-unit-key]'));
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  const attempt = () => {
    if (location.href !== conversationUrl) { resolve({ ok: false, message: 'ChatGPT 页面已切换，已取消本次语音启动。' }); return; }
    if (voiceStarted()) { resolve({ ok: true, message: 'ChatGPT 语音对话已开启。' }); return; }
    const now = Date.now(); const busy = isBusy(); const reply = hasAssistantReply();
    if (busy || reply !== lastReply) stableSince = now;
    lastReply = reply;
    const replyComplete = !busy && reply && now - stableSince >= 900;
    if (!replyComplete) {
      if (now >= deadline) { resolve({ ok: false, message: busy ? 'ChatGPT 仍在回复，等待语音入口超时。' : 'ChatGPT 未确认首条回复完成，未启动语音。' }); return; }
      setTimeout(attempt, 250); return;
    }
    const voice = findStart();
    if (voice) {
      voice.click();
      const confirmationDeadline = Date.now() + 12000;
      const confirmStarted = () => {
        if (location.href !== conversationUrl) { resolve({ ok: false, message: 'ChatGPT 页面已切换，未确认语音启动。' }); return; }
        if (voiceStarted()) { resolve({ ok: true, message: '提示词已发送，ChatGPT 语音对话已开启。' }); return; }
        if (Date.now() >= confirmationDeadline) { resolve({ ok: false, message: '已点击“开始语音”，但未检测到“结束语音”控件。请打开连接页检查语音提示或连接状态。' }); return; }
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

const captureConversationTitleScript = `(conversationUrl => new Promise((resolve) => {
  const targetPath = new URL(conversationUrl).pathname;
  const deadline = Date.now() + 15000;
  const findTitle = () => {
    const link = [...document.querySelectorAll('a[href*="/c/"]')].find(anchor => { try { return new URL(anchor.href).pathname === targetPath && (anchor.querySelector('[data-thread-title]') || anchor.closest('nav, aside')); } catch { return false; } });
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
  const deleteLabels = ['delete', '删除', 'delete chat', '删除聊天'];
  const isVisible = element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 8 && rect.height > 8 && style.visibility !== 'hidden' && style.display !== 'none'; };
  const labelOf = element => [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('data-testid')].filter(Boolean).join(' ').trim().toLowerCase();
  const targetLink = () => {
    const matches = [...document.querySelectorAll('a[href*="/c/"]')].filter(anchor => {
    if (targetIsTitle) return anchor.textContent?.trim() === targetTitle;
    try { return new URL(anchor.href).pathname === targetPath; } catch { return false; }
    });
    return matches.length === 1 ? matches[0] : undefined;
  };
  const rowFor = link => { let row = link.parentElement; while (row && row !== document.body) {
    if ([...row.querySelectorAll('a[href*="/c/"]')].some(anchor => anchor !== link)) return undefined;
    const menu = [...row.querySelectorAll(${JSON.stringify(conversationMenuSelector)})].find(button => isVisible(button) && !button.disabled); if (menu) return { row, menu }; row = row.parentElement;
  } return undefined; };
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
    target.row.scrollIntoView({ block: 'nearest' });
    target.row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); target.row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    // Current Radix dropdowns open on pointerdown; HTMLElement.click() alone
    // does not open their menu. Fall back once for older click-driven controls.
    target.menu.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', ctrlKey: false }));
    target.menu.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
    setTimeout(() => { if (!openDeleteMenu()) target.menu.click(); waitForMenu(); }, 150);
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

  async isAuthenticated(): Promise<boolean> { return this.contents.executeJavaScript(authenticatedSessionScript, true) as Promise<boolean> }

  async fillAndSendPrompt(prompt: string): Promise<AutomationResult> {
    const deadline = Date.now() + 45_000
    let latest: { focused: boolean; diagnostics: Array<Record<string, unknown>> } | undefined
    while (Date.now() < deadline) {
      latest = await this.waitForComposerFocus(1_500)
      if (latest.focused) break
      await pause(300)
    }
    if (!latest?.focused) return { ok: false, message: 'ChatGPT 页面在 45 秒内仍未准备好输入框。请打开连接页检查网络或登录状态后重试。' }
    this.contents.focus?.()
    this.contents.insertText(prompt)
    await pause(180)
    const clicked = await this.contents.executeJavaScript(clickComposerSendScript, true) as boolean
    if (!clicked) await this.sendComposerEnter()
    let sent = await this.contents.executeJavaScript(`(${confirmPromptSentScript})(${JSON.stringify(prompt)})`, true) as boolean
    if (!sent && clicked) {
      const state = await this.contents.executeJavaScript(`(${promptSendStateScript})(${JSON.stringify(prompt)})`, true) as { retryable: boolean }
      if (state.retryable) await this.sendComposerEnter()
      sent = await this.contents.executeJavaScript(`(${confirmPromptSentScript})(${JSON.stringify(prompt)})`, true) as boolean
    }
    // Cold-start hydration can expose a clickable-looking send control before
    // submission is accepted. Retry only the untouched, unsent draft; never
    // reinsert text or resend after the page acknowledges it or clears the draft.
    const recoveryDeadline = Date.now() + 15_000
    let retries = 0
    while (!sent && Date.now() < recoveryDeadline) {
      const state = await this.contents.executeJavaScript(`(${promptSendStateScript})(${JSON.stringify(prompt)})`, true) as { acknowledged: boolean; retryable: boolean; draftChanged: boolean }
      if (state.draftChanged) break
      if (state.retryable && retries < 2) {
        retries += 1
        await this.contents.executeJavaScript(`(prompt => {
          if (!(${promptSendStateScript})(prompt).retryable) return false;
          return ${clickComposerSendScript};
        })(${JSON.stringify(prompt)})`, true)
      }
      sent = await this.contents.executeJavaScript(`(${confirmPromptSentScript})(${JSON.stringify(prompt)})`, true) as boolean
      if (!sent) await pause(250)
    }
    if (!sent) return { ok: false, message: '已尝试点击 ChatGPT 发送键，但未确认提示词成为对话消息。草稿已保留，请打开连接页后重试。' }
    return { ok: true, message: clicked ? '提示词已发送，正在等待 ChatGPT 回复。' : '提示词已通过 Enter 发送，正在等待 ChatGPT 回复。' }
  }

  private async sendComposerEnter(): Promise<void> {
    this.contents.focus?.()
    const focused = await this.contents.executeJavaScript(refocusComposerScript, true) as boolean
    if (!focused) return
    this.contents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' })
    this.contents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' })
  }

  async stopGenerating(): Promise<boolean> {
    return this.contents.executeJavaScript(stopGeneratingScript, true) as Promise<boolean>
  }

  async startNewChat(): Promise<AutomationResult> {
    // Project sidebar controls also contain “新聊天”. Navigate directly rather
    // than selecting a project-scoped new-chat action by substring.
    await this.contents.loadURL('https://chatgpt.com/')
    return { ok: true, message: '已打开 ChatGPT 新聊天页。' }
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
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      const url = this.contents.getURL()
      if (isStableChatGPTConversationUrl(url)) return { ok: true, message: '已记录 SpeakSub 聊天。', conversationUrl: url }
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
    if (!isStableChatGPTConversationUrl(normalizedUrl)) return { ok: false, message: '未记录正式 ChatGPT 会话地址，无法确认要删除的练习对话。' }
    await this.contents.loadURL(normalizedUrl)
    return this.contents.executeJavaScript(`(${deleteConversationScript})(${JSON.stringify(normalizedUrl)})`, true) as Promise<AutomationResult>
  }

  async deleteConversationByTitle(conversationTitle: string): Promise<AutomationResult> {
    await this.contents.loadURL('https://chatgpt.com/')
    return this.contents.executeJavaScript(`(${deleteConversationScript})(${JSON.stringify(`title:${conversationTitle}`)})`, true) as Promise<AutomationResult>
  }

  async waitForReplyAndStartVoice(): Promise<AutomationResult> { return this.contents.executeJavaScript(waitForReplyAndStartVoiceScript, true) as Promise<AutomationResult> }

  async stopVoice(): Promise<AutomationResult> { return this.contents.executeJavaScript(endVoiceScript, true) as Promise<AutomationResult> }
}
