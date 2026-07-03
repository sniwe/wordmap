import http from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');
const distDir = path.join(root, 'mgmt', 'dist');
const dataDir = path.join(root, 'mgmt', 'edit-notes');
const frontendIndexFile = path.join(root, 'src', 'frontend', 'index.html');
const dataFile = path.join(dataDir, 'notes.json');
const audEpDir = path.join(root, 'src', 'backend', 'data', 'audEps');
const audEpItemsFile = path.join(audEpDir, 'items.json');
const audEpSchemaFile = path.join(audEpDir, 'schema');
const audSegDir = path.join(root, 'src', 'backend', 'data', 'audSegs');
const audSegItemsFile = path.join(audSegDir, 'items.json');
const audSegSchemaFile = path.join(audSegDir, 'schema');
const langUnitDir = path.join(root, 'src', 'backend', 'data', 'langUnits');
const langUnitItemsFile = path.join(langUnitDir, 'items.json');
const langUnitSchemaFile = path.join(langUnitDir, 'schema');
const codexWorkerDir = path.join(root, 'mgmt', 'codex-worker');
const codexWorkerEntry = path.join(codexWorkerDir, 'src', 'index.js');
const subSegDir = path.join(root, 'src', 'backend', 'data', 'subSegs');
const subSegItemsFile = path.join(subSegDir, 'items.json');
const subSegSchemaFile = path.join(subSegDir, 'schema');
const mediaDir = path.join(root, 'src', 'backend', 'data', 'media');
const port = Number(process.env.PORT || 3000);
const isDev = process.argv.includes('--dev');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

async function readNotes() {
  try {
    const notes = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    const [normalized, changed] = normalizeNotes(notes);
    if (changed) {
      await writeNotes(normalized);
    }
    return normalized;
  } catch {
    return {};
  }
}

function createDefaultFunctionalityStatus() {
  return {
    state: 'unknown',
    remaining: '',
    missing: '',
    replacedBy: [],
  };
}

function normalizeFunctionalityStatus(value) {
  const base = createDefaultFunctionalityStatus();
  if (!value || typeof value !== 'object') {
    return base;
  }

  return {
    ...value,
    state: typeof value.state === 'string' && value.state ? value.state : base.state,
    remaining: typeof value.remaining === 'string' ? value.remaining : base.remaining,
    missing: typeof value.missing === 'string' ? value.missing : base.missing,
    replacedBy: Array.isArray(value.replacedBy)
      ? value.replacedBy.filter((item) => typeof item === 'string' && item)
      : base.replacedBy,
  };
}

function normalizeNotes(notes) {
  let changed = false;
  const normalized = {};

  for (const [selector, entry] of Object.entries(notes || {})) {
    const sourceNotes = Array.isArray(entry?.notes) ? entry.notes : [];
    const nextNotes = sourceNotes.map((note) => {
      if (!note || typeof note !== 'object') {
        changed = true;
        return {
          text: '',
          createdAt: '',
          functionalityStatus: createDefaultFunctionalityStatus(),
        };
      }

      const functionalityStatus = normalizeFunctionalityStatus(note.functionalityStatus);
      if (JSON.stringify(note.functionalityStatus ?? null) !== JSON.stringify(functionalityStatus)) {
        changed = true;
      }

      return {
        ...note,
        functionalityStatus,
      };
    });

    if (entry?.selector !== selector || sourceNotes.length !== nextNotes.length) {
      changed = true;
    }

    normalized[selector] = {
      ...entry,
      selector: entry?.selector || selector,
      notes: nextNotes,
    };
  }

  return [normalized, changed];
}

function getLatestNoteTime(entry) {
  const notes = Array.isArray(entry?.notes) ? entry.notes : [];
  let latest = 0;

  for (const note of notes) {
    const time = Date.parse(note?.createdAt || '');
    if (!Number.isNaN(time) && time > latest) {
      latest = time;
    }
  }

  return latest;
}

function sortNotesForStorage(notes) {
  return Object.fromEntries(
    Object.entries(notes).sort(([selectorA, entryA], [selectorB, entryB]) => {
      const latestA = getLatestNoteTime(entryA);
      const latestB = getLatestNoteTime(entryB);

      if (latestA !== latestB) {
        return latestB - latestA;
      }

      return selectorA.localeCompare(selectorB);
    })
  );
}

async function writeNotes(notes) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(sortNotesForStorage(notes), null, 2));
}

async function readBody(req) {
  return await new Promise((resolve) => {
    let chunks = '';
    req.on('data', (chunk) => {
      chunks += chunk;
    });
    req.on('end', () => resolve(chunks));
  });
}

async function readBodyBuffer(req) {
  return await new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function send(res, statusCode, headers, body) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

async function serveFile(req, res, filePath) {
  try {
    const stat = await fs.stat(filePath);
    const range = req.headers.range;
    const contentType = contentTypes[path.extname(filePath)] || 'application/octet-stream';

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        send(res, 416, { 'Content-Range': `bytes */${stat.size}` }, '');
        return;
      }

      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= stat.size) {
        send(res, 416, { 'Content-Range': `bytes */${stat.size}` }, '');
        return;
      }

      if (start === 0 && end === stat.size - 1) {
        const body = await fs.readFile(filePath);
        send(res, 200, {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        }, body);
        return;
      }

      res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    const body = await fs.readFile(filePath);
    send(res, 200, {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': body.length,
    }, body);
  } catch {
    send(res, 404, {}, 'Not found');
  }
}

async function readAudEpItems() {
  try {
    return JSON.parse(await fs.readFile(audEpItemsFile, 'utf8'));
  } catch {
    return [];
  }
}

async function writeAudEpItems(items) {
  await fs.mkdir(audEpDir, { recursive: true });
  await fs.writeFile(audEpItemsFile, JSON.stringify(items, null, 2));
}

async function readAudSegItems() {
  try {
    const [items, changed] = normalizeAudSegItems(JSON.parse(await fs.readFile(audSegItemsFile, 'utf8')));
    if (changed) {
      await writeAudSegItems(items);
    }
    return items;
  } catch {
    return [];
  }
}

async function writeAudSegItems(items) {
  await fs.mkdir(audSegDir, { recursive: true });
  await fs.writeFile(audSegItemsFile, JSON.stringify(items, null, 2));
}

async function readLangUnitItems() {
  try {
    return JSON.parse(await fs.readFile(langUnitItemsFile, 'utf8'));
  } catch {
    return [];
  }
}

async function writeLangUnitItems(items) {
  await fs.mkdir(langUnitDir, { recursive: true });
  await fs.writeFile(langUnitItemsFile, JSON.stringify(items, null, 2));
}

function collectLangUnitRefsById(subSegItems) {
  const refsById = new Map();

  for (const subSegItem of Array.isArray(subSegItems) ? subSegItems : []) {
    const subSegId = String(subSegItem?._id ?? '').trim();
    const audSegId = String(subSegItem?.audSegId ?? '').trim();
    if (!subSegId || !audSegId) {
      continue;
    }

    for (const token of Array.isArray(subSegItem?.content) ? subSegItem.content : []) {
      const langUnitId = String(token?.langUnitId ?? '').trim();
      if (token?.type !== 'langUnitRef' || !langUnitId) {
        continue;
      }

      const refs = refsById.get(langUnitId) ?? [];
      refs.push({ audSegId, subSegId });
      refsById.set(langUnitId, refs);
    }
  }

  return refsById;
}

function normalizeLangUnitRefs(refs) {
  const seen = new Set();
  const normalized = [];

  for (const ref of Array.isArray(refs) ? refs : []) {
    if (!ref || typeof ref !== 'object') {
      continue;
    }

    const audSegId = String(ref.audSegId ?? '').trim();
    const subSegId = String(ref.subSegId ?? '').trim();
    if (!audSegId || !subSegId) {
      continue;
    }

    const key = `${audSegId}\u0000${subSegId}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({ audSegId, subSegId });
  }

  return normalized;
}

function sortLangUnitItems(items) {
  return items.slice().sort((a, b) => {
    const createdA = Date.parse(a?.createdAt ?? '');
    const createdB = Date.parse(b?.createdAt ?? '');
    if (!Number.isNaN(createdA) && !Number.isNaN(createdB) && createdA !== createdB) {
      return createdA - createdB;
    }

    return String(a?._id ?? '').localeCompare(String(b?._id ?? ''));
  });
}

function normalizeLangUnitItems(items, refsById = new Map()) {
  const seenIds = new Set();
  let changed = false;

  const normalized = (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item !== 'object') {
      changed = true;
      return item;
    }

    const id = typeof item._id === 'string' && item._id && !seenIds.has(item._id) ? item._id : randomUUID();
    if (id !== item._id) {
      changed = true;
    }

    const refs = normalizeLangUnitRefs(refsById.get(id) ?? item.refs);
    if (JSON.stringify(refs) !== JSON.stringify(Array.isArray(item.refs) ? item.refs : [])) {
      changed = true;
    }

    seenIds.add(id);
    return {
      ...item,
      _id: id,
      text: String(item.text ?? ''),
      context: String(item.context ?? ''),
      refs,
      createdAt: typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : new Date().toISOString(),
    };
  });

  return [normalized, changed];
}

async function rebuildLangUnitItems() {
  const refsById = collectLangUnitRefsById(await readSubSegItems());
  const [items, changed] = normalizeLangUnitItems(await readLangUnitItems(), refsById);
  if (changed) {
    await writeLangUnitItems(items);
  }

  return sortLangUnitItems(items);
}

let codexWorkerClient = null;
let codexWorkerPrimeComplete = false;
let codexWorkerPrimeResolve = null;
let codexWorkerPrimePromise = Promise.resolve();

function getCodexWorkerClient() {
  if (codexWorkerClient) {
    return codexWorkerClient;
  }

  const child = spawn(process.execPath, [codexWorkerEntry], {
    cwd: codexWorkerDir,
    env: {
      ...process.env,
      CODEX_WORKER_STREAMED: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout = createInterface({ input: child.stdout });
  const pending = [];
  let queue = Promise.resolve();

  codexWorkerPrimeComplete = false;
  codexWorkerPrimePromise = new Promise((resolve) => {
    codexWorkerPrimeResolve = resolve;
  });

  child.stderr.on('data', (chunk) => {
    const text = String(chunk);
    process.stderr.write(text);
    if (text.includes('[codex-worker] ready') && !codexWorkerPrimeComplete) {
      codexWorkerPrimeComplete = true;
      codexWorkerPrimeResolve?.();
      codexWorkerPrimeResolve = null;
    }
  });

  child.on('exit', () => {
    codexWorkerClient = null;
    codexWorkerPrimeResolve?.();
    codexWorkerPrimeComplete = false;
    codexWorkerPrimeResolve = null;
    codexWorkerPrimePromise = Promise.resolve();
    while (pending.length) {
      pending.shift()?.reject(new Error('Codex worker exited.'));
    }
  });

  stdout.on('line', (line) => {
    const entry = pending.shift();
    if (!entry) {
      return;
    }

    try {
      entry.resolve(JSON.parse(line));
    } catch (error) {
      entry.reject(error);
    }
  });

  codexWorkerClient = {
    request(payload) {
      const job = queue.then(() => new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      }));
      queue = job.then(() => undefined, () => undefined);
      return job;
    },
    close() {
      child.kill();
    },
  };

  return codexWorkerClient;
}

async function waitForCodexWorkerPrimeComplete() {
  getCodexWorkerClient();
  await codexWorkerPrimePromise;
  return codexWorkerPrimeComplete;
}

async function inferLangUnitRoot(langUnitId, payload) {
  const worker = getCodexWorkerClient();
  const result = await worker.request(payload);
  const root = String(result?.res ?? '').trim();
  if (!root) {
    return null;
  }

  const items = await readLangUnitItems();
  const now = new Date().toISOString();
  let updated = null;
  const next = items.map((item) => {
    if (String(item?._id ?? '') !== String(langUnitId ?? '')) {
      return item;
    }

    updated = {
      ...item,
      root,
      updatedAt: now,
    };
    return updated;
  });

  if (!updated) {
    return null;
  }

  await writeLangUnitItems(sortLangUnitItems(next));
  return { langUnit: updated, res: root };
}

process.once('exit', () => {
  codexWorkerClient?.close();
});

async function handleCodexWorkerApi(req, res, url) {
  if (req.method !== 'GET' || url.pathname !== '/api/codex-worker/status') {
    return false;
  }

  await waitForCodexWorkerPrimeComplete();
  send(
    res,
    200,
    { 'Content-Type': 'application/json; charset=utf-8' },
    JSON.stringify({ primeComplete: codexWorkerPrimeComplete })
  );
  return true;
}

function normalizeAudSegItems(items) {
  const seenIds = new Set();
  let changed = false;

  const normalized = (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item !== 'object') {
      changed = true;
      return item;
    }

    const id = typeof item._id === 'string' && item._id && !seenIds.has(item._id) ? item._id : randomUUID();
    if (id !== item._id) {
      changed = true;
    }

    seenIds.add(id);
    return id === item._id ? item : { ...item, _id: id };
  });

  return [normalized, changed];
}

async function readSubSegItems() {
  try {
    return JSON.parse(await fs.readFile(subSegItemsFile, 'utf8'));
  } catch {
    return [];
  }
}

async function writeSubSegItems(items) {
  await fs.mkdir(subSegDir, { recursive: true });
  await fs.writeFile(subSegItemsFile, JSON.stringify(items, null, 2));
}

function sortSubSegItems(items) {
  return items.slice().sort((a, b) => {
    const audSegA = String(a?.audSegId ?? '');
    const audSegB = String(b?.audSegId ?? '');
    if (audSegA !== audSegB) {
      return audSegA.localeCompare(audSegB);
    }

    const createdA = Date.parse(a?.createdAt ?? '');
    const createdB = Date.parse(b?.createdAt ?? '');
    if (!Number.isNaN(createdA) && !Number.isNaN(createdB) && createdA !== createdB) {
      return createdA - createdB;
    }

    return String(a?._id ?? '').localeCompare(String(b?._id ?? ''));
  });
}

function sortAudSegItems(items) {
  return items.slice().sort((a, b) => {
    const indexA = Number(a?.audEpIndex ?? 0);
    const indexB = Number(b?.audEpIndex ?? 0);
    if (indexA !== indexB) {
      return indexA - indexB;
    }

    const tcsA = Number(a?.tcs ?? 0);
    const tcsB = Number(b?.tcs ?? 0);
    if (tcsA !== tcsB) {
      return tcsA - tcsB;
    }

    return String(a?._id ?? '').localeCompare(String(b?._id ?? ''));
  });
}

function shiftAudSegRefs(items, startIndex, delta) {
  return items.map((item) => {
    if (!Number.isInteger(item?.audEpIndex)) {
      return item;
    }

    if (delta > 0 && item.audEpIndex >= startIndex) {
      return { ...item, audEpIndex: item.audEpIndex + delta };
    }

    if (delta < 0 && item.audEpIndex > startIndex) {
      return { ...item, audEpIndex: item.audEpIndex + delta };
    }

    return item;
  });
}

async function removeAudEpMedia(item) {
  const storedNames = new Set([
    item?.audioFileRef,
    ...(item?.media || []).map((media) => media?.storedName),
  ]);

  for (const storedName of storedNames) {
    if (!storedName) {
      continue;
    }

    try {
      await fs.unlink(path.join(mediaDir, path.basename(storedName)));
    } catch {
      // Ignore missing files; the item record is the source of truth.
    }
  }
}

function safeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'audio';
}

async function handleAudEpApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/audEps/items') {
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(await readAudEpItems()));
    return true;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/audEps/media/')) {
    const storedName = path.basename(decodeURIComponent(url.pathname.slice('/api/audEps/media/'.length)));
    const filePath = path.join(mediaDir, storedName);
    if (!filePath.startsWith(mediaDir)) {
      send(res, 400, {}, 'Bad request');
      return true;
    }
    await serveFile(req, res, filePath);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/audEps/upload') {
    const rawFileName = req.headers['x-filename'];
    const itemIndex = Number(req.headers['x-item-index'] ?? 0);
    if (!rawFileName || Number.isNaN(itemIndex)) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'x-filename and x-item-index are required' }));
      return true;
    }
    let fileName = String(rawFileName);
    try {
      fileName = decodeURIComponent(fileName);
    } catch {
      fileName = String(rawFileName);
    }

    const body = await readBodyBuffer(req);
    if (!body.length) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'empty file' }));
      return true;
    }

    await fs.mkdir(mediaDir, { recursive: true });
    const ext = path.extname(String(fileName));
    const storedName = `${Date.now()}-${randomUUID()}-${safeFilename(path.basename(String(fileName), ext))}${ext}`;
    const storedPath = path.join(mediaDir, storedName);
    await fs.writeFile(storedPath, body);

    const items = await readAudEpItems();
    const insertIndex = Math.max(0, Math.min(itemIndex, items.length));
    items.splice(insertIndex, 0, { label: '', media: [] });
    const audSegItems = await readAudSegItems();
    await writeAudSegItems(shiftAudSegRefs(audSegItems, insertIndex, 1));

    const item = items[insertIndex];
    item.media ??= [];
    item.media.push({
      originalName: String(fileName),
      storedName,
      mimeType: String(req.headers['content-type'] || 'application/octet-stream'),
      createdAt: new Date().toISOString(),
    });
    item.audioFileRef = storedName;
    item.audioTitle = item.audioTitle || path.basename(String(fileName), ext);
    item.label = item.label || item.audioTitle;
    await writeAudEpItems(items);

    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ itemIndex: insertIndex, item, storedName }));
    return true;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/audEps/items/')) {
    const itemIndex = Number(url.pathname.slice('/api/audEps/items/'.length));
    const items = await readAudEpItems();
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= items.length) {
      send(res, 404, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'item not found' }));
      return true;
    }

    const [removed] = items.splice(itemIndex, 1);
    await removeAudEpMedia(removed);
    await writeAudEpItems(items);
    const audSegItems = await readAudSegItems();
    await writeAudSegItems(
      audSegItems
        .filter((item) => item?.audEpIndex !== itemIndex)
        .map((item) =>
          Number.isInteger(item?.audEpIndex) && item.audEpIndex > itemIndex
            ? { ...item, audEpIndex: item.audEpIndex - 1 }
            : item
        )
    );

    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ deletedIndex: itemIndex }));
    return true;
  }

  return false;
}

async function handleNotesApi(req, res) {
  if (req.method === 'GET') {
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(await readNotes()));
    return true;
  }

  if (req.method === 'POST') {
    let payload = {};
    try {
      payload = JSON.parse(await readBody(req) || '{}');
    } catch {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'invalid JSON' }));
      return true;
    }

    const { selector, text } = payload;
    if (!selector || !text) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'selector and text are required' }));
      return true;
    }

    const notes = await readNotes();
    const entry = notes[selector] || { selector, notes: [] };
    entry.notes.push({
      text,
      createdAt: new Date().toISOString(),
      functionalityStatus: createDefaultFunctionalityStatus(),
    });
    notes[selector] = entry;
    await writeNotes(notes);

    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(entry));
    return true;
  }

  return false;
}

async function handleAudSegApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/audSegs/items') {
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(sortAudSegItems(await readAudSegItems())));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/audSegs/items') {
    let payload = {};
    try {
      payload = JSON.parse(await readBody(req) || '{}');
    } catch {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'invalid JSON' }));
      return true;
    }

    const audEpIndex = Number(payload.audEpIndex);
    const tcs = Number(payload.tcs ?? 0);
    const tce = payload.tce === '' || payload.tce == null ? '' : Number(payload.tce);
    const ssHead = String(payload.ssHead ?? '');
    if (!Number.isInteger(audEpIndex)) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'audEpIndex is required' }));
      return true;
    }

    const items = await readAudSegItems();
    const item = {
      _id: randomUUID(),
      audEpIndex,
      tcs,
      tce,
      ssHead,
    };
    items.push(item);
    await writeAudSegItems(sortAudSegItems(items));
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(item));
    return true;
  }

  return false;
}

async function handleLangUnitApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/langUnits/items') {
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(await rebuildLangUnitItems()));
    return true;
  }

  if (req.method === 'POST') {
    const match = /^\/api\/langUnits\/items\/([^/]+)\/root$/.exec(url.pathname);
    if (!match) {
      return false;
    }

    let payload = {};
    try {
      payload = JSON.parse(await readBody(req) || '{}');
    } catch {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'invalid JSON' }));
      return true;
    }

    const langUnitId = decodeURIComponent(match[1] || '').trim();
    const context = String(payload.context ?? '').trim();
    const target = String(payload.target ?? '').trim();
    const substring = String(payload.substring ?? '').trim();
    if (!langUnitId || !context || !target || !substring) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'langUnitId, context, target, and substring are required' }));
      return true;
    }

    if (!/^[A-Za-z]+$/.test(target)) {
      send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(null));
      return true;
    }

    const result = await inferLangUnitRoot(langUnitId, { context, target, substring });
    if (!result) {
      send(res, 404, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'langUnit not found' }));
      return true;
    }

    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(result));
    return true;
  }

  return false;
}

async function handleSubSegApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/subSegs/items') {
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(sortSubSegItems(await readSubSegItems())));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/subSegs/items') {
    let payload = {};
    try {
      payload = JSON.parse(await readBody(req) || '{}');
    } catch {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'invalid JSON' }));
      return true;
    }

    const audSegId = String(payload.audSegId ?? '').trim();
    const content = Array.isArray(payload.content) ? payload.content : null;
    const text = String(payload.text ?? '');
    const langUnits = Array.isArray(payload.langUnits) ? payload.langUnits : [];
    if (!audSegId) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'audSegId is required' }));
      return true;
    }

    if (langUnits.length) {
      const existingLangUnits = await readLangUnitItems();
      const langUnitMap = new Map(existingLangUnits.map((item) => [String(item?._id ?? ''), item]));

      for (const langUnit of langUnits) {
        if (!langUnit || typeof langUnit !== 'object') {
          continue;
        }

        const id = String(langUnit._id ?? '').trim() || randomUUID();
        const now = new Date().toISOString();
        const current = langUnitMap.get(id);
        langUnitMap.set(id, {
          ...current,
          ...langUnit,
          _id: id,
          text: String(langUnit.text ?? current?.text ?? ''),
          createdAt: current?.createdAt || String(langUnit.createdAt ?? now),
          updatedAt: now,
        });
      }

      await writeLangUnitItems(sortLangUnitItems([...langUnitMap.values()]));
    }

    const items = await readSubSegItems();
    const index = items.findIndex((item) => item?.audSegId === audSegId);
    if ((content && !content.length) || (!content && !text.trim())) {
      if (index >= 0) {
        items.splice(index, 1);
        await writeSubSegItems(sortSubSegItems(items));
      }

      await rebuildLangUnitItems();
      send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(null));
      return true;
    }

    const saved = {
      _id: index >= 0 ? items[index]._id : randomUUID(),
      audSegId,
      ...(content ? { content } : {}),
      text,
      createdAt: index >= 0 ? items[index].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (index >= 0) {
      items[index] = saved;
    } else {
      items.push(saved);
    }

    await writeSubSegItems(sortSubSegItems(items));
    const updatedLangUnits = await rebuildLangUnitItems();
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ subSeg: saved, langUnits: updatedLangUnits }));
    return true;
  }

  return false;
}

async function serveIndex(res, vite, urlPath, fromDist = false) {
  const filePath = fromDist ? path.join(distDir, 'src', 'frontend', 'index.html') : frontendIndexFile;
  const html = await fs.readFile(filePath, 'utf8');
  const transformed = vite ? await vite.transformIndexHtml(urlPath, html) : html;
  send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, transformed);
}

async function createApp() {
  if (isDev) {
    const vite = await createViteServer({
      appType: 'custom',
      server: { middlewareMode: true },
    });

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/api/notes' && (await handleNotesApi(req, res))) {
        return;
      }

      if (url.pathname.startsWith('/api/codex-worker/') && (await handleCodexWorkerApi(req, res, url))) {
        return;
      }

      if (url.pathname.startsWith('/api/langUnits/') && (await handleLangUnitApi(req, res, url))) {
        return;
      }

      if (url.pathname.startsWith('/api/subSegs/') && (await handleSubSegApi(req, res, url))) {
        return;
      }

      if (url.pathname.startsWith('/api/audSegs/') && (await handleAudSegApi(req, res, url))) {
        return;
      }

      if (url.pathname.startsWith('/api/audEps/') && (await handleAudEpApi(req, res, url))) {
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        await serveIndex(res, vite, url.pathname);
        return;
      }

      vite.middlewares(req, res, () => {
        send(res, 404, {}, 'Not found');
      });
    });

    server.listen(port, () => {
      console.log(`http://localhost:${port}`);
    });

    return;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/notes' && (await handleNotesApi(req, res))) {
      return;
    }

    if (url.pathname.startsWith('/api/codex-worker/') && (await handleCodexWorkerApi(req, res, url))) {
      return;
    }

    if (url.pathname.startsWith('/api/langUnits/') && (await handleLangUnitApi(req, res, url))) {
      return;
    }

    if (url.pathname.startsWith('/api/subSegs/') && (await handleSubSegApi(req, res, url))) {
      return;
    }

    if (url.pathname.startsWith('/api/audSegs/') && (await handleAudSegApi(req, res, url))) {
      return;
    }

    if (url.pathname.startsWith('/api/audEps/') && (await handleAudEpApi(req, res, url))) {
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      await serveIndex(res, null, url.pathname, true);
      return;
    }

    if (req.method !== 'GET') {
      send(res, 405, {}, 'Method not allowed');
      return;
    }

    const filePath = path.join(distDir, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(distDir)) {
      send(res, 400, {}, 'Bad request');
      return;
    }

    await serveFile(req, res, filePath);
  });

  server.listen(port, () => {
    console.log(`http://localhost:${port}`);
  });
}

createApp();
