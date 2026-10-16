// Read an already signed-in, user-started Live conversation. Validate through the
// real subtitle and store code in an isolated tmp archive; never use real history.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText, filename);
const { DevToolsClient } = require('../src/main/chatgpt-browser-login.ts');
const { readAIStudioSnapshot } = require('../src/main/ai-studio-page-dom.ts');
const { mergeTranscriptEvent, subtitleEvents } = require('../src/shared/transcript.ts');
const { SpeakSubStore } = require('../src/main/store.ts');

async function main() {
  const output = path.resolve(__dirname, '../tmp');
  const state = JSON.parse(fs.readFileSync(path.join(output, 'ai-studio-probe-state.json'), 'utf8'));
  if (!Number.isInteger(state.port) || state.port < 1024 || state.port > 65535) throw new Error('Invalid local probe port.');
  const targets = await fetch(`http://127.0.0.1:${state.port}/json/list`, { signal: AbortSignal.timeout(2000) }).then(r => r.json());
  const target = targets.find(page => page.type === 'page' && page.url.startsWith('https://aistudio.google.com/'));
  if (!target) throw new Error('Sign in to the dedicated AI Studio browser first.');
  const endpoint = new URL(target.webSocketDebuggerUrl);
  if (endpoint.hostname !== '127.0.0.1' || Number(endpoint.port) !== state.port) throw new Error('Non-local browser endpoint rejected.');
  const client = await DevToolsClient.connect(endpoint.toString());
  try {
    const result = await client.command('Runtime.evaluate', {
      expression: `(() => { if (location.origin !== 'https://aistudio.google.com' || location.pathname !== '/live') throw new Error('Not an AI Studio Live page'); return (${readAIStudioSnapshot.toString()})(document); })()`,
      returnByValue: true, timeout: 5000
    });
    if (result.exceptionDetails) throw new Error('Live DOM capture failed.');
    const snapshot = result.result.value;
    if (!snapshot.rows.some(row => row.speaker === 'user') || !snapshot.rows.some(row => row.speaker === 'assistant')) throw new Error('No attributable two-sided Live transcript yet.');
    if (snapshot.rows.some(row => row.status === 'streaming')) throw new Error('Model is still speaking. Wait until the response completes, then retry.');
    const directory = fs.mkdtempSync(path.join(output, 'ai-studio-capture-'));
    const store = new SpeakSubStore(directory);
    const session = store.createSession('normal');
    let events = [];
    // Read twice to verify replay updates rather than duplicates the same turns.
    for (let pass = 0; pass < 2; pass++) for (const row of snapshot.rows) {
      const event = { ...row, id: row.sourceMessageId, sessionId: session.id, receivedAt: new Date().toISOString() };
      events = mergeTranscriptEvent(events, event);
      store.upsertEvent(event);
    }
    const chunks = events.flatMap(event => subtitleEvents([event], 'both', 4));
    if (chunks.length !== snapshot.rows.length || chunks.some((chunk, index) => chunk.text !== snapshot.rows[index].text)) throw new Error('Subtitle text boundary mismatch.');
    store.endSession(session);
    const archive = store.finalizeSession(session.id);
    const markdown = fs.readFileSync(archive, 'utf8');
    if (store.searchSessions().length !== 1 || snapshot.rows.some(row => !markdown.includes(row.text))) throw new Error('Archive boundary mismatch.');
    const report = {
      source: 'ai-studio-web-experiment', archiveIsTestOnly: true,
      capturedTurns: events.length, userTurns: events.filter(e => e.speaker === 'user').length,
      assistantTurns: events.filter(e => e.speaker === 'assistant').length,
      emptyUserTurns: snapshot.emptyUserTurns, subtitleChunks: chunks.length,
      archives: store.searchSessions().length, duplicateReplay: 'passed', archive,
      note: 'Web transcripts may be missing or inaccurate; this validates extraction and persistence, not ASR accuracy. Archive source defaults are test-only and this folder must not be imported into normal history.'
    };
    fs.writeFileSync(path.join(directory, 'capture-report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(directory, 'transcripts.json'), JSON.stringify(snapshot, null, 2));
    const summaryRequest = snapshot.rows.findIndex(row => row.speaker === 'user' && row.text.startsWith('Please summarize this English practice conversation'));
    const summary = summaryRequest >= 0 ? snapshot.rows.slice(summaryRequest + 1).find(row => row.speaker === 'assistant') : undefined;
    if (summary) fs.writeFileSync(path.join(directory, 'web-summary.md'), '# AI Studio 网页总结实验\n\n以下是网页模型原始输出，并非已核验的学习评分；原始转写存在缺失或误识别。\n\n' + summary.text + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
