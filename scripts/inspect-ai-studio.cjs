// Read only the AI Studio DOM after the user signs in. Never inspect account
// credentials, Chrome cookie storage, Google account pages, or request headers.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText, filename);
const { DevToolsClient } = require('../src/main/chatgpt-browser-login.ts');

async function main() {
  const directory = path.resolve(__dirname, '../tmp');
  const state = JSON.parse(fs.readFileSync(path.join(directory, 'ai-studio-probe-state.json'), 'utf8'));
  if (!Number.isInteger(state.port) || state.port < 1024 || state.port > 65535) throw new Error('Invalid local probe port.');
  const targets = await fetch(`http://127.0.0.1:${state.port}/json/list`, { signal: AbortSignal.timeout(2000) }).then(r => r.json());
  const page = targets.find(target => target.type === 'page' && new URL(target.url).origin === 'https://aistudio.google.com');
  if (!page) {
    console.log('Waiting for Google sign-in: no AI Studio page is open. No account page content was read.');
    return;
  }
  const socketUrl = new URL(page.webSocketDebuggerUrl);
  if (socketUrl.hostname !== '127.0.0.1' || Number(socketUrl.port) !== state.port) throw new Error('Non-local browser endpoint rejected.');
  const client = await DevToolsClient.connect(socketUrl.toString());
  try {
    const response = await client.command('Runtime.evaluate', {
      expression: `(() => {
        if (location.origin !== 'https://aistudio.google.com') return { status: 'navigation-changed' };
        const visible = element => !!(element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
        const elements = [...document.querySelectorAll('*')];
        const tags = [...new Set(elements.map(element => element.tagName.toLowerCase()).filter(tag => tag.includes('-')))];
        return {
          status: 'inspect-dom-only', title: document.title, origin: location.origin, path: location.pathname,
          headings: [...document.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(visible).map(element => element.textContent.trim()),
          buttons: [...document.querySelectorAll('button,[role="button"]')].filter(visible).map(element => /Google (账号|Account)/i.test(element.getAttribute('aria-label') || '') ? { text: '[Google account]', label: '[Google account]' } : ({ text: element.textContent.trim().slice(0, 160), label: element.getAttribute('aria-label'), testId: element.getAttribute('data-testid') })),
          inputs: [...document.querySelectorAll('textarea,[contenteditable="true"],input')].filter(visible).map(element => ({ tag: element.tagName, type: element.getAttribute('type'), placeholder: element.getAttribute('placeholder'), label: element.getAttribute('aria-label') })),
          customElementTags: tags,
          turns: [...document.querySelectorAll('ms-bidi-turn')].map(element => {
            const clone = element.cloneNode(true);
            clone.querySelectorAll('audio,video,canvas,svg,img').forEach(node => node.remove());
            clone.querySelectorAll('*').forEach(node => { node.removeAttribute('src'); node.removeAttribute('style'); });
            return { text: element.innerText, html: clone.outerHTML.slice(0, 16000) };
          }),
          text: document.body.innerText.slice(0, 18000).replace(/[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}/g, '[account email]')
        };
      })()`, returnByValue: true, timeout: 5000
    });
    if (response.exceptionDetails) throw new Error('AI Studio DOM inspection failed.');
    const snapshot = response.result.value;
    fs.writeFileSync(path.join(directory, 'ai-studio-dom-snapshot.json'), JSON.stringify(snapshot, null, 2));
    console.log(JSON.stringify(snapshot, null, 2));
  } finally { client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
