// Local feasibility probe: reuse SpeakHub's real-browser launcher, never the
// user's normal Chrome profile or the existing ChatGPT login profile.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText, filename);

const { browserLaunchArguments, findBrowserExecutable, findOpenPort, waitForDevTools } = require('../src/main/chatgpt-browser-login.ts');

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'tmp', 'ai-studio-probe-state.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const profile = path.join(process.env.APPDATA, 'speaksub', 'ai-studio-login-browser');
  fs.mkdirSync(profile, { recursive: true });
  if (fs.existsSync(output)) {
    const previous = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (previous.profile === profile && Number.isInteger(previous.port) && previous.port >= 1024 && previous.port <= 65535) {
      const running = await fetch(`http://127.0.0.1:${previous.port}/json/list`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok ? r.json() : []).catch(() => []);
      if (running.some(target => target.type === 'page' && ['https://aistudio.google.com', 'https://accounts.google.com'].includes(new URL(target.url).origin))) {
        console.log(`The dedicated AI Studio browser is already open on local port ${previous.port}. Reusing it without interrupting sign-in.`);
        return;
      }
    }
  }
  const port = await findOpenPort();
  const browser = spawn(findBrowserExecutable(), browserLaunchArguments(profile, port, 'https://aistudio.google.com/live'), {
    stdio: 'ignore', windowsHide: false, detached: true
  });
  browser.unref();
  await waitForDevTools(port);
  fs.writeFileSync(output, JSON.stringify({ port, profile, startedAt: new Date().toISOString(), purpose: 'AI Studio web login and transcript feasibility only; no API key and no cookie transfer' }, null, 2));
  console.log(`AI Studio opened in a dedicated real browser. Local probe port: ${port}.`);
  console.log('Complete Google sign-in in that browser. The profile is retained; SpeakHub and ChatGPT login remain unchanged.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
