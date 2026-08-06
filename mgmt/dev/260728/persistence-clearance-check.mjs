import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const files = [
  'src/backend/data/subSegs/items.json',
  'src/backend/data/langUnits/items.json',
  'src/backend/data/audSegs/items.json',
  'src/backend/data/audEps/items.json',
];
const backups = new Map();
const port = 3900 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
let server;

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function restore() {
  for (const [relativePath, content] of backups) {
    await fs.writeFile(path.join(root, relativePath), content, 'utf8');
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/subSegs/items`);
      if (response.ok) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server did not start');
}

try {
  for (const relativePath of files) {
    backups.set(relativePath, await read(relativePath));
  }

  server = spawn(process.execPath, ['src/public/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  await waitForServer();

  for (const [relativePath, endpoint] of [
    [files[2], 'audSegs'],
    [files[3], 'audEps'],
  ]) {
    const filePath = path.join(root, relativePath);
    const malformed = '{"not": "an array"}';
    await fs.writeFile(filePath, malformed, 'utf8');
    const failedRead = await fetch(`${baseUrl}/api/${endpoint}/items`);
    assert.equal(failedRead.status, 500, `${endpoint} read must fail when malformed`);
    assert.equal(await read(relativePath), malformed, `${endpoint} read must not rewrite malformed data`);
    await fs.writeFile(filePath, backups.get(relativePath), 'utf8');
  }

  const subSegPath = path.join(root, files[0]);
  const malformed = '{"not": "an array"}';
  await fs.writeFile(subSegPath, malformed, 'utf8');
  const failedSave = await fetch(`${baseUrl}/api/subSegs/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audSegId: 'clearance-check', text: 'must fail' }),
  });
  assert.equal(failedSave.status, 500, 'malformed collection save must fail');
  assert.equal(await read(files[0]), malformed, 'failed save must not overwrite malformed data');

  await restore();
  const cleared = await fetch(`${baseUrl}/api/subSegs/items`, { method: 'DELETE', body: '{}' });
  assert.equal(cleared.status, 200, 'explicit clear must remain supported');
  assert.deepEqual(await cleared.json(), { subSegs: [] });
  await restore();
  console.log('persistence clearance check passed');
} finally {
  if (server && !server.killed) {
    server.kill();
  }
  if (backups.size) {
    await restore();
  }
}
