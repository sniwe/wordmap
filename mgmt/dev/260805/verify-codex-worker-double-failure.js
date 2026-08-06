import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const port = 38128;
const failFile = `${process.env.TEMP || process.env.TMP}/codex-worker-double-failure-${process.pid}`;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const server = spawn(process.execPath, ['src/public/server.js', '--dev'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    CODEX_WORKER_ENTRY: fileURLToPath(new URL('./fake-codex-worker.js', import.meta.url)),
    CODEX_WORKER_FAIL_FILE: failFile,
    CODEX_WORKER_FAIL_SLOTS: 'active,standby',
    CODEX_WORKER_REPAIR_BASE_MS: '20',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let stderr = '';
server.stderr.on('data', (chunk) => { stderr += String(chunk); });

async function request(path, options) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await fetch(`http://127.0.0.1:${port}${path}`, options);
    } catch {
      await delay(50);
    }
  }
  throw new Error(`server did not start\n${stderr}`);
}

try {
  const items = await (await request('/api/langUnits/items')).json();
  const langUnit = items.find((item) => item?._id) || {};
  assert.ok(langUnit._id, 'expected a language unit fixture');
  const options = () => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: 'test context', target: 'English', substring: 'English' }),
  });
  const failed = await request(`/api/langUnits/items/${encodeURIComponent(langUnit._id)}/root`, options());
  assert.equal(failed.status, 500);

  await delay(250);
  const recovered = await request(`/api/langUnits/items/${encodeURIComponent(langUnit._id)}/root`, options());
  const recoveredText = await recovered.text();
  assert.equal(recovered.status, 200, recoveredText);
  assert.equal(JSON.parse(recoveredText).res.startsWith('fake-root-'), true);
  assert.match(stderr, /active and standby failed/);
  assert.match(stderr, /request-start id=.*attempt=1/);
  assert.match(stderr, /request-start id=.*attempt=2/);
  console.log('codex worker double-failure verifier: ready');
} finally {
  server.kill();
  for (const slot of ['active', 'standby']) {
    const marker = `${failFile}-${slot}`;
    if (existsSync(marker)) rmSync(marker);
  }
}
