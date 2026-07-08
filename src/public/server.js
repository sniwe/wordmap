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
    const items = JSON.parse(await fs.readFile(langUnitItemsFile, 'utf8'));
    const [normalized] = normalizeLangUnitItemsForStorage(Array.isArray(items) ? items : []);
    const changed = JSON.stringify(normalized) !== JSON.stringify(Array.isArray(items) ? items : []);
    if (changed) {
      await writeLangUnitItems(normalized);
    }

    return normalized;
  } catch {
    return [];
  }
}

async function writeLangUnitItems(items) {
  await fs.mkdir(langUnitDir, { recursive: true });
  const [normalized] = normalizeLangUnitItemsForStorage(Array.isArray(items) ? items : []);
  await fs.writeFile(langUnitItemsFile, JSON.stringify(normalized, null, 2));
}

function normalizeLangUnitItem(item, now = new Date().toISOString()) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const _id = String(item._id ?? '').trim() || randomUUID();
  const instances = normalizeLangUnitInstances(item.instances ?? (item.context ? [{ context: item.context }] : []));
  const normalized = {
    ...item,
    _id,
    text: String(item.text ?? '').trim(),
    instances,
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
    if (token.remote === true) {
      nextToken.remote = true;
    }
    if (token.remote === true || Object.prototype.hasOwnProperty.call(token, 'text') || Object.keys(token).length !== Object.keys(nextToken).length) {
      changed = true;
    }
    normalized.push(nextToken);
  }

  return [normalized, changed];
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

    const text = String(token.text ?? langUnitsById.get(langUnitId)?.text ?? '');
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

      const langUnitText = String(langUnitsById.get(langUnitId)?.text ?? '');
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
        ...(String(existingInstance?.cycleGroupId ?? '').trim() ? { cycleGroupId: String(existingInstance.cycleGroupId).trim() } : {}),
        start,
        end,
      };
      instances.push(instance);
      pendingInstances.push(instance);
      instancesById.set(langUnitId, instances);
    }

    for (const instance of pendingInstances) {
      instance.context = normalizeLangUnitContext(getLangUnitBubbleContext(plainText, instance.start, instance.end));
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
      }
    }
  }

  return capturesById;
}

function normalizeLangUnitInstance(instance) {
  if (!instance || typeof instance !== 'object') {
    return null;
  }

  return {
    ...(String(instance.audSegId ?? '').trim() ? { audSegId: String(instance.audSegId).trim() } : {}),
    ...(String(instance.subSegId ?? '').trim() ? { subSegId: String(instance.subSegId).trim() } : {}),
    remote: instance.remote === true,
    ...(String(instance.cycleGroupId ?? '').trim() ? { cycleGroupId: String(instance.cycleGroupId).trim() } : {}),
    ...(Number.isFinite(instance.start) && instance.start >= 0 ? { start: instance.start } : {}),
    ...(Number.isFinite(instance.end) && instance.end >= 0 ? { end: instance.end } : {}),
    context: normalizeLangUnitContext(instance.context ?? instance),
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
    })),
  ]);
  const base = {
    ...existingBase,
    _id: parentId,
    text: String(primary.text ?? existingBase?.text ?? ''),
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

    const content = Array.isArray(item.content) ? item.content : null;
    if (!content) {
      normalized.push(item);
      continue;
    }

    let contentChanged = false;
    const nextContent = content.map((token) => {
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
    });

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

  let count = 0;
  let index = 0;
  while (index < value.length) {
    let matched = '';
    for (let end = value.length; end > index; end -= 1) {
      const chunk = value.slice(index, end);
      if (PINYIN_SYLLABLES.has(chunk)) {
        matched = chunk;
        break;
      }
    }

    if (!matched) {
      return 0;
    }

    count += 1;
    index += matched.length;
  }

  return count;
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
    hasChineseCharacters(substringText)
  );
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

function normalizeLangUnitItems(items, capturesById = new Map()) {
  const existingItemsByText = new Map(
    normalizeLangUnitItemsForStorage(flattenLangUnitItems(items))[0].map((item) => [String(item?.text ?? '').trim(), item])
  );
  const groupedByText = new Map();
  const textOrder = [];

  for (const [sourceId, captures] of capturesById.entries()) {
    const normalizedCaptures = normalizeLangUnitCaptures(captures);
    if (!normalizedCaptures.length) {
      continue;
    }

    const text = String(normalizedCaptures[0]?.text ?? '').trim();
    let group = groupedByText.get(text);
    if (!group) {
      group = {
        sourceIds: [],
        captures: [],
      };
      groupedByText.set(text, group);
      textOrder.push(text);
    }

    group.sourceIds.push(sourceId);
    group.captures.push(...normalizedCaptures);
  }

  const now = new Date().toISOString();
  const normalized = [];
  const idMap = new Map();

  for (const text of textOrder) {
    const group = groupedByText.get(text);
    const captures = normalizeLangUnitCaptures(group?.captures);
    if (!captures.length) {
      continue;
    }

    const existingItem = existingItemsByText.get(text);
    const canonicalId = String(existingItem?._id ?? group.sourceIds[0] ?? '').trim() || randomUUID();
    for (const sourceId of group.sourceIds) {
      const trimmed = String(sourceId ?? '').trim();
      if (trimmed && trimmed !== canonicalId) {
        idMap.set(trimmed, canonicalId);
      }
    }

    normalized.push({
      ...(existingItem ?? {}),
      _id: canonicalId,
      text,
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
      createdAt: existingItem?.createdAt || now,
      updatedAt: existingItem?.updatedAt || now,
    });
  }

  const merged = sortLangUnitItems(normalized);
  return [merged, idMap, JSON.stringify(merged) !== JSON.stringify(normalizeLangUnitItemsForStorage(flattenLangUnitItems(items))[0])];
}

async function rebuildLangUnitItems() {
  const subSegItems = await readSubSegItems();
  const [nextSubSegItems, subSegChanged] = normalizeSubSegItemsForStorage(subSegItems);
  if (subSegChanged) {
    await writeSubSegItems(sortSubSegItems(nextSubSegItems));
  }

  const langUnitItems = await readLangUnitItems();
  const instancesById = collectLangUnitInstancesById(nextSubSegItems, new Map(langUnitItems.map((item) => [String(item?._id ?? ''), item])));
  const [items, changed] = syncLangUnitInstances(langUnitItems, instancesById);
  if (changed) {
    await writeLangUnitItems(items);
  }

  return sortLangUnitItems(items);
}

async function requestCodexWorker(payload) {
  const worker = getCodexWorkerClient();
  return worker.request(payload);
}

async function inferLangUnitContextType(langUnitId, payload) {
  const result = await requestCodexWorker({ task: 'contextType', ...payload });
  const type = normalizeLangUnitContextType(result?.res);
  if (!type) {
    return null;
  }

  const items = await readLangUnitItems();
  const now = new Date().toISOString();
  let updated = null;
  const next = items.map((item) => {
    if (String(item?._id ?? '') !== String(langUnitId ?? '')) {
      return item;
    }

    const context = getLangUnitContext(item);
    if (context.type === type) {
      return item;
    }

    const nextInstances = normalizeLangUnitInstances(item.instances ?? (item.context ? [{ context: item.context }] : []));
    if (!nextInstances.length) {
      const nextItem = {
        ...item,
        instances: [{ context: { ...context, type } }],
        updatedAt: now,
      };
      updated = nextItem;
      return nextItem;
    }

    nextInstances[0] = {
      ...nextInstances[0],
      context: { ...context, type },
    };

    updated = {
      ...item,
      instances: nextInstances,
      updatedAt: now,
    };
    return updated;
  });

  if (!updated) {
    return null;
  }

  await writeLangUnitItems(sortLangUnitItems(next));
  return { langUnit: updated, res: type };
}

async function maybeDisambiguateLangUnitContexts(langUnits, enabled) {
  if (!enabled) {
    return langUnits;
  }

  const next = [...(Array.isArray(langUnits) ? langUnits : [])];
  let changed = false;

  for (let index = 0; index < next.length; index += 1) {
    const langUnit = next[index];
    if (!langUnit || typeof langUnit !== 'object') {
      continue;
    }

    const context = getLangUnitContext(langUnit);
    const targetText = String(getLangUnitText(langUnit)).trim();
    const substringText = targetText;
    if (context.type !== 'chinPhrase' || !isChineseDisambiguationCandidate(context.text, targetText, substringText)) {
      continue;
    }

    const result = await inferLangUnitContextType(langUnit._id, {
      context: context.text,
      target: targetText,
      substring: substringText,
    });

    if (!result?.langUnit) {
      continue;
    }

    next[index] = result.langUnit;
    changed = true;
  }

  return changed ? sortLangUnitItems(next) : langUnits;
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
  const result = await requestCodexWorker({ task: 'root', ...payload });
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
  if (req.method === 'GET' && url.pathname === '/api/langUnits/items') {
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(await rebuildLangUnitItems()));
    return true;
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
    await writeSubSegItems([]);
    await rebuildLangUnitItems();
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ subSegs: [] }));
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
    const disambiguateChinContexts = payload.disambiguateChinContexts === true;
    if (!audSegId) {
      send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: 'audSegId is required' }));
      return true;
    }

    const items = await readSubSegItems();
    const index = items.findIndex((item) => item?.audSegId === audSegId);
    const [normalizedContent] = normalizeSubSegContentForStorage(content ?? []);
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
    const updatedLangUnits = await rebuildLangUnitItems();
    const refreshedSubSegItems = await readSubSegItems();
    const refreshedSubSeg = refreshedSubSegItems.find((item) => String(item?.audSegId ?? '') === audSegId) ?? saved;
    if (disambiguateChinContexts) {
      void maybeDisambiguateLangUnitContexts(updatedLangUnits, true).catch((error) => {
        process.stderr.write(`[codex-worker] ${error.message}\n`);
      });
    }
    send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ subSeg: refreshedSubSeg, langUnits: updatedLangUnits }));
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
