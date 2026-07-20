import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const langUnitsPath = path.join(root, 'src/backend/data/langUnits/items.json');
const subSegsPath = path.join(root, 'src/backend/data/subSegs/items.json');

const activeLangUnitId = '5e315e33-ee8a-4d3b-935c-da79da19d333-1-1-0';
const sourceLangUnitId = '5e315e33-ee8a-4d3b-935c-da79da19d333-0-4-0';
const activeParentSubSegId = '5e315e33-ee8a-4d3b-935c-da79da19d333-1-1';
const existingEmptyChildId = '5e315e33-ee8a-4d3b-935c-da79da19d333-1-2';

function isChineseCharacter(value) {
  return /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]$/u.test(String(value ?? ''));
}

function recallKey(items, id) {
  const item = items.find((entry) => String(entry?._id ?? '') === String(id ?? ''));
  const text = String(item?.target?.text ?? item?.text ?? '').trim();
  return isChineseCharacter(text) ? `chin:${text}` : String(id ?? '').trim();
}

function hasContent(item) {
  return Array.isArray(item?.content) && item.content.length ? 0 : String(item?.text ?? '').trim() ? 0 : 1;
}

async function atomicWriteJsonFile(dir, file, value) {
  await fs.mkdir(dir, { recursive: true });
  const tmpFile = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmpFile, file);
}

const langUnits = JSON.parse(await fs.readFile(langUnitsPath, 'utf8'));
const subSegs = JSON.parse(await fs.readFile(subSegsPath, 'utf8'));
assert.equal(recallKey(langUnits, activeLangUnitId), recallKey(langUnits, sourceLangUnitId));

const targetKey = recallKey(langUnits, activeLangUnitId);
const candidates = subSegs.filter((item) => item?.isRoot === false && recallKey(langUnits, item.linkTargetLangUnitId) === targetKey);
const recalled = candidates.slice().sort((a, b) => hasContent(a) - hasContent(b))[0];
const localProjection = candidates.find((item) => String(item?.parentSubSegId ?? '') === activeParentSubSegId);
assert.equal(recalled?.text, 'money\n');
assert.equal(localProjection?._id, existingEmptyChildId);
assert.equal(localProjection?.linkTargetLangUnitId, activeLangUnitId);
assert.equal(localProjection?.text, 'money\n');
assert.deepEqual({
  _id: localProjection._id,
  parentSubSegId: activeParentSubSegId,
  linkTargetLangUnitId: activeLangUnitId,
  text: recalled.text,
}, {
  _id: existingEmptyChildId,
  parentSubSegId: activeParentSubSegId,
  linkTargetLangUnitId: activeLangUnitId,
  text: 'money\n',
});

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'retry-langunits-'));
const file = path.join(dir, 'items.json');
let queue = Promise.resolve();
const queuedWrite = (value) => {
  queue = queue.catch(() => {}).then(() => atomicWriteJsonFile(dir, file, value));
  return queue;
};
await Promise.all([
  queuedWrite([{ _id: 'long', text: 'x'.repeat(5000) }]),
  queuedWrite([{ _id: 'short' }]),
]);
const final = JSON.parse(await fs.readFile(file, 'utf8'));
assert.ok(Array.isArray(final));
await fs.rm(dir, { recursive: true, force: true });

console.log('ok');
