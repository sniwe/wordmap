import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildPrompt,
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
assert.match(prompt, /Return only a JSON object/);

const parsed = parseCodexJsonl([
  '{"type":"thread.started","thread_id":"thread-123"}',
  '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"res\\":\\"root\\"}"}}',
].join('\n'));
assert.equal(parsed.threadId, 'thread-123');
assert.deepEqual(parseEnvelope(parsed.finalText), { res: 'root' });
assert.equal(normalizeLanguageUnitRoot({ target: 'newest' }, 'newest'), 'new');
assert.equal(normalizeLanguageUnitRoot({ target: 'published' }, 'published'), 'publish');

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
