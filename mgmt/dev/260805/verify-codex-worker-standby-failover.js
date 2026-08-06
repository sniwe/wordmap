import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const port = 38127;
const failFile = `${process.env.TEMP || process.env.TMP}/codex-worker-failover-once-${process.pid}`;
if (existsSync(failFile)) rmSync(failFile);
const server = spawn(process.execPath, ['src/public/server.js', '--dev'], {
  cwd: fileURLToPath(new URL('../../../', import.meta.url)),
  env: {
    ...process.env,
    PORT: String(port),
    CODEX_WORKER_ENTRY: fileURLToPath(new URL('./fake-codex-worker.js', import.meta.url)),
    CODEX_WORKER_FAIL_FILE: failFile,
    CODEX_WORKER_FAIL_SLOTS: 'active',
    CODEX_WORKER_REPAIR_BASE_MS: '20',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let stderr = '';
server.stderr.on('data', (chunk) => { stderr += String(chunk); });

async function get(path) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      return response.json();
    } catch {
      await delay(50);
    }
  }
  throw new Error(`server did not start\n${stderr}`);
}

async function post(path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

try {
  const status = await get('/api/codex-worker/status');
  assert.equal(status.active.primeComplete, true);
  assert.equal(status.standby.primeComplete, true);
  assert.match(stderr, /\[codex-worker\]\[active\].*primed/);
  assert.match(stderr, /\[codex-worker\]\[standby\].*primed/);

  const langUnits = await get('/api/langUnits/items');
  const langUnit = langUnits.find((item) => item?.instances?.length) || langUnits[0];
  assert.ok(langUnit?._id, 'expected a language unit fixture');
  const subSegSnapshot = readFileSync('src/backend/data/subSegs/items.json', 'utf8');
  const result = await post(`/api/langUnits/items/${encodeURIComponent(langUnit._id)}/root`, {
    context: 'test context', target: 'English', substring: 'English',
  });
  assert.equal(result.res, 'fake-root-standby');
  assert.equal(readFileSync('src/backend/data/subSegs/items.json', 'utf8'), subSegSnapshot);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const repaired = await get('/api/codex-worker/status');
    if (repaired.standby?.primeComplete && !repaired.repairing) break;
    await delay(50);
  }
  const repaired = await get('/api/codex-worker/status');
  assert.equal(repaired.active.primeComplete, true);
  assert.equal(repaired.standby.primeComplete, true);
  assert.equal(repaired.repairing, false);
  assert.equal(repaired.active.slotId, 'standby');
  assert.equal(repaired.attempt.attempt, 2);
  assert.match(repaired.lastFailure.error, /exited code=17/);
  assert.match(stderr, /exited code=17/);
  assert.match(stderr, /promoted from active/);
  assert.match(stderr, /generation=2.*primed/);
  const requestIds = [...stderr.matchAll(/request-start id=([^ ]+) attempt=/g)].map((match) => match[1]);
  assert.equal(requestIds.length, 2);
  assert.equal(requestIds[0], requestIds[1], 'failover must preserve the logical request id');
  console.log('codex worker standby/failover verifier: ready');
} finally {
  server.kill();
  if (existsSync(failFile)) rmSync(failFile);
}
