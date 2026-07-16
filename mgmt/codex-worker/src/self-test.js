import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildPrompt,
  classifyKnownChineseContextType,
  classifyKnownChineseTypes,
  normalizeLanguageUnitChineseTypes,
  normalizeLanguageUnitContextType,
  normalizeLanguageUnitRoot,
  normalizeRequest,
  parseCodexJsonl,
  parseEnvelope,
} from './core.js';

const here = dirname(fileURLToPath(import.meta.url));
const workerRoot = resolve(here, '..');
const workerEntry = resolve(here, 'index.js');

const request = normalizeRequest({
  context: 'alpha context',
  target: 'beta target',
  substring: 'gamma substring',
});

const prompt = buildPrompt(request);
assert.match(prompt, /discern-languageUnit-root/);
assert.match(prompt, /alpha context/);
assert.match(prompt, /beta target/);
assert.match(prompt, /gamma substring/);
assert.match(prompt, /Infer the base English word directly/);
assert.match(prompt, /faggiest -> fag/);
assert.match(prompt, /Return only a JSON object/);

const contextRequest = normalizeRequest({
  task: 'contextType',
  context: 'alpha context',
  target: 'beta target',
  substring: 'gamma substring',
});

const contextPrompt = buildPrompt(contextRequest);
assert.match(contextPrompt, /discern-languageUnit-chinese-types/);
assert.match(contextPrompt, /chinWord/);
assert.match(contextPrompt, /chinPhrase/);
assert.deepEqual(classifyKnownChineseTypes({ context: '\u8349\u6ce5\u9a6c\u662f\u4e00\u79cd\u9a6c\u5417', target: '\u8349\u6ce5\u9a6c' }), {
  contextType: 'chinPhrase',
  targetType: 'chinWord',
});
assert.deepEqual(classifyKnownChineseTypes({ context: '\u64cd\u4f60\u5988\u4e0d\u662f\u6587\u660e\u4eba\u8bf4\u7684', target: '\u6587\u660e\u4eba' }), {
  contextType: 'chinPhrase',
  targetType: 'chinWord',
});
assert.equal(classifyKnownChineseContextType({ target: '\u8349\u6ce5\u9a6c' }), 'chinWord');
assert.equal(classifyKnownChineseContextType({ target: '\u64cd\u4f60\u5988' }), 'chinPhrase');
assert.equal(classifyKnownChineseContextType({ target: '\u4f60\u597d\u4e16\u754c' }), 'chinPhrase');
assert.equal(classifyKnownChineseContextType({ target: '\u4f60\u597d' }), 'chinWord');
assert.equal(classifyKnownChineseContextType({ target: '\u4e16\u754c' }), 'chinWord');
assert.deepEqual(normalizeLanguageUnitChineseTypes({ context: '\u4f60\u597d\u4e16\u754c', target: '\u4e16\u754c' }, 'chinPhrase'), {
  contextType: 'chinPhrase',
  targetType: 'chinWord',
});
assert.equal(normalizeLanguageUnitContextType({ target: '\u4e16\u754c' }, 'chinPhrase'), 'chinWord');

const parsed = parseCodexJsonl([
  '{"type":"thread.started","thread_id":"thread-123"}',
  '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"res\\":\\"root\\"}"}}',
].join('\n'));
assert.equal(parsed.threadId, 'thread-123');
assert.deepEqual(parseEnvelope(parsed.finalText), { res: 'root' });
assert.equal(normalizeLanguageUnitRoot({ target: 'newest' }, 'new'), 'new');
assert.equal(normalizeLanguageUnitRoot({ target: 'published' }, 'publish'), 'publish');
assert.equal(normalizeLanguageUnitContextType({ context: { type: 'chinWord' } }, 'chinWord'), 'chinWord');

const live = spawnSync(process.execPath, [workerEntry, '--demo'], {
  cwd: workerRoot,
  encoding: 'utf8',
  env: {
    ...process.env,
    CODEX_WORKER_REQUEST_TIMEOUT_MS: '300000',
  },
  timeout: 400000,
});
assert.equal(live.status, 0, live.stderr);
const liveEnvelope = JSON.parse(live.stdout.trim());
assert.equal(typeof liveEnvelope.res, 'string');
assert.ok(liveEnvelope.res.length > 0);

const invalid = spawnSync(process.execPath, [workerEntry, '--payload', '{"context":"","target":"x","substring":"y"}'], {
  cwd: workerRoot,
  encoding: 'utf8',
  env: process.env,
  timeout: 20000,
});
assert.notEqual(invalid.status, 0);
assert.match(invalid.stderr, /must be a non-empty string/);

console.log('codex-worker smoke test passed');
