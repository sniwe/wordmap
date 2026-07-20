import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = '3017';
const subSegs = JSON.parse(fs.readFileSync('src/backend/data/subSegs/items.json', 'utf8'));
const source = subSegs.find((item) =>
  item?.isRoot === false &&
  String(item?.linkTargetLangUnitId ?? '').trim() &&
  ((Array.isArray(item?.content) && item.content.length) || String(item?.text ?? '').trim())
);

assert.ok(source, 'expected a contentful linked child subSeg fixture');

const fixtureId = `${source.audSegId}-verify-recall`;
const server = spawn(process.execPath, ['src/public/server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stopServer = () => {
  if (!server.killed) {
    server.kill('SIGTERM');
  }
};

await new Promise((resolve) => setTimeout(resolve, 900));

try {
  const response = await fetch(`http://127.0.0.1:${port}/api/subSegs/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subSegId: fixtureId,
      audSegId: source.audSegId,
      isRoot: false,
      linkTargetLangUnitId: source.linkTargetLangUnitId,
      parentSubSegId: `${source.parentSubSegId}-verify`,
      content: [],
      text: '',
    }),
  });
  assert.equal(response.ok, true, `POST failed ${response.status}`);

  const result = await response.json();
  assert.equal(result?.subSeg?._id, fixtureId);
  assert.equal(result?.subSeg?.text, source.text, 'empty linked child should hydrate source text on write');
  assert.deepEqual(result?.subSeg?.content, source.content, 'empty linked child should hydrate source content on write');

  await fetch(`http://127.0.0.1:${port}/api/subSegs/items`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subSegId: fixtureId }),
  });

  console.log('langUnit-linked subSeg API recall write ok');
} finally {
  stopServer();
}
