const base = `http://localhost:${process.env.PORT || 3012}`;
const get = (path) => fetch(`${base}${path}`).then(async (response) => {
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
});
const post = (path, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then(async (response) => {
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
});

const langUnits = await get('/api/langUnits/items');
const item = langUnits.find(({ status }) => ['default', 'done'].includes(status));
if (!item) throw new Error('No persisted-status langUnit available');

const statusPath = `/api/langUnits/items/${encodeURIComponent(item._id)}/status`;
const oldStatus = item.status;
const beforeSubSegs = JSON.stringify(await get('/api/subSegs/items'));
const pendingBefore = (await get('/api/langUnits/disambiguation-status')).pending;
const seen = [];
for (const status of ['done', 'default', 'done', 'default', 'done']) {
  const updated = await post(statusPath, { status });
  if (updated.status !== status) throw new Error(`expected ${status}, got ${updated.status}`);
  seen.push(updated.status);
}

try {
  const after = (await get('/api/langUnits/items')).find(({ _id }) => _id === item._id);
  const pendingAfter = (await get('/api/langUnits/disambiguation-status')).pending;
  const afterSubSegs = JSON.stringify(await get('/api/subSegs/items'));
  if (after?.status !== 'done') throw new Error(`GET/rebuild lost status: ${after?.status}`);
  if (pendingAfter !== pendingBefore) throw new Error(`queue changed: ${pendingBefore} -> ${pendingAfter}`);
  if (afterSubSegs !== beforeSubSegs) throw new Error('subSeg content changed');
  console.log(JSON.stringify({ id: item._id, sequence: seen, pendingBefore, pendingAfter, fetchedStatus: after.status, statusRevision: after.statusRevision, subSegUnchanged: true }, null, 2));
} finally {
  await post(statusPath, { status: oldStatus });
}
