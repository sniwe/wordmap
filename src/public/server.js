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
const timeTrackingDir = path.join(root, 'src', 'backend', 'data', 'timeTracking');
const timeTrackingItemsFile = path.join(timeTrackingDir, 'items.json');
const port = Number(process.env.PORT || 3000);
const codexWorkerRequestTimeoutMs = Number(process.env.CODEX_WORKER_REQUEST_TIMEOUT_MS || 60000);
const codexWorkerRepairBaseMs = Number(process.env.CODEX_WORKER_REPAIR_BASE_MS || 250);
const codexWorkerRepairMaxMs = Number(process.env.CODEX_WORKER_REPAIR_MAX_MS || 5000);
const codexWorkerNoReadyWaitMs = Number(process.env.CODEX_WORKER_NO_READY_WAIT_MS || 500);
const isDev = process.argv.includes('--dev');
let langUnitWriteQueue = Promise.resolve();
let langUnitMutationQueue = Promise.resolve();
let lastGoodLangUnitItems = null;
let timeTrackingWriteQueue = Promise.resolve();

function runLangUnitMutation(mutator) {
  const result = langUnitMutationQueue.then(mutator);
  langUnitMutationQueue = result.catch(() => {});
  return result;
}

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
  '.mp3': 'audio/mpeg',
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

async function readJsonArray(file, collectionName) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }

    throw new Error(`Failed to read ${collectionName}: ${error?.message ?? error}`, { cause: error });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${collectionName}: ${error?.message ?? error}`, { cause: error });
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid ${collectionName}: expected a JSON array`);
  }

  return parsed;
}

async function readAudEpItems() {
  const [normalized, changed] = normalizeAudEpItems(await readJsonArray(audEpItemsFile, 'audEps'));
  if (changed) {
    await writeAudEpItems(normalized);
  }

  return normalized;
}

async function writeAudEpItems(items) {
  const [normalized] = normalizeAudEpItems(Array.isArray(items) ? items : []);
  await atomicWriteJsonFile(audEpDir, audEpItemsFile, normalized);
}

function normalizeAudEpItems(items) {
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

async function readAudSegItems() {
  const [items, changed] = normalizeAudSegItems(await readJsonArray(audSegItemsFile, 'audSegs'));
  if (changed) {
    await writeAudSegItems(items);
  }

  return items;
}

async function writeAudSegItems(items) {
  await atomicWriteJsonFile(audSegDir, audSegItemsFile, Array.isArray(items) ? items : []);
}

async function atomicWriteJsonFile(dir, file, value) {
  await fs.mkdir(dir, { recursive: true });
  const tmpFile = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await fs.rename(tmpFile, file);
        return;
      } catch (error) {
        if (attempt >= 2 || !['EBUSY', 'EPERM'].includes(error?.code)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  } catch (error) {
    await fs.unlink(tmpFile).catch(() => {});
    throw error;
  }
}

async function readLangUnitItems() {
  try {
    const items = JSON.parse(await fs.readFile(langUnitItemsFile, 'utf8'));
    const [normalized] = normalizeLangUnitItemsForStorage(Array.isArray(items) ? items : []);
    const changed = JSON.stringify(normalized) !== JSON.stringify(Array.isArray(items) ? items : []);
    if (changed) {
      await writeLangUnitItems(normalized);
    }

    lastGoodLangUnitItems = normalized;
    return normalized;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      lastGoodLangUnitItems = [];
      return [];
    }

    console.error(`Failed to read ${langUnitItemsFile}:`, error);
    if (lastGoodLangUnitItems) {
      return lastGoodLangUnitItems;
    }

    throw error;
  }
}

async function writeLangUnitItems(items) {
  langUnitWriteQueue = langUnitWriteQueue.catch(() => {}).then(async () => {
    const [normalized] = normalizeLangUnitItemsForStorage(Array.isArray(items) ? items : []);
    await atomicWriteJsonFile(langUnitDir, langUnitItemsFile, normalized);
    lastGoodLangUnitItems = normalized;
    return normalized;
  });
  return langUnitWriteQueue;
}

function normalizeLangUnitItem(item, now = new Date().toISOString()) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const _id = String(item._id ?? '').trim() || randomUUID();
  const instances = normalizeLangUnitInstances(item.instances ?? (item.context ? [{ context: item.context }] : []));
  const primaryInstance = instances.find((instance) => instance?.target || instance?.context) ?? instances[0] ?? null;
  const target = normalizeLangUnitTarget(
    item.target ?? primaryInstance?.target ?? item.text,
    primaryInstance?.context?.type ?? item.target?.type ?? '',
    {
      text: String(item.text ?? ''),
      start: Number.isFinite(primaryInstance?.start) ? primaryInstance.start : null,
      end: Number.isFinite(primaryInstance?.end) ? primaryInstance.end : null,
    }
  );
  const normalized = {
    ...item,
    _id,
    text: String(item.text ?? '').trim(),
    status: ['default', 'done'].includes(String(item.status ?? '').trim())
      ? String(item.status).trim()
      : 'default',
    instances,
    target,
    ...(Array.isArray(item.compositions) ? { compositions: item.compositions } : {}),
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now,
  };

  const root = String(item.root ?? '').trim();
  if (root) {
    normalized.root = root;
  } else {
    delete normalized.root;
  }

  delete normalized.captures;
  delete normalized.context;
  delete normalized.content;
  delete normalized.start;
  delete normalized.end;
  delete normalized.linkTargetLangUnitId;
  return normalized;
}

function mergeLangUnitItems(existingItems, incomingItems) {
  const now = new Date().toISOString();
  const byId = new Map();

  for (const item of Array.isArray(existingItems) ? existingItems : []) {
    const normalized = normalizeLangUnitItem(item, now);
    if (normalized) {
      byId.set(normalized._id, normalized);
    }
  }

  for (const item of Array.isArray(incomingItems) ? incomingItems : []) {
    const normalized = normalizeLangUnitItem(item, now);
    if (!normalized) {
      continue;
    }

    const previous = byId.get(normalized._id);
    byId.set(normalized._id, {
      ...(previous ?? {}),
      ...normalized,
      text: String(normalized.text ?? previous?.text ?? ''),
      instances: normalizeLangUnitInstances(normalized.instances.length ? normalized.instances : previous?.instances ?? []),
      compositions: [...new Map([
        ...(Array.isArray(previous?.compositions) ? previous.compositions : []),
        ...(Array.isArray(normalized.compositions) ? normalized.compositions : []),
      ].map((composition) => [String(composition?.compositionId ?? ''), composition])).values()].filter((composition) => String(composition?.compositionId ?? '').trim()),
      createdAt: previous?.createdAt || normalized.createdAt,
      updatedAt: normalized.updatedAt || previous?.updatedAt || now,
    });
  }

  return sortLangUnitItems([...byId.values()]);
}

function normalizeSubSegContentForStorage(content) {
  let changed = false;
  const normalized = [];

  for (const token of Array.isArray(content) ? content : []) {
    if (!token || typeof token !== 'object') {
      normalized.push(token);
      continue;
    }

    if (token.type !== 'langUnitRef') {
      normalized.push(token);
      continue;
    }

    const langUnitId = String(token.langUnitId ?? '').trim();
    if (!langUnitId) {
      changed = true;
      continue;
    }

    const nextToken = {
      type: 'langUnitRef',
      langUnitId,
    };
    if (typeof token.text === 'string') {
      nextToken.text = token.text;
    }
    if (token.remote === true) {
      nextToken.remote = true;
    }
    for (const key of ['compositionId', 'partId', 'partRole', 'partTargetType', 'partSourceId']) {
      const value = String(token[key] ?? '').trim();
      if (value) {
        nextToken[key] = value;
      }
    }
    if (JSON.stringify(token) !== JSON.stringify(nextToken)) {
      changed = true;
    }
    normalized.push(nextToken);
  }

  return [normalized, changed];
}

function getSubSegIdFromDerivedLangUnitId(langUnitId) {
  const id = String(langUnitId ?? '').trim();
  const separator = id.lastIndexOf('-');
  return separator > 0 ? id.slice(0, separator) : '';
}

function rewriteSubSegContentWithoutLangUnits(content, langUnitsById = new Map()) {
  const nextContent = [];
  let changed = false;

  for (const token of Array.isArray(content) ? content : []) {
    if (!token || typeof token !== 'object') {
      nextContent.push(token);
      continue;
    }

    if (token.type !== 'langUnitRef') {
      nextContent.push(token);
      continue;
    }

    const langUnitId = String(token.langUnitId ?? '').trim();
    if (!langUnitId) {
      changed = true;
      continue;
    }

    const langUnit = langUnitsById.get(langUnitId);
    let text = String(token.text ?? langUnit?.text ?? '');
    if (!String(token.compositionId ?? '').trim() && !String(token.partId ?? '').trim()) {
      const aggregateText = String(langUnit?.target?.text ?? langUnit?.text ?? '').trim();
      const addition = (Array.isArray(langUnit?.compositions) ? langUnit.compositions : [])
        .flatMap((composition) => Array.isArray(composition?.parts) ? composition.parts : [])
        .find((part) => String(part?.role ?? '').trim() === 'addition' && String(part?.text ?? '').trim());
      if (addition && text.trim() === aggregateText) {
        text = String(addition.text);
      }
    }
    if (!text) {
      changed = true;
      continue;
    }

    nextContent.push({ type: 'text', text });
    changed = true;
  }

  return [nextContent, changed];
}

function normalizeSubSegItemsForStorage(items) {
  const normalized = [];
  let changed = false;

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') {
      normalized.push(item);
      continue;
    }

    const content = Array.isArray(item.content) ? item.content : null;
    if (!content) {
      normalized.push(item);
      continue;
    }

    const [nextContent, contentChanged] = normalizeSubSegContentForStorage(content);
    if (!contentChanged) {
      normalized.push(item);
      continue;
    }

    changed = true;
    normalized.push({
      ...item,
      content: nextContent,
    });
  }

  return [normalized, changed];
}

function collectLangUnitInstancesById(subSegItems, langUnitsById = new Map()) {
  const instancesById = new Map();

  for (const subSegItem of Array.isArray(subSegItems) ? subSegItems : []) {
    const subSegId = String(subSegItem?._id ?? '').trim();
    const audSegId = String(subSegItem?.audSegId ?? '').trim();
    if (!subSegId || !audSegId) {
      continue;
    }

    let plainText = '';
    const seenLangUnitIds = new Map();
    const pendingInstances = [];
    for (const token of Array.isArray(subSegItem?.content) ? subSegItem.content : []) {
      if (!token || typeof token !== 'object' || token.type !== 'langUnitRef') {
        if (token?.type === 'text') {
          plainText += String(token.text ?? '');
        }
        continue;
      }

      const langUnitId = String(token.langUnitId ?? '').trim();
      if (!langUnitId) {
        continue;
      }

      const langUnitText = String(token.text ?? langUnitsById.get(langUnitId)?.text ?? '');
      const start = plainText.length;
      plainText += langUnitText;
      const end = plainText.length;
      const occurrenceIndex = Number.isInteger(seenLangUnitIds.get(langUnitId)) ? seenLangUnitIds.get(langUnitId) : 0;
      seenLangUnitIds.set(langUnitId, occurrenceIndex + 1);
      const existingInstances = Array.isArray(langUnitsById.get(langUnitId)?.instances)
        ? langUnitsById.get(langUnitId).instances.filter(
          (instance) =>
            String(instance?.audSegId ?? '') === audSegId &&
            String(instance?.subSegId ?? '') === subSegId
        )
        : [];
      const existingInstance = existingInstances[occurrenceIndex] ?? existingInstances[0] ?? null;
      const instances = instancesById.get(langUnitId) ?? [];
      const instance = {
        audSegId,
        subSegId,
        remote: token.remote === true,
        ...(String(token.compositionId ?? '').trim() ? { compositionId: String(token.compositionId).trim() } : {}),
        ...(String(token.partId ?? '').trim() ? { partId: String(token.partId).trim() } : {}),
        ...(String(existingInstance?.cycleGroupId ?? '').trim() ? { cycleGroupId: String(existingInstance.cycleGroupId).trim() } : {}),
        start,
        end,
      };
      const existingTarget = existingInstance?.target ?? langUnitsById.get(langUnitId)?.target ?? null;
      if (existingTarget) {
        instance.target = normalizeLangUnitTarget(existingTarget, existingInstance?.context?.type ?? '');
      }
      instances.push(instance);
      pendingInstances.push({ instance, existingInstance });
      instancesById.set(langUnitId, instances);
    }

    for (const { instance, existingInstance } of pendingInstances) {
      const contextText = getLangUnitBubbleContext(plainText, instance.start, instance.end);
      instance.context = normalizeLangUnitContext({
        text: contextText,
        type: String(existingInstance?.context?.text ?? '') === contextText ? existingInstance?.context?.type : '',
      });
    }
  }

  return instancesById;
}

function collectLangUnitCapturesById(subSegItems) {
  const capturesById = new Map();

  for (const subSegItem of Array.isArray(subSegItems) ? subSegItems : []) {
    const subSegId = String(subSegItem?._id ?? '').trim();
    const audSegId = String(subSegItem?.audSegId ?? '').trim();
    if (!subSegId || !audSegId) {
      continue;
    }

    let captureIndex = 0;
    const seenLangUnitIds = new Set();
    let plainText = '';
    const pendingCaptures = [];
    for (const token of Array.isArray(subSegItem?.content) ? subSegItem.content : []) {
      const langUnitId = String(token?.langUnitId ?? '').trim();
      if (token?.type === 'text') {
        plainText += String(token.text ?? '');
        continue;
      }

      if (token?.type !== 'langUnitRef' || !langUnitId) {
        continue;
      }

      const bubbleText = String(token.text ?? '');
      const remote = token.remote === true || (token.remote == null && seenLangUnitIds.has(langUnitId));
      const start = plainText.length;
      plainText += bubbleText;
      const end = plainText.length;
      const captures = capturesById.get(langUnitId) ?? [];
      const capture = {
        audSegId,
        subSegId,
        text: bubbleText,
        captureIndex,
        remote,
        start,
        end,
      };
      captures.push(capture);
      pendingCaptures.push(capture);
      capturesById.set(langUnitId, captures);
      seenLangUnitIds.add(langUnitId);
      captureIndex += 1;
    }

    for (const capture of pendingCaptures) {
      if (capture.captureIndex === 0) {
        capture.context = createLangUnitContext(getLangUnitBubbleContext(plainText, capture.start, capture.end));
        capture.target = createLangUnitTarget(capture.text ?? '', capture.context.type, {
          text: plainText,
          start: capture.start,
          end: capture.end,
        });
      }
    }
  }

  return capturesById;
}

function normalizeLangUnitInstance(instance) {
  if (!instance || typeof instance !== 'object') {
    return null;
  }

  const context = normalizeLangUnitContext(instance.context ?? instance);
  const target = instance.target ? normalizeLangUnitTarget(instance.target, context.type, {
    text: String(instance.target?.text ?? ''),
    start: Number.isFinite(instance.start) ? instance.start : null,
    end: Number.isFinite(instance.end) ? instance.end : null,
  }) : null;
  return {
    ...(String(instance.audSegId ?? '').trim() ? { audSegId: String(instance.audSegId).trim() } : {}),
    ...(String(instance.subSegId ?? '').trim() ? { subSegId: String(instance.subSegId).trim() } : {}),
    remote: instance.remote === true,
    ...(String(instance.cycleGroupId ?? '').trim() ? { cycleGroupId: String(instance.cycleGroupId).trim() } : {}),
    ...(String(instance.compositionId ?? '').trim() ? { compositionId: String(instance.compositionId).trim() } : {}),
    ...(String(instance.partId ?? '').trim() ? { partId: String(instance.partId).trim() } : {}),
    ...(Number.isFinite(instance.start) && instance.start >= 0 ? { start: instance.start } : {}),
    ...(Number.isFinite(instance.end) && instance.end >= 0 ? { end: instance.end } : {}),
    context,
    ...(target ? { target } : {}),
  };
}

function normalizeLangUnitInstances(instances) {
  const seen = new Set();
  const normalized = [];

  for (const instance of Array.isArray(instances) ? instances : []) {
    const normalizedInstance = normalizeLangUnitInstance(instance);
    if (!normalizedInstance) {
      continue;
    }

    const key = [
      String(normalizedInstance.audSegId ?? ''),
      String(normalizedInstance.subSegId ?? ''),
      normalizedInstance.remote ? '1' : '0',
      String(normalizedInstance.cycleGroupId ?? ''),
      String(Number.isFinite(normalizedInstance.start) ? normalizedInstance.start : ''),
      String(Number.isFinite(normalizedInstance.end) ? normalizedInstance.end : ''),
      JSON.stringify(normalizedInstance.context),
      JSON.stringify(normalizedInstance.target ?? null),
    ].join('\u0000');
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(normalizedInstance);
  }

  return normalized;
}

function expandLangUnitCaptures(parentId, captures, existingItemsById = new Map()) {
  const normalizedCaptures = normalizeLangUnitCaptures(captures);
  if (!normalizedCaptures.length) {
    return [];
  }

  const [primary] = normalizedCaptures;
  const now = new Date().toISOString();
  const existingBase = existingItemsById.get(parentId);
  const nextInstances = normalizeLangUnitInstances([
    ...(existingBase?.instances ?? []),
    ...normalizedCaptures.map((capture) => ({
      ...(capture.audSegId ? { audSegId: capture.audSegId } : {}),
      ...(capture.subSegId ? { subSegId: capture.subSegId } : {}),
      remote: capture.remote === true,
      ...(capture.context ? { context: capture.context } : {}),
      ...(capture.target ? { target: capture.target } : {}),
    })),
  ]);
  const base = {
    ...existingBase,
    _id: parentId,
    text: String(primary.text ?? existingBase?.text ?? ''),
    target: normalizeLangUnitTarget(
      primary.target ?? primary.text ?? existingBase?.target ?? primary.text,
      primary.context?.type ?? existingBase?.target?.type ?? ''
    ),
    instances: nextInstances,
    createdAt: existingBase?.createdAt || now,
    updatedAt: existingBase?.updatedAt || now,
  };
  delete base.captures;
  return [base];
}

function normalizeLangUnitItemsForStorage(items) {
  const seen = new Set();
  const normalized = [];

  for (const item of Array.isArray(items) ? items : []) {
    const normalizedItem = normalizeLangUnitItem(item);
    if (!normalizedItem) {
      continue;
    }

    if (seen.has(normalizedItem._id)) {
      continue;
    }

    seen.add(normalizedItem._id);
    normalized.push(normalizedItem);
  }

  return [sortLangUnitItems(normalized)];
}

function syncLangUnitInstances(items, instancesById) {
  const now = new Date().toISOString();
  let changed = false;
  const normalized = [];

  for (const item of Array.isArray(items) ? items : []) {
    const normalizedItem = normalizeLangUnitItem(item, now);
    if (!normalizedItem) {
      continue;
    }

    const nextInstances = normalizeLangUnitInstances(instancesById.get(normalizedItem._id) ?? []);
    const itemChanged = JSON.stringify(nextInstances) !== JSON.stringify(normalizedItem.instances);
    if (itemChanged) {
      changed = true;
    }

    normalized.push({
      ...normalizedItem,
      instances: nextInstances,
      updatedAt: itemChanged ? now : normalizedItem.updatedAt,
    });
  }

  return [sortLangUnitItems(normalized), changed];
}

function flattenLangUnitItems(items) {
  const seen = new Set();
  const normalized = [];

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const id = typeof item._id === 'string' && item._id ? item._id : randomUUID();
    const captures = normalizeLangUnitCaptures(item.captures);
    if (captures.length) {
      const existingItemsById = new Map(normalized.map((entry) => [entry._id, entry]));
      const expanded = expandLangUnitCaptures(id, captures, existingItemsById);
      for (const entry of expanded) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }

        const key = String(entry._id ?? '');
        if (key && seen.has(key)) {
          continue;
        }

        if (key) {
          seen.add(key);
        }
        normalized.push({
          ...entry,
          instances: normalizeLangUnitInstances(entry.instances),
        });
      }
      continue;
    }

    const key = String(id ?? '');
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    const { captures: _legacyCaptures, ...rest } = item;
    normalized.push({
      ...rest,
      _id: id,
      instances: normalizeLangUnitInstances(rest.instances),
    });
  }

  return normalized;
}

function normalizeLangUnitCaptures(captures) {
  const seen = new Set();
  const normalized = [];

  for (const capture of Array.isArray(captures) ? captures : []) {
    if (!capture || typeof capture !== 'object') {
      continue;
    }

    const audSegId = String(capture.audSegId ?? '').trim();
    const subSegId = String(capture.subSegId ?? '').trim();
    const text = String(capture.text ?? '').trim();
    const captureIndex = Number.isInteger(capture.captureIndex) && capture.captureIndex >= 0 ? capture.captureIndex : 0;
    const remote = capture.remote === true;
    const start = Number.isFinite(capture.start) && capture.start >= 0 ? capture.start : null;
    const end = Number.isFinite(capture.end) && capture.end >= 0 ? capture.end : null;
    const context = capture.context && typeof capture.context === 'object' && !Array.isArray(capture.context)
      ? normalizeLangUnitContext(capture.context)
      : null;
    const target = capture.target && typeof capture.target === 'object' && !Array.isArray(capture.target)
      ? normalizeLangUnitTarget(capture.target, capture.context?.type ?? '')
      : null;
    if (!audSegId || !subSegId) {
      continue;
    }

    const key = `${audSegId}\u0000${subSegId}\u0000${captureIndex}\u0000${text}\u0000${remote ? '1' : '0'}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({
      audSegId,
      subSegId,
      text,
      captureIndex,
      remote,
      ...(start != null ? { start } : {}),
      ...(end != null ? { end } : {}),
      ...(context ? { context } : {}),
      ...(target ? { target } : {}),
    });
  }

  return normalized;
}

function remapSubSegLangUnitIds(items, idMap) {
  const normalized = [];
  let changed = false;

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') {
      normalized.push(item);
      continue;
    }

    let contentChanged = false;
    const content = Array.isArray(item.content) ? item.content : null;
    const nextContent = content ? content.map((token) => {
      if (!token || typeof token !== 'object' || token.type !== 'langUnitRef') {
        return token;
      }

      const langUnitId = String(token.langUnitId ?? '').trim();
      const nextLangUnitId = String(idMap.get(langUnitId) ?? langUnitId).trim();
      if (!nextLangUnitId || nextLangUnitId === langUnitId) {
        return token;
      }

      contentChanged = true;
      return {
        ...token,
        langUnitId: nextLangUnitId,
      };
    }) : null;
    const linkTargetLangUnitId = String(item.linkTargetLangUnitId ?? '').trim();
    const nextLinkTargetLangUnitId = String(idMap.get(linkTargetLangUnitId) ?? linkTargetLangUnitId).trim();
    const linkChanged = Boolean(linkTargetLangUnitId && nextLinkTargetLangUnitId && nextLinkTargetLangUnitId !== linkTargetLangUnitId);
    const parentSubSegId = String(item.parentSubSegId ?? '').trim();
    const derivedParentSubSegId = linkChanged ? getSubSegIdFromDerivedLangUnitId(linkTargetLangUnitId) : '';
    const parentChanged = Boolean(!parentSubSegId && derivedParentSubSegId);

    if (!contentChanged && !linkChanged && !parentChanged) {
      normalized.push(item);
      continue;
    }

    changed = true;
    normalized.push({
      ...item,
      ...(nextContent ? { content: nextContent } : {}),
      ...(linkChanged ? { linkTargetLangUnitId: nextLinkTargetLangUnitId } : {}),
      ...(parentChanged ? { parentSubSegId: derivedParentSubSegId } : {}),
    });
  }

  return [normalized, changed];
}

function getLangUnitPrimaryCapture(item) {
  return null;
}

function getLangUnitText(item) {
  return String(item?.text ?? '');
}

function getLangUnitContext(item) {
  const instanceContext = Array.isArray(item?.instances)
    ? item.instances.reduce((best, instance) => {
      const context = instance?.context;
      if (!context || typeof context !== 'object' || Array.isArray(context)) {
        return best;
      }

      return String(context.text ?? '').length > String(best?.text ?? '').length ? context : best;
    }, null)
    : null;
  if (instanceContext && typeof instanceContext === 'object' && !Array.isArray(instanceContext)) {
    return normalizeLangUnitContext(instanceContext);
  }

  if (item?.context && typeof item.context === 'object' && !Array.isArray(item.context)) {
    return normalizeLangUnitContext(item.context);
  }

  return normalizeLangUnitContext('');
}

function getLangUnitContextType(text) {
  const value = String(text ?? '').trim();
  if (!value) {
    return 'engWord';
  }

  const hasChineseCharacters = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(value);
  const letterTokens = value.split(/[^A-Za-z1-5]+/).filter(Boolean);
  const hasSpaces = /\s/.test(value);
  const onlyEnglishishChars = /^[A-Za-z0-9\s\p{P}\p{S}]+$/u.test(value);
  const allTokensArePinyin = letterTokens.length > 0 && letterTokens.every((token) => countPinyinSyllables(token) > 0);

  if (hasChineseCharacters) {
    if (!/[A-Za-z]/.test(value) || allTokensArePinyin) {
      return 'chinPhrase';
    }

    return 'engPhrase';
  }

  if (onlyEnglishishChars && allTokensArePinyin) {
    const pinyinSyllableCount = letterTokens.reduce((count, token) => count + countPinyinSyllables(token), 0);
    return pinyinSyllableCount >= 2 ? 'chinPhrase' : 'chinFuzzWord';
  }

  if (hasSpaces) {
    return 'engPhrase';
  }

  return 'engWord';
}

function countPinyinSyllables(text) {
  const value = String(text ?? '').toLowerCase().replace(/[1-5]/g, '');
  if (!value) {
    return 0;
  }

  const syllables = value.split("'");
  if (syllables.some((syllable) => !syllable)) {
    return 0;
  }

  let total = 0;
  for (const syllable of syllables) {
    const counts = Array(syllable.length + 1).fill(Infinity);
    counts[0] = 0;
    for (let index = 0; index < syllable.length; index += 1) {
      if (!Number.isFinite(counts[index])) {
        continue;
      }
      for (let end = index + 1; end <= syllable.length; end += 1) {
        if (PINYIN_SYLLABLES.has(syllable.slice(index, end))) {
          counts[end] = Math.min(counts[end], counts[index] + 1);
        }
      }
    }

    if (!Number.isFinite(counts[syllable.length])) {
      return 0;
    }

    total += counts[syllable.length];
  }

  return total;
}

const PINYIN_INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's'];
const PINYIN_FINALS = [
  'a', 'ai', 'an', 'ang', 'ao', 'e', 'ei', 'en', 'eng', 'er',
  'o', 'ong', 'ou', 'i', 'ia', 'ian', 'iang', 'iao', 'ie', 'in', 'ing', 'iong',
  'u', 'ua', 'uai', 'uan', 'uang', 'ui', 'un', 'uo', 'v', 've', 'van', 'vn',
];
const PINYIN_SYLLABLES = new Set([
  'zhi', 'chi', 'shi', 'ri', 'zi', 'ci', 'si', 'yi', 'wu', 'yu', 'yue', 'yuan', 'yun', 'yin', 'ying',
  'ng', 'hm', 'hng',
  ...PINYIN_INITIALS.flatMap((initial) => PINYIN_FINALS.map((final) => `${initial}${final}`)),
  ...PINYIN_FINALS,
]);

function normalizeLangUnitContext(context) {
  if (context && typeof context === 'object' && !Array.isArray(context)) {
    const text = String(context.text ?? '');
    const storedType = String(context.type ?? '').trim();
    const hasChineseCharacters = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(text);
    const hasLatinCharacters = /[A-Za-z]/.test(text);
    return {
      text,
      type: storedType === 'chinWord' && hasChineseCharacters && !hasLatinCharacters
        ? 'chinWord'
        : getLangUnitContextType(text),
    };
  }

  const text = String(context ?? '');
  return {
    text,
    type: getLangUnitContextType(text),
  };
}

function createLangUnitContext(text) {
  const value = String(text ?? '');
  return {
    text: value,
    type: getLangUnitContextType(value),
  };
}

function countChineseCharacters(value) {
  return String(value ?? '').match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
}

function isPunctuationOrSymbolOnly(value) {
  const text = String(value ?? '').trim();
  return Boolean(text) && /^[\p{P}\p{S}\s]+$/u.test(text) && !/[A-Za-z0-9\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(text);
}

function normalizeLangUnitTargetType(type) {
  const value = String(type ?? '').trim();
  if (value === 'engPart') {
    return 'engWordPart';
  }

  return value === 'chinChar' ||
    value === 'chinWord' ||
    value === 'chinPhrase' ||
    value === 'chinFuzz' ||
    value === 'chinFuzzPart' ||
    value === 'engWordPart' ||
    value === 'engWord' ||
    value === 'engPhrase' ||
    value === 'chinColl' ||
    value === 'engColl' ||
    value === 'no-op'
    ? value
    : '';
}

function isEnglishWordPartSelection(text, start, end) {
  const value = String(text ?? '');
  const left = start > 0 ? value[start - 1] : '';
  const right = Number.isInteger(end) && end < value.length ? value[end] : '';
  return /[A-Za-z0-9]/.test(left) || /[A-Za-z0-9]/.test(right);
}

function getLangUnitTargetType(text, contextType = '', selection = {}) {
  const value = String(text ?? '').trim();
  const normalizedContextType = String(contextType ?? '').trim();
  const selectionText = String(selection.text ?? '');
  const selectionStart = Number.isInteger(selection.start) ? selection.start : null;
  const selectionEnd = Number.isInteger(selection.end) ? selection.end : null;
  if (!value || isPunctuationOrSymbolOnly(value)) {
    return 'no-op';
  }

  const chineseCharCount = countChineseCharacters(value);
  const hasChineseCharacters = chineseCharCount > 0;
  const hasLatinCharacters = /[A-Za-z]/.test(value);
  const letterTokens = value.split(/[^A-Za-z1-5]+/).filter(Boolean);
  const hasSpaces = /\s/.test(value);
  const onlyEnglishishChars = /^[A-Za-z0-9\s\p{P}\p{S}]+$/u.test(value);
  const allTokensArePinyin = letterTokens.length > 0 && letterTokens.every((token) => countPinyinSyllables(token) > 0);
  const pinyinSyllableCount = letterTokens.reduce((count, token) => count + countPinyinSyllables(token), 0);

  if (hasChineseCharacters && !hasLatinCharacters) {
    if (chineseCharCount === 1) {
      return 'chinChar';
    }

    return chineseCharCount === 2 ? 'chinWord' : 'chinPhrase';
  }

  if (hasChineseCharacters) {
    if (normalizedContextType === 'chinFuzzWord') {
      return 'chinFuzzPart';
    }

    if (normalizedContextType === 'engPhrase') {
      return 'chinPhrase';
    }

    return 'chinFuzz';
  }

  if (onlyEnglishishChars && allTokensArePinyin) {
    if (normalizedContextType === 'chinFuzzWord') {
      return 'chinFuzzPart';
    }

    if (normalizedContextType === 'engWord') {
      return pinyinSyllableCount >= 2 ? 'chinFuzz' : 'engWordPart';
    }

    if (normalizedContextType === 'engPhrase') {
      return pinyinSyllableCount >= 2 ? 'chinFuzz' : 'engWord';
    }

    return 'chinFuzz';
  }

  if (normalizedContextType === 'engPhrase' && onlyEnglishishChars) {
    if (isEnglishWordPartSelection(selectionText || value, selectionStart, selectionEnd)) {
      return 'engWordPart';
    }

    return hasSpaces ? 'engPhrase' : 'engWord';
  }

  if (hasSpaces) {
    return 'engPhrase';
  }

  if (normalizedContextType === 'engWord') {
    return 'engWordPart';
  }

  if (normalizedContextType === 'chinFuzzWord') {
    return 'engWord';
  }

  return 'engWord';
}

function normalizeLangUnitTarget(target, contextType = '', selection = {}) {
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const type = normalizeLangUnitTargetType(target.type);
    if (type) {
      return {
        text: String(target.text ?? ''),
        type,
      };
    }

    const text = String(target.text ?? '');
    return {
      text,
      type: getLangUnitTargetType(text, contextType, selection),
    };
  }

  const text = String(target ?? '');
  return {
    text,
    type: getLangUnitTargetType(text, contextType, selection),
  };
}

function createLangUnitTarget(text, contextType = '', selection = {}) {
  const value = String(text ?? '');
  return {
    text: value,
    type: getLangUnitTargetType(value, contextType, selection),
  };
}

function normalizeLangUnitContextType(type) {
  const value = String(type ?? '').trim();
  return value === 'chinWord' || value === 'chinPhrase' ? value : '';
}

function hasChineseCharacters(value) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(String(value ?? ''));
}

const LANG_UNIT_CONTEXT_BOUNDARIES = new Set(['\r', '\n', '\u2028', '\u2029', '.', '。', '．', '｡']);

function isLangUnitContextBoundary(char) {
  return LANG_UNIT_CONTEXT_BOUNDARIES.has(char);
}

function getLangUnitBubbleContext(text, start, end) {
  let contextStart = 0;
  for (let index = start - 1; index >= 0; index -= 1) {
    if (isLangUnitContextBoundary(text[index])) {
      contextStart = index + 1;
      break;
    }
  }

  let contextEnd = text.length;
  for (let index = end; index < text.length; index += 1) {
    if (isLangUnitContextBoundary(text[index])) {
      contextEnd = index;
      break;
    }
  }

  return text.slice(contextStart, contextEnd);
}

function isChineseDisambiguationCandidate(contextText, targetText, substringText) {
  return (
    hasChineseCharacters(contextText) &&
    hasChineseCharacters(targetText) &&
    countChineseCharacters(substringText) >= 2 &&
    !isPunctuationOrSymbolOnly(targetText) &&
    !isPunctuationOrSymbolOnly(substringText)
  );
}

function isSameLangUnitInstance(instance, match) {
  if (!match || typeof match !== 'object') {
    return false;
  }

  const keys = ['audSegId', 'subSegId', 'cycleGroupId'];
  for (const key of keys) {
    const value = String(match[key] ?? '').trim();
    if (value && String(instance?.[key] ?? '').trim() !== value) {
      return false;
    }
  }

  for (const key of ['start', 'end']) {
    if (Number.isFinite(match[key]) && instance?.[key] !== match[key]) {
      return false;
    }
  }

  return true;
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

function getLangUnitCanonicalKey(item) {
  const target = normalizeLangUnitTarget(item?.target ?? item?.text ?? '', item?.target?.type ?? '');
  const type = normalizeLangUnitTargetType(target.type);
  const text = String(target.text || item?.text || '').trim();
  return type && text ? `${type}\u0000${text}` : '';
}

function subSegHasRecallContent(item) {
  return Boolean((Array.isArray(item?.content) && item.content.length) || String(item?.text ?? '').trim());
}

function hydrateEmptyLinkedSubSegs(items, langUnitItems) {
  const langUnitsById = new Map((Array.isArray(langUnitItems) ? langUnitItems : []).map((item) => [String(item?._id ?? ''), item]));
  const getLinkKey = (item) => {
    const id = String(item?.linkTargetLangUnitId ?? '').trim();
    return getLangUnitCanonicalKey(langUnitsById.get(id)) || id;
  };
  const sourceByKey = new Map();

  for (const item of sortSubSegItems(Array.isArray(items) ? items : [])) {
    if (item?.isRoot !== false || !subSegHasRecallContent(item)) {
      continue;
    }

    const key = getLinkKey(item);
    if (key && !sourceByKey.has(key)) {
      sourceByKey.set(key, item);
    }
  }

  let changed = false;
  const now = new Date().toISOString();
  const next = (Array.isArray(items) ? items : []).map((item) => {
    if (item?.isRoot !== false || subSegHasRecallContent(item)) {
      return item;
    }

    const source = sourceByKey.get(getLinkKey(item));
    if (!source || String(source?._id ?? '') === String(item?._id ?? '')) {
      return item;
    }

    changed = true;
    return {
      ...item,
      content: Array.isArray(source.content) ? source.content : [],
      text: String(source.text ?? ''),
      updatedAt: now,
    };
  });

  return [next, changed];
}

function canonicalizeLangUnitItems(items) {
  const normalized = normalizeLangUnitItemsForStorage(flattenLangUnitItems(items))[0];
  const canonicalByKey = new Map();
  const idMap = new Map();
  const nextById = new Map();
  const now = new Date().toISOString();

  for (const item of sortLangUnitItems(normalized)) {
    const key = getLangUnitCanonicalKey(item);
    if (!key || !canonicalByKey.has(key)) {
      canonicalByKey.set(key || item._id, item._id);
      nextById.set(item._id, item);
      continue;
    }

    const canonicalId = canonicalByKey.get(key);
    idMap.set(item._id, canonicalId);
    const canonical = nextById.get(canonicalId);
    const root = String(canonical?.root ?? item.root ?? '').trim();
    nextById.set(canonicalId, {
      ...canonical,
      ...(root ? { root } : {}),
      instances: normalizeLangUnitInstances([...(canonical?.instances ?? []), ...(item.instances ?? [])]),
      compositions: [...new Map([
        ...(Array.isArray(canonical?.compositions) ? canonical.compositions : []),
        ...(Array.isArray(item?.compositions) ? item.compositions : []),
      ].map((composition) => [String(composition?.compositionId ?? ''), composition])).values()].filter((composition) => String(composition?.compositionId ?? '').trim()),
      updatedAt: now,
    });
  }

  const next = sortLangUnitItems([...nextById.values()]);
  return [next, idMap, JSON.stringify(next) !== JSON.stringify(normalized)];
}

async function readTimeTrackingItems() {
  return readJsonArray(timeTrackingItemsFile, 'timeTracking');
}

function normalizeTimeTrackingDelta(delta) {
  const scopeType = String(delta?.scopeType ?? '').trim();
  const scopeId = String(delta?.scopeId ?? '').trim();
  const allowed = new Set(['page', 'audEp', 'audSeg', 'audSegGroup', 'subSeg']);
  if (!allowed.has(scopeType) || !scopeId || scopeId.length > 300) {
    return null;
  }

  const totals = {};
  for (const metric of ['openMs', 'activeMs', 'playMs', 'activePlayMs']) {
    const value = Number(delta?.totals?.[metric] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > 86_400_000) {
      return null;
    }
    if (value) {
      totals[metric] = Math.round(value);
    }
  }

  return {
    _id: `${scopeType}:${scopeId}`,
    scopeType,
    scopeId,
    ...(delta?.parent && typeof delta.parent === 'object' ? { parent: delta.parent } : {}),
    totals,
  };
}

async function mergeTimeTrackingDeltas(deltas) {
  timeTrackingWriteQueue = timeTrackingWriteQueue.catch(() => {}).then(async () => {
    const items = await readTimeTrackingItems();
    const byId = new Map(items.filter((item) => item && typeof item === 'object').map((item) => [String(item._id), item]));
    const now = new Date().toISOString();
    for (const delta of deltas) {
      const existing = byId.get(delta._id) || {
        _id: delta._id,
        scopeType: delta.scopeType,
        scopeId: delta.scopeId,
        ...(delta.parent ? { parent: delta.parent } : {}),
        totals: {},
      };
      existing.parent = delta.parent || existing.parent || null;
      existing.totals = existing.totals || {};
      for (const [metric, value] of Object.entries(delta.totals)) {
        existing.totals[metric] = (Number(existing.totals[metric]) || 0) + value;
      }
      existing.updatedAt = now;
      byId.set(delta._id, existing);
    }
    await atomicWriteJsonFile(timeTrackingDir, timeTrackingItemsFile, [...byId.values()]);
    return [...byId.values()];
  });
  return timeTrackingWriteQueue;
}

async function handleTimeTrackingApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/timeTracking/items') {
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(await readTimeTrackingItems()));
    return true;
  }

  if (req.method !== 'POST' || url.pathname !== '/api/timeTracking/deltas') {
    return false;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch {
    send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'invalid JSON' }));
    return true;
  }

  const rawDeltas = Array.isArray(payload?.deltas) ? payload.deltas : [];
  if (!rawDeltas.length || rawDeltas.length > 100) {
    send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'deltas must contain 1-100 items' }));
    return true;
  }
  const deltas = rawDeltas.map(normalizeTimeTrackingDelta);
  if (deltas.some((delta) => !delta)) {
    send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'invalid time delta' }));
    return true;
  }
  const items = await mergeTimeTrackingDeltas(deltas);
  send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ accepted: deltas.length, items }));
  return true;
}

function repairLegacyCompositeSubSegItems(items, langUnitItems) {
  const byId = new Map((Array.isArray(langUnitItems) ? langUnitItems : []).map((item) => [String(item?._id ?? ''), item]));
  let changed = false;
  const next = (Array.isArray(items) ? items : []).map((item) => {
    if (!Array.isArray(item?.content)) {
      return item;
    }

    let itemChanged = false;
    const content = item.content.map((token) => {
      if (token?.type !== 'langUnitRef' || String(token.compositionId ?? '').trim() || String(token.partId ?? '').trim()) {
        return token;
      }

      const sourceId = String(token.langUnitId ?? '').trim();
      const sourceText = String(token.text ?? '').trim();
      for (const composite of byId.values()) {
        const composition = (Array.isArray(composite?.compositions) ? composite.compositions : []).find((candidate) => {
          const parts = Array.isArray(candidate?.parts) ? candidate.parts : [];
          return (String(composite?._id ?? '').trim() === sourceId
            || parts.some((part) => String(part?.sourceLangUnitId ?? '').trim() === sourceId))
            && parts.some((part) => String(part?.role ?? '').trim() === 'addition');
        });
        if (!composition) {
          continue;
        }

        const parts = Array.isArray(composition.parts) ? composition.parts : [];
        const role = parts.some((part) => String(part?.sourceLangUnitId ?? '').trim() === sourceId)
          ? 'seed'
          : sourceText === String(composite?.text ?? composite?.target?.text ?? '').trim()
            ? 'addition'
            : '';
        const part = parts.find((candidate) => String(candidate?.role ?? '').trim() === role);
        if (!part || (role === 'addition' && sourceText !== String(composite?.text ?? composite?.target?.text ?? '').trim())) {
          continue;
        }

        changed = true;
        itemChanged = true;
        return {
          ...token,
          langUnitId: String(composite._id),
          text: String(part.text ?? ''),
          compositionId: String(composition.compositionId),
          partId: String(part.partId),
          ...(part.role ? { partRole: String(part.role) } : {}),
          ...(part.target?.type ? { partTargetType: String(part.target.type) } : {}),
          ...(part.sourceLangUnitId ? { partSourceId: String(part.sourceLangUnitId) } : {}),
        };
      }
      return token;
    });

    return itemChanged ? { ...item, content } : item;
  });

  return [next, changed];
}

function remapLangUnitInstanceIds(items, idMap) {
  if (!(idMap instanceof Map) || !idMap.size) {
    return [items, false];
  }

  let changed = false;
  const next = items.map((item) => {
    const instances = Array.isArray(item?.instances) ? item.instances : [];
    let itemChanged = false;
    const nextInstances = instances.map((instance) => {
      const cycleGroupId = String(instance?.cycleGroupId ?? '').trim();
      const nextCycleGroupId = String(idMap.get(cycleGroupId) ?? cycleGroupId).trim();
      if (!cycleGroupId || nextCycleGroupId === cycleGroupId) {
        return instance;
      }

      itemChanged = true;
      changed = true;
      return { ...instance, cycleGroupId: nextCycleGroupId };
    });
    return itemChanged ? { ...item, instances: nextInstances } : item;
  });

  return [next, changed];
}

function normalizeLangUnitItems(items, capturesById = new Map()) {
  const existingItemsByKey = new Map(
    normalizeLangUnitItemsForStorage(flattenLangUnitItems(items))[0].map((item) => [getLangUnitCanonicalKey(item), item])
  );
  const groupedByKey = new Map();
  const keyOrder = [];

  for (const [sourceId, captures] of capturesById.entries()) {
    const normalizedCaptures = normalizeLangUnitCaptures(captures);
    if (!normalizedCaptures.length) {
      continue;
    }

    const primaryCapture = normalizedCaptures[0] ?? null;
    const text = String(primaryCapture?.text ?? '').trim();
    const target = normalizeLangUnitTarget(primaryCapture?.target ?? text, primaryCapture?.context?.type ?? '', {
      text,
      start: primaryCapture?.start,
      end: primaryCapture?.end,
    });
    const key = getLangUnitCanonicalKey({ text, target });
    if (!key) {
      continue;
    }

    let group = groupedByKey.get(key);
    if (!group) {
      group = {
        key,
        text,
        target,
        sourceIds: [],
        captures: [],
      };
      groupedByKey.set(key, group);
      keyOrder.push(key);
    }

    group.sourceIds.push(sourceId);
    group.captures.push(...normalizedCaptures);
  }

  const now = new Date().toISOString();
  const normalized = [];
  const idMap = new Map();

  for (const key of keyOrder) {
    const group = groupedByKey.get(key);
    const captures = normalizeLangUnitCaptures(group?.captures);
    if (!captures.length) {
      continue;
    }

    const existingItem = existingItemsByKey.get(key);
    const primaryCapture = captures[0] ?? null;
    const canonicalId = String(
      existingItem?._id
      ?? (primaryCapture?.subSegId ? `${primaryCapture.subSegId}-${primaryCapture.captureIndex ?? 0}` : '')
      ?? group.sourceIds[0]
      ?? ''
    ).trim() || randomUUID();
    for (const sourceId of group.sourceIds) {
      const trimmed = String(sourceId ?? '').trim();
      if (trimmed && trimmed !== canonicalId) {
        idMap.set(trimmed, canonicalId);
      }
    }

    normalized.push({
      ...(existingItem ?? {}),
      _id: canonicalId,
      text: group.text,
      instances: normalizeLangUnitInstances(
        captures.map((capture) => ({
          ...(capture.audSegId ? { audSegId: capture.audSegId } : {}),
          ...(capture.subSegId ? { subSegId: capture.subSegId } : {}),
          remote: capture.remote === true,
          ...(capture.cycleGroupId ? { cycleGroupId: capture.cycleGroupId } : {}),
          ...(Number.isFinite(capture.start) ? { start: capture.start } : {}),
          ...(Number.isFinite(capture.end) ? { end: capture.end } : {}),
          ...(capture.context ? { context: capture.context } : {}),
        }))
      ),
      target: group.target,
      createdAt: existingItem?.createdAt || now,
      updatedAt: existingItem?.updatedAt || now,
    });
  }

  const merged = sortLangUnitItems(normalized);
  return [merged, idMap, JSON.stringify(merged) !== JSON.stringify(normalizeLangUnitItemsForStorage(flattenLangUnitItems(items))[0])];
}

async function rebuildLangUnitItems() {
  const subSegItems = await readSubSegItems();
  const langUnitItems = await readLangUnitItems();
  const [repairedSubSegItems, repairedSubSegChanged] = repairLegacyCompositeSubSegItems(subSegItems, langUnitItems);
  const [nextSubSegItems, normalizedSubSegChanged] = normalizeSubSegItemsForStorage(repairedSubSegItems);
  const subSegChanged = repairedSubSegChanged || normalizedSubSegChanged;
  if (subSegChanged) {
    await writeSubSegItems(sortSubSegItems(nextSubSegItems));
  }

  let [canonicalLangUnitItems, idMap, canonicalChanged] = canonicalizeLangUnitItems(langUnitItems);
  if (idMap.size) {
    const [remappedSubSegItems, remappedSubSegChanged] = remapSubSegLangUnitIds(nextSubSegItems, idMap);
    if (remappedSubSegChanged) {
      await writeSubSegItems(sortSubSegItems(remappedSubSegItems));
    }
    const [remappedLangUnitItems, remappedLangUnitChanged] = remapLangUnitInstanceIds(canonicalLangUnitItems, idMap);
    canonicalLangUnitItems = remappedLangUnitItems;
    canonicalChanged = canonicalChanged || remappedLangUnitChanged;
  }

  const latestSubSegItems = idMap.size ? await readSubSegItems() : nextSubSegItems;
  const instancesById = collectLangUnitInstancesById(latestSubSegItems, new Map(canonicalLangUnitItems.map((item) => [String(item?._id ?? ''), item])));
  const [items, changed] = syncLangUnitInstances(canonicalLangUnitItems, instancesById);
  if (canonicalChanged || changed) {
    await writeLangUnitItems(items);
  }

  return sortLangUnitItems(items);
}

function normalizeLangUnitChineseTypeResult(result, payload) {
  const res = result?.res;
  const contextType = res && typeof res === 'object' && !Array.isArray(res)
    ? normalizeLangUnitContextType(res.contextType)
    : '';
  const targetType = res && typeof res === 'object' && !Array.isArray(res)
    ? normalizeLangUnitContextType(res.targetType)
    : normalizeLangUnitContextType(res);

  return {
    contextType: contextType || normalizeLangUnitContext(payload?.context ?? '').type,
    targetType,
  };
}

async function inferLangUnitChineseTypes(langUnitId, payload) {
  const result = await requestCodexWorker({ task: 'contextType', ...payload });
  const { contextType, targetType } = normalizeLangUnitChineseTypeResult(result, payload);
  if (!contextType || !targetType) {
    return null;
  }

  return runLangUnitMutation(async () => {
    const items = await readLangUnitItems();
    const now = new Date().toISOString();
    let updated = null;
    const next = items.map((item) => {
    if (String(item?._id ?? '') !== String(langUnitId ?? '')) {
      return item;
    }

    const nextInstances = normalizeLangUnitInstances(item.instances ?? (item.context ? [{ context: item.context }] : []));
    const matchedIndex = nextInstances.findIndex((instance) => isSameLangUnitInstance(instance, payload?.instance));
    const targetIndex = matchedIndex >= 0 ? matchedIndex : 0;
    const instance = nextInstances[targetIndex] ?? null;
    const context = normalizeLangUnitContext(instance?.context ?? getLangUnitContext(item));
    const currentTarget = normalizeLangUnitTarget(instance?.target ?? item.target ?? item.text, context.type, {
      text: String(item.text ?? ''),
      start: Number.isFinite(instance?.start) ? instance.start : null,
      end: Number.isFinite(instance?.end) ? instance.end : null,
    });
    if (
      payload?.requireInstanceMatch &&
      (
        matchedIndex < 0 ||
        String(context.text ?? '').trim() !== String(payload.expectedContextText ?? '').trim() ||
        String(context.type ?? '').trim() !== String(payload.expectedContextType ?? '').trim() ||
        String(currentTarget.text ?? '').trim() !== String(payload.expectedTargetText ?? '').trim() ||
        String(currentTarget.type ?? '').trim() !== String(payload.expectedTargetType ?? '').trim()
      )
    ) {
      return item;
    }

    if (context.type === contextType && currentTarget.type === targetType) {
      return item;
    }

    const nextTarget = {
      ...normalizeLangUnitTarget(currentTarget, contextType, {
        text: String(item.text ?? ''),
        start: Number.isFinite(instance?.start) ? instance.start : null,
        end: Number.isFinite(instance?.end) ? instance.end : null,
      }),
      type: targetType,
    };
    if (!nextInstances.length) {
      const nextItem = {
        ...item,
        target: nextTarget,
        instances: [{ context: { ...context, type: contextType }, target: nextTarget }],
        updatedAt: now,
      };
      updated = nextItem;
      return nextItem;
    }

    nextInstances[targetIndex] = {
      ...nextInstances[targetIndex],
      context: { ...context, type: contextType },
      target: {
        ...normalizeLangUnitTarget(nextInstances[targetIndex].target ?? item.text, contextType, {
          text: String(item.text ?? ''),
          start: Number.isFinite(nextInstances[targetIndex].start) ? nextInstances[targetIndex].start : null,
          end: Number.isFinite(nextInstances[targetIndex].end) ? nextInstances[targetIndex].end : null,
        }),
        type: targetType,
      },
    };

    updated = {
      ...item,
      target: normalizeLangUnitTarget(nextInstances[targetIndex].target, contextType, {
        text: String(item.text ?? ''),
        start: Number.isFinite(instance?.start) ? instance.start : null,
        end: Number.isFinite(instance?.end) ? instance.end : null,
      }),
      instances: nextInstances,
      updatedAt: now,
    };
    return updated;
    });

    if (!updated) {
      return null;
    }

    await writeLangUnitItems(sortLangUnitItems(next));
    return { langUnit: updated, res: { contextType, targetType } };
  });
}

function collectChinDisambiguationJobs(langUnits, enabled) {
  if (!enabled) {
    return [];
  }

  const jobs = [];
  for (const langUnit of Array.isArray(langUnits) ? langUnits : []) {
    if (!langUnit || typeof langUnit !== 'object') {
      continue;
    }

    const instances = normalizeLangUnitInstances(langUnit.instances ?? []);
    for (const instance of instances) {
      const context = normalizeLangUnitContext(instance.context);
      const instanceTarget = normalizeLangUnitTarget(instance.target ?? langUnit.target ?? getLangUnitText(langUnit), context.type, {
        text: String(langUnit.text ?? ''),
        start: Number.isFinite(instance.start) ? instance.start : null,
        end: Number.isFinite(instance.end) ? instance.end : null,
      });
      const contextText = String(context.text ?? '').trim();
      const contextType = String(context.type ?? '').trim();
      const targetType = String(instanceTarget.type ?? '').trim();
      const targetText = String(instanceTarget.text || getLangUnitText(langUnit)).trim();
      const substringText = targetText;
      if (
        targetType === 'chinChar' ||
        (targetType === 'chinFuzz' && contextType === 'chinPhrase') ||
        (contextType === 'chinPhrase' && Array.from(contextText).length > 7) ||
        !isChineseDisambiguationCandidate(contextText, targetText, substringText)
      ) {
        continue;
      }

      jobs.push({
        jobId: randomUUID(),
        langUnitId: langUnit._id,
        context: contextText,
        target: targetText,
        substring: substringText,
        instance: {
          audSegId: instance.audSegId,
          subSegId: instance.subSegId,
          cycleGroupId: instance.cycleGroupId,
          start: instance.start,
          end: instance.end,
        },
        expectedContextText: contextText,
        expectedContextType: contextType,
        expectedTargetText: targetText,
        expectedTargetType: targetType,
        enqueuedAt: new Date().toISOString(),
      });
    }
  }

  return jobs;
}

const chinDisambiguationQueue = [];
const chinDisambiguationQueuedKeys = new Set();
let chinDisambiguationDrainActive = false;
let chinDisambiguationRevision = 0;
let chinDisambiguationLastError = '';
const chinDisambiguationCompletions = [];

function getChinDisambiguationStatus(afterRevision = 0) {
  return {
    pending: chinDisambiguationQueue.length,
    active: chinDisambiguationDrainActive,
    revision: chinDisambiguationRevision,
    lastError: chinDisambiguationLastError,
    completions: chinDisambiguationCompletions.filter((completion) => completion.revision > afterRevision),
  };
}

function getChinDisambiguationJobKey(job) {
  return JSON.stringify([
    job?.langUnitId,
    job?.instance?.audSegId,
    job?.instance?.subSegId,
    job?.instance?.cycleGroupId,
    job?.instance?.start,
    job?.instance?.end,
    job?.expectedContextText,
    job?.expectedContextType,
    job?.expectedTargetText,
    job?.expectedTargetType,
  ]);
}

async function drainChinDisambiguationQueue() {
  if (chinDisambiguationDrainActive) {
    return;
  }

  chinDisambiguationDrainActive = true;
  try {
    while (chinDisambiguationQueue.length) {
      const job = chinDisambiguationQueue.shift();
      if (!job) {
        continue;
      }

      try {
        const result = await inferLangUnitChineseTypes(job.langUnitId, {
          ...job,
          requireInstanceMatch: true,
        });
        if (result?.langUnit) {
          await rebuildLangUnitItems();
        }
        chinDisambiguationLastError = '';
      } catch (error) {
        chinDisambiguationLastError = String(error?.message ?? error ?? 'chin disambiguation failed');
        console.error(`[chin-disambiguation] ${chinDisambiguationLastError}`);
      } finally {
        chinDisambiguationQueuedKeys.delete(getChinDisambiguationJobKey(job));
        chinDisambiguationRevision += 1;
        chinDisambiguationCompletions.push({
          revision: chinDisambiguationRevision,
          jobId: job.jobId,
          langUnitId: job.langUnitId,
          subSegId: job.instance?.subSegId ?? '',
          target: job.target,
          context: job.context,
          error: chinDisambiguationLastError,
        });
        if (chinDisambiguationCompletions.length > 100) {
          chinDisambiguationCompletions.shift();
        }
      }
    }
  } finally {
    chinDisambiguationDrainActive = false;
  }
}

function enqueueChinDisambiguationJobs(jobs) {
  const queuedJobs = (Array.isArray(jobs) ? jobs : []).filter((job) => {
    const key = getChinDisambiguationJobKey(job);
    if (chinDisambiguationQueuedKeys.has(key)) {
      return false;
    }

    chinDisambiguationQueuedKeys.add(key);
    return true;
  });
  if (!queuedJobs.length) {
    return { queued: 0, queueId: '', queueStartRevision: chinDisambiguationRevision };
  }

  const queueId = randomUUID();
  const queueStartRevision = chinDisambiguationRevision;
  chinDisambiguationQueue.push(...queuedJobs.map((job) => ({ ...job, queueId })));
  setImmediate(() => void drainChinDisambiguationQueue());
  return { queued: queuedJobs.length, queueId, queueStartRevision };
}

let codexWorkerPool = null;

function workerLog(slot, message, generation = slot.generation) {
  process.stderr.write(`[codex-worker][${slot.slotId}][generation=${generation}] ${message}\n`);
}

function workerFailure(slot, message, cause = null) {
  const error = new Error(message);
  error.workerFailure = true;
  error.slotId = slot.slotId;
  error.generation = slot.generation;
  error.cause = cause;
  return error;
}

function killWorkerTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function createWorkerSlot(slotId) {
  return {
    slotId,
    generation: 0,
    child: null,
    stdout: null,
    stderr: null,
    pending: [],
    requestQueue: Promise.resolve(),
    primePromise: Promise.resolve(false),
    primeComplete: false,
    state: 'closed',
    lastError: null,
    lastExit: null,
    repairPromise: null,
    repairAttempt: 0,
  };
}

function rejectWorkerPending(slot, error) {
  while (slot.pending.length) {
    slot.pending.shift()?.reject(error);
  }
}

function spawnWorkerSlot(slot, repairing = false) {
  const generation = slot.generation + 1;
  slot.generation = generation;
  slot.state = repairing ? 'repairing' : 'starting';
  slot.primeComplete = false;
  slot.lastError = null;
  const child = spawn(process.execPath, [process.env.CODEX_WORKER_ENTRY || codexWorkerEntry], {
    cwd: codexWorkerDir,
    env: {
      ...process.env,
      CODEX_WORKER_STREAMED: '1',
      CODEX_WORKER_SLOT: slot.slotId,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  slot.child = child;
  slot.stdout = createInterface({ input: child.stdout });
  slot.stderr = createInterface({ input: child.stderr });
  workerLog(slot, 'spawned');

  slot.primePromise = new Promise((resolve) => {
    let done = false;
    const finish = (ready) => {
      if (done || slot.generation !== generation) return;
      done = true;
      slot.primeComplete = ready;
      if (ready) {
        slot.state = 'ready';
        slot.repairAttempt = 0;
        workerLog(slot, 'primed', generation);
      }
      resolve(ready);
    };
    slot.stderr.on('line', (line) => {
      process.stderr.write(`${line}\n`);
      if (line.includes('[codex-worker] ready')) finish(true);
    });
    child.once('error', (error) => {
      if (slot.generation !== generation) return;
      slot.lastError = workerFailure(slot, `worker spawn failed: ${error.message}`, error);
      finish(false);
    });
    child.once('exit', (code, signal) => {
      if (slot.generation !== generation) return;
      slot.lastExit = { code, signal, at: new Date().toISOString() };
      const error = workerFailure(slot, `worker exited code=${code} signal=${signal ?? 'none'}`);
      slot.lastError = error;
      if (codexWorkerPool) {
        codexWorkerPool.lastFailure = {
          at: slot.lastExit.at,
          slotId: slot.slotId,
          generation,
          error: error.message,
        };
      }
      workerLog(slot, `exited code=${code} signal=${signal ?? 'none'}`, generation);
      slot.state = 'failed';
      finish(false);
      rejectWorkerPending(slot, error);
      slot.stdout?.close();
      slot.stderr?.close();
    });
  });

  slot.stdout.on('line', (line) => {
    if (slot.generation !== generation) return;
    const entry = slot.pending.shift();
    if (!entry) return;
    try {
      entry.resolve(JSON.parse(line));
    } catch (error) {
      entry.reject(workerFailure(slot, `invalid worker response: ${error.message}`, error));
    }
  });
  return slot;
}

async function repairWorkerSlot(slot) {
  if (slot.repairPromise) return slot.repairPromise;
  slot.repairPromise = (async () => {
    let delay = codexWorkerRepairBaseMs;
    while (slot.state !== 'closed') {
      if (slot.child?.pid) killWorkerTree(slot.child);
      slot.stdout?.close();
      slot.stderr?.close();
      slot.repairAttempt += 1;
      spawnWorkerSlot(slot, true);
      if (await slot.primePromise) {
        if (codexWorkerPool && !codexWorkerPool.activeSlot.primeComplete) {
          codexWorkerPool.activeSlot = slot;
        }
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, codexWorkerRepairMaxMs);
    }
    return false;
  })().finally(() => {
    slot.repairPromise = null;
  });
  return slot.repairPromise;
}

function startWorkerPool() {
  if (codexWorkerPool) return codexWorkerPool;
  const active = createWorkerSlot('active');
  const standby = createWorkerSlot('standby');
  codexWorkerPool = {
    activeSlot: active,
    slots: [active, standby],
    requestQueue: Promise.resolve(),
    failoverPromise: null,
    lastFailure: null,
    lastAttempt: null,
  };
  spawnWorkerSlot(active);
  spawnWorkerSlot(standby);
  void standby.primePromise.then((ready) => {
    if (!ready && standby.state !== 'closed') void repairWorkerSlot(standby);
  });
  void active.primePromise.then((ready) => {
    if (!ready && active.state !== 'closed') {
      void repairWorkerSlot(active);
      if (standby.primeComplete) codexWorkerPool.activeSlot = standby;
    }
  });
  return codexWorkerPool;
}

async function waitForReadyWorker(pool) {
  const deadline = Date.now() + codexWorkerNoReadyWaitMs;
  while (Date.now() < deadline) {
    const ready = pool.slots.find((slot) => slot.primeComplete && slot.state === 'ready');
    if (ready) {
      pool.activeSlot = ready;
      return ready;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

function getCodexWorkerClient() {
  return startWorkerPool();
}

function requestWorkerSlot(slot, payload, attempt, logicalRequestId, pool = null) {
  const job = slot.requestQueue.then(async () => {
    if (slot.state !== 'ready' && slot.state !== 'busy') {
      throw slot.lastError || workerFailure(slot, `worker ${slot.slotId} is ${slot.state}`);
    }
    await slot.primePromise;
    if (!slot.child?.stdin.writable) throw workerFailure(slot, 'worker stdin is closed');
    slot.state = 'busy';
    pool && (pool.lastAttempt = {
      id: logicalRequestId,
      attempt,
      slotId: slot.slotId,
      generation: slot.generation,
    });
    workerLog(slot, `request-start id=${logicalRequestId} attempt=${attempt}`);
    try {
      return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (handler, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          handler(value);
        };
        const timer = setTimeout(() => {
          const error = workerFailure(slot, `request timed out after ${codexWorkerRequestTimeoutMs}ms`);
          finish(reject, error);
          killWorkerTree(slot.child);
        }, codexWorkerRequestTimeoutMs);
        slot.pending.push({
          resolve: (value) => finish(resolve, value),
          reject: (error) => finish(reject, error),
        });
        try {
          slot.child.stdin.write(`${JSON.stringify(payload)}\n`);
        } catch (error) {
          finish(reject, workerFailure(slot, `worker write failed: ${error.message}`, error));
        }
      });
    } finally {
      if (slot.state === 'busy') slot.state = 'ready';
    }
  });
  slot.requestQueue = job.then(() => undefined, () => undefined);
  return job;
}

async function failoverWorker(pool, failedSlot, payload, logicalRequestId, firstError) {
  if (pool.failoverPromise) return pool.failoverPromise;
  pool.failoverPromise = (async () => {
    pool.lastFailure = {
      at: new Date().toISOString(),
      slotId: failedSlot.slotId,
      generation: failedSlot.generation,
      error: firstError.message,
    };
    failedSlot.state = 'failed';
    const standby = pool.slots.find((slot) => slot !== failedSlot && slot.primeComplete && slot.state === 'ready');
    if (!standby) {
      void repairWorkerSlot(failedSlot);
      const other = pool.slots.find((slot) => slot !== failedSlot);
      if (other && other.state !== 'ready') void repairWorkerSlot(other);
      throw workerFailure(failedSlot, `both worker slots unavailable: ${firstError.message}`);
    }
    pool.activeSlot = standby;
    workerLog(standby, `promoted from ${failedSlot.slotId}`);
    void repairWorkerSlot(failedSlot);
    try {
      return await requestWorkerSlot(standby, payload, 2, logicalRequestId, pool);
    } catch (secondError) {
      pool.lastFailure = {
        ...pool.lastFailure,
        second: secondError.message,
        secondSlotId: standby.slotId,
        secondGeneration: standby.generation,
      };
      standby.state = 'failed';
      void repairWorkerSlot(standby);
      throw workerFailure(standby, `active and standby failed: ${firstError.message}; ${secondError.message}`);
    }
  })().finally(() => {
    pool.failoverPromise = null;
  });
  return pool.failoverPromise;
}

async function requestCodexWorker(payload) {
  const pool = getCodexWorkerClient();
  const logicalRequestId = payload?.jobId || randomUUID();
  const job = pool.requestQueue.then(async () => {
    await waitForReadyWorker(pool);
    let slot = pool.activeSlot;
    try {
      return await requestWorkerSlot(slot, payload, 1, logicalRequestId, pool);
    } catch (error) {
      if (!error?.workerFailure) throw error;
      return failoverWorker(pool, slot, payload, logicalRequestId, error);
    }
  });
  pool.requestQueue = job.then(() => undefined, () => undefined);
  return job;
}

async function waitForCodexWorkerPrimeComplete() {
  const pool = getCodexWorkerClient();
  await pool.slots[0].primePromise;
  return pool.activeSlot.primeComplete;
}

async function inferLangUnitRoot(langUnitId, payload) {
  const result = await requestCodexWorker({ task: 'root', ...payload });
  const root = String(result?.res ?? '').trim();
  if (!root) {
    return null;
  }

  return runLangUnitMutation(async () => {
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
  });
}

process.once('exit', () => {
  for (const slot of codexWorkerPool?.slots ?? []) {
    slot.state = 'closed';
    killWorkerTree(slot.child);
  }
});

async function handleCodexWorkerApi(req, res, url) {
  if (req.method !== 'GET' || url.pathname !== '/api/codex-worker/status') {
    return false;
  }

  await waitForCodexWorkerPrimeComplete();
  const pool = getCodexWorkerClient();
  const describe = (slot) => ({
    slotId: slot.slotId,
    state: slot.state,
    generation: slot.generation,
    primeComplete: slot.primeComplete,
    lastError: slot.lastError?.message ?? null,
    lastExit: slot.lastExit,
  });
  send(
    res,
    200,
    { 'Content-Type': 'application/json; charset=utf-8' },
    JSON.stringify({
      primeComplete: pool.activeSlot.primeComplete,
      active: describe(pool.activeSlot),
      standby: describe(pool.slots.find((slot) => slot !== pool.activeSlot)),
      repairing: pool.slots.some((slot) => slot.state === 'repairing'),
      attempt: pool.lastAttempt,
      lastFailure: pool.lastFailure,
    })
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

  const grouped = new Map();
  for (const item of normalized) {
    const grpId = String(item?.grpId ?? '').trim();
    if (!grpId) {
      continue;
    }

    if (!grouped.has(grpId)) {
      grouped.set(grpId, []);
    }
    grouped.get(grpId).push(item);
  }

  for (const [grpId, members] of grouped) {
    const audEpIds = new Set(members.map((item) => String(item?.audEpId ?? '').trim()));
    const parentIndex = Number(members[0]?.audEpIndex);
    const sameParent = audEpIds.size === 1 && members.every((item) => Number(item?.audEpIndex) === parentIndex);
    const ordered = normalized
      .filter((item) => String(item?.audEpId ?? '').trim() === String(members[0]?.audEpId ?? '').trim())
      .slice()
      .sort((a, b) => Number(a?.tcs ?? 0) - Number(b?.tcs ?? 0) || String(a?._id ?? '').localeCompare(String(b?._id ?? '')));
    const indexes = members.map((item) => ordered.findIndex((candidate) => candidate?._id === item?._id)).sort((a, b) => a - b);
    const contiguous = indexes.length >= 2 && indexes.every((index, position) => index === indexes[0] + position);
    if (sameParent && contiguous) {
      continue;
    }

    for (const item of members) {
      if (Object.prototype.hasOwnProperty.call(item, 'grpId')) {
        delete item.grpId;
        changed = true;
      }
    }
  }

  return [normalized, changed];
}

function getAudSegGroups(items, audEpId = '') {
  const parentId = String(audEpId ?? '').trim();
  const ordered = items
    .filter((item) => !parentId || String(item?.audEpId ?? '').trim() === parentId)
    .slice()
    .sort((a, b) => Number(a?.tcs ?? 0) - Number(b?.tcs ?? 0) || String(a?._id ?? '').localeCompare(String(b?._id ?? '')));
  const groups = new Map();
  for (const item of ordered) {
    const grpId = String(item?.grpId ?? '').trim();
    if (!grpId) {
      continue;
    }
    if (!groups.has(grpId)) {
      groups.set(grpId, []);
    }
    groups.get(grpId).push(item);
  }

  return [...groups.entries()]
    .map(([grpId, members]) => {
      const indexes = members.map((member) => ordered.findIndex((item) => item?._id === member?._id)).sort((a, b) => a - b);
      const contiguous = indexes.length >= 2 && indexes.every((index, position) => index === indexes[0] + position);
      return contiguous
        ? {
            grpId,
            members,
            startIndex: indexes[0],
            endIndex: indexes[indexes.length - 1],
            tcs: Math.min(...members.map((item) => Number(item?.tcs ?? 0))),
            tce: Math.max(...members.map((item) => Number(item?.tce ?? item?.tcs ?? 0))),
          }
        : null;
    })
    .filter(Boolean);
}

function getNextAudSegGroupId(items, audEpId) {
  const prefix = `${String(audEpId ?? '').trim()}-grp-`;
  let ordinal = 0;
  for (const item of items) {
    const grpId = String(item?.grpId ?? '');
    if (!grpId.startsWith(prefix)) {
      continue;
    }
    const value = Number(grpId.slice(prefix.length));
    if (Number.isInteger(value) && value >= ordinal) {
      ordinal = value + 1;
    }
  }
  return `${prefix}${ordinal}`;
}

async function readSubSegItems() {
  return readJsonArray(subSegItemsFile, 'subSegs');
}

async function writeSubSegItems(items) {
  await atomicWriteJsonFile(subSegDir, subSegItemsFile, Array.isArray(items) ? items : []);
}

function sortSubSegItems(items) {
  return items.slice().sort((a, b) => {
    const audSegA = String(a?.audSegId ?? '');
    const audSegB = String(b?.audSegId ?? '');
    if (audSegA !== audSegB) {
      return audSegA.localeCompare(audSegB);
    }

    const rootA = a?.isRoot !== false;
    const rootB = b?.isRoot !== false;
    if (rootA !== rootB) {
      return rootA ? -1 : 1;
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

    const ordinalA = Number(a?.audSegOrdinal ?? Number.MAX_SAFE_INTEGER);
    const ordinalB = Number(b?.audSegOrdinal ?? Number.MAX_SAFE_INTEGER);
    if (ordinalA !== ordinalB) {
      return ordinalA - ordinalB;
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
    items.splice(insertIndex, 0, { _id: randomUUID(), label: '', media: [] });
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
    const audEpId = String(payload.audEpId ?? '').trim();
    const audSegOrdinal = Number(payload.audSegOrdinal ?? Number.NaN);
    const tcs = Number(payload.tcs ?? 0);
    const tce = payload.tce === '' || payload.tce == null ? '' : Number(payload.tce);
    const ssHead = String(payload.ssHead ?? '');
    if (!Number.isInteger(audEpIndex)) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'audEpIndex is required' }));
      return true;
    }

    const audEpItems = await readAudEpItems();
    const parentAudEpId = audEpId || String(audEpItems[audEpIndex]?._id ?? '').trim();
    if (!parentAudEpId) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'audEpId is required' }));
      return true;
    }

    const items = await readAudSegItems();
    const existing = items.find((item) => item?._id === `${parentAudEpId}-${audSegOrdinal}`);
    const candidates = getAudSegGroups(items, parentAudEpId).filter((group) => (
      Number.isFinite(tcs) &&
      Number.isFinite(tce) &&
      tcs >= group.tcs &&
      tce <= group.tce
    ));
    const nextOrdinal = Number.isInteger(audSegOrdinal)
      ? audSegOrdinal
      : items.reduce((max, item) => {
        if (String(item?.audEpId ?? '') !== parentAudEpId) {
          return max;
        }

        const suffix = String(item?._id ?? '');
        const prefix = `${parentAudEpId}-`;
        if (!suffix.startsWith(prefix)) {
          return max;
        }

        const ordinal = Number(suffix.slice(prefix.length));
        return Number.isInteger(ordinal) && ordinal > max ? ordinal : max;
      }, -1) + 1;
    const itemId = `${parentAudEpId}-${nextOrdinal}`;
    const index = items.findIndex((item) => item?._id === itemId);
    const item = {
      _id: itemId,
      audEpId: parentAudEpId,
      audEpIndex,
      tcs,
      tce,
      ssHead,
      ...(String(existing?.grpId ?? '').trim()
        ? { grpId: String(existing.grpId).trim() }
        : candidates.length === 1 && !existing ? { grpId: candidates[0].grpId } : {}),
    };
    if (index >= 0) {
      items[index] = item;
    } else {
      items.push(item);
    }
    await writeAudSegItems(sortAudSegItems(items));
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(item));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/audSegs/groups') {
    let payload = {};
    try {
      payload = JSON.parse(await readBody(req) || '{}');
    } catch {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'invalid JSON' }));
      return true;
    }

    const action = String(payload.action ?? 'capture').trim();
    const audEpId = String(payload.audEpId ?? '').trim();
    const audSegIds = Array.isArray(payload.audSegIds)
      ? [...new Set(payload.audSegIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
      : [];
    const requestedGrpId = String(payload.grpId ?? '').trim();
    const items = await readAudSegItems();
    if (!audEpId) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'audEpId is required' }));
      return true;
    }

    if (action === 'ungroup') {
      if (!requestedGrpId) {
        send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'grpId is required' }));
        return true;
      }

      for (const item of items) {
        if (String(item?.audEpId ?? '').trim() === audEpId && String(item?.grpId ?? '').trim() === requestedGrpId) {
          delete item.grpId;
        }
      }
      await writeAudSegItems(sortAudSegItems(items));
      send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ grpId: requestedGrpId, items: sortAudSegItems(items) }));
      return true;
    }

    if (audSegIds.length < 2) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'at least two audSegIds are required' }));
      return true;
    }

    const selected = audSegIds.map((id) => items.find((item) => item?._id === id));
    const selectedIndexes = selected.map((item) => items
      .filter((candidate) => String(candidate?.audEpId ?? '').trim() === audEpId)
      .slice()
      .sort((a, b) => Number(a?.tcs ?? 0) - Number(b?.tcs ?? 0) || String(a?._id ?? '').localeCompare(String(b?._id ?? '')))
      .findIndex((candidate) => candidate?._id === item?._id));
    const orderedIndexes = selectedIndexes.slice().sort((a, b) => a - b);
    const validSelection = selected.every(Boolean) &&
      selected.every((item) => String(item?.audEpId ?? '').trim() === audEpId) &&
      orderedIndexes.every((index, position) => index === orderedIndexes[0] + position);
    if (!validSelection) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'audSegIds must be contiguous members of one audEp' }));
      return true;
    }

    const conflicts = new Set(selected.map((item) => String(item?.grpId ?? '').trim()).filter((grpId) => grpId && grpId !== requestedGrpId));
    if (conflicts.size) {
      send(res, 409, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'selection overlaps another group' }));
      return true;
    }

    const grpId = requestedGrpId || getNextAudSegGroupId(items, audEpId);
    for (const item of items) {
      if (String(item?.audEpId ?? '').trim() === audEpId && String(item?.grpId ?? '').trim() === grpId) {
        delete item.grpId;
      }
    }
    for (const item of selected) {
      item.grpId = grpId;
    }

    await writeAudSegItems(sortAudSegItems(items));
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ grpId, items: sortAudSegItems(items) }));
    return true;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/audSegs/items/')) {
    const audSegId = decodeURIComponent(url.pathname.slice('/api/audSegs/items/'.length)).trim();
    if (!audSegId) {
      send(res, 404, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'item not found' }));
      return true;
    }

    const items = await readAudSegItems();
    const index = items.findIndex((item) => item?._id === audSegId);
    if (index < 0) {
      send(res, 404, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'item not found' }));
      return true;
    }

    items.splice(index, 1);
    await writeAudSegItems(sortAudSegItems(items));

    const subSegItems = await readSubSegItems();
    await writeSubSegItems(
      sortSubSegItems(subSegItems.filter((item) => item?.audSegId !== audSegId))
    );
    await rebuildLangUnitItems();

    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ deletedId: audSegId }));
    return true;
  }

  return false;
}

async function handleLangUnitApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/langUnits/disambiguation-status') {
    const afterRevision = Number(url.searchParams.get('afterRevision') ?? 0);
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(
      getChinDisambiguationStatus(Number.isFinite(afterRevision) ? afterRevision : 0)
    ));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/langUnits/items') {
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(await rebuildLangUnitItems()));
    return true;
  }

  if (req.method === 'POST') {
    const match = /^\/api\/langUnits\/items\/([^/]+)\/status$/.exec(url.pathname);
    if (match) {
      let payload = {};
      try {
        payload = JSON.parse(await readBody(req) || '{}');
      } catch {
        send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'invalid JSON' }));
        return true;
      }

      const status = String(payload.status ?? '').trim();
      if (!['default', 'done'].includes(status)) {
        send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'status must be default or done' }));
        return true;
      }

      const langUnitId = decodeURIComponent(match[1] || '').trim();
      const updated = await runLangUnitMutation(async () => {
        const items = await readLangUnitItems();
        const index = items.findIndex((item) => String(item?._id ?? '') === langUnitId);
        if (index < 0) {
          return null;
        }

        const current = items[index];
        const next = {
          ...current,
          status,
          statusRevision: (Number(current.statusRevision) || 0) + 1,
          statusUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        items[index] = next;
        await writeLangUnitItems(sortLangUnitItems(items));
        return next;
      });

      if (!updated) {
        send(res, 404, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'langUnit not found' }));
        return true;
      }

      send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(updated));
      return true;
    }
  }

  if (req.method === 'DELETE' && url.pathname === '/api/langUnits/items') {
    const subSegItems = await readSubSegItems();
    const langUnitItems = await readLangUnitItems();
    const langUnitsById = new Map(langUnitItems.map((item) => [String(item?._id ?? ''), item]));
    const nextSubSegItems = [];

    for (const item of Array.isArray(subSegItems) ? subSegItems : []) {
      if (!item || typeof item !== 'object') {
        nextSubSegItems.push(item);
        continue;
      }

      const content = Array.isArray(item.content) ? item.content : null;
      if (!content) {
        nextSubSegItems.push(item);
        continue;
      }

      const [nextContent, contentChanged] = rewriteSubSegContentWithoutLangUnits(content, langUnitsById);
      const nextText = nextContent
        .map((token) => (token?.type === 'text' ? String(token.text ?? '') : ''))
        .join('');

      if (!contentChanged) {
        nextSubSegItems.push(item);
        continue;
      }

      nextSubSegItems.push({
        ...item,
        content: nextContent,
        text: nextText,
        updatedAt: new Date().toISOString(),
      });
    }

    await writeSubSegItems(sortSubSegItems(nextSubSegItems));
    await writeLangUnitItems([]);
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ langUnits: [] }));
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

  if (req.method === 'DELETE' && url.pathname === '/api/subSegs/items') {
    let payload = {};
    try {
      payload = JSON.parse(await readBody(req) || '{}');
    } catch {
      payload = {};
    }

    const subSegId = String(payload.subSegId ?? '').trim();
    if (!subSegId) {
      await writeSubSegItems([]);
      await rebuildLangUnitItems();
      send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ subSegs: [] }));
      return true;
    }

    const subSegItems = await readSubSegItems();
    await writeSubSegItems(sortSubSegItems(subSegItems.filter((item) => String(item?._id ?? '') !== subSegId)));
    await rebuildLangUnitItems();
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ deletedId: subSegId }));
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

    const subSegId = String(payload.subSegId ?? '').trim();
    const audSegId = String(payload.audSegId ?? '').trim();
    const content = Array.isArray(payload.content) ? payload.content : null;
    const text = String(payload.text ?? '');
    const isRoot = payload.isRoot !== false;
    const linkTargetLangUnitId = String(payload.linkTargetLangUnitId ?? '').trim();
    const parentSubSegId = String(payload.parentSubSegId ?? '').trim();
    const disambiguateChinContexts = payload.disambiguateChinContexts === true;
    if (!subSegId && !audSegId) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'subSegId or audSegId is required' }));
      return true;
    }

    const items = await readSubSegItems();
    const index = subSegId
      ? items.findIndex((item) => String(item?._id ?? '') === subSegId)
      : items.findIndex((item) => item?.audSegId === audSegId && item?.isRoot !== false);
    const [normalizedContent] = normalizeSubSegContentForStorage(content ?? []);
    const nextSubSegId = subSegId || `${audSegId}-${isRoot ? 0 : 1}`;
    const keepEmpty = isRoot === false;
    if (((content && !content.length) || (!content && !text.trim())) && !keepEmpty) {
      if (index >= 0) {
        items.splice(index, 1);
        await writeSubSegItems(sortSubSegItems(items));
      }

      await rebuildLangUnitItems();
      send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(null));
      return true;
    }

    const existingLinkTargetLangUnitId = index >= 0 ? String(items[index]?.linkTargetLangUnitId ?? '').trim() : '';
    const savedLinkTargetLangUnitId = linkTargetLangUnitId || (isRoot === false ? existingLinkTargetLangUnitId : '');
    const existingParentSubSegId = index >= 0 ? String(items[index]?.parentSubSegId ?? '').trim() : '';
    const savedParentSubSegId = parentSubSegId || (isRoot === false ? existingParentSubSegId || getSubSegIdFromDerivedLangUnitId(savedLinkTargetLangUnitId) : '');
    const savedAudSegId = index >= 0 && isRoot === false ? String(items[index]?.audSegId ?? audSegId) : audSegId;
    if (isRoot === false && !savedLinkTargetLangUnitId) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'linkTargetLangUnitId is required for non-root subSeg' }));
      return true;
    }

    const saved = {
      _id: index >= 0 ? items[index]._id : nextSubSegId,
      audSegId: savedAudSegId,
      isRoot,
      ...(savedLinkTargetLangUnitId ? { linkTargetLangUnitId: savedLinkTargetLangUnitId } : {}),
      ...(savedParentSubSegId ? { parentSubSegId: savedParentSubSegId } : {}),
      ...(Array.isArray(normalizedContent) ? { content: normalizedContent } : {}),
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
    if (Array.isArray(payload.langUnits) && payload.langUnits.length) {
      await writeLangUnitItems(mergeLangUnitItems(await readLangUnitItems(), payload.langUnits));
    }
    let updatedLangUnits = await rebuildLangUnitItems();
    const [hydratedSubSegItems, hydratedSubSegChanged] = hydrateEmptyLinkedSubSegs(await readSubSegItems(), updatedLangUnits);
    if (hydratedSubSegChanged) {
      await writeSubSegItems(sortSubSegItems(hydratedSubSegItems));
      updatedLangUnits = await rebuildLangUnitItems();
    }
    const chinDisambiguation = disambiguateChinContexts
      ? enqueueChinDisambiguationJobs(collectChinDisambiguationJobs(payload.langUnits, true))
      : null;
    const refreshedSubSegItems = await readSubSegItems();
    const refreshedSubSeg = refreshedSubSegItems.find((item) => String(item?._id ?? '') === saved._id) ?? saved;
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({
      subSeg: refreshedSubSeg,
      subSegs: refreshedSubSegItems,
      langUnits: updatedLangUnits,
      ...(chinDisambiguation ? { chinDisambiguation } : {}),
    }));
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

async function handleHttpRequest(req, res, vite = null, fromDist = false) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/notes' && (await handleNotesApi(req, res))) {
      return;
    }

    if (url.pathname.startsWith('/api/timeTracking/') && (await handleTimeTrackingApi(req, res, url))) {
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
      await serveIndex(res, vite, url.pathname, fromDist);
      return;
    }

    if (vite) {
      vite.middlewares(req, res, () => {
        send(res, 404, {}, 'Not found');
      });
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
  } catch (error) {
    console.error('[request]', error);
    if (!res.headersSent) {
      send(res, 500, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'request failed' }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

async function createApp() {
  startWorkerPool();
  if (isDev) {
    const vite = await createViteServer({
      appType: 'custom',
      server: { middlewareMode: true },
    });

    const server = http.createServer((req, res) => {
      void handleHttpRequest(req, res, vite);
    });

    server.listen(port, () => {
      console.log(`http://localhost:${port}`);
    });

    return;
  }

  const server = http.createServer((req, res) => {
    void handleHttpRequest(req, res, null, true);
  });

  server.listen(port, () => {
    console.log(`http://localhost:${port}`);
  });
}

createApp();
