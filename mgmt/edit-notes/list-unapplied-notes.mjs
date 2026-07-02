import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(dir, 'notes.json');

const raw = await readFile(sourcePath, 'utf8');
const notesBySelector = JSON.parse(raw);

const filtered = Object.fromEntries(
  Object.entries(notesBySelector)
    .map(([selector, entry]) => [
      selector,
      {
        ...entry,
        notes: (entry.notes ?? []).filter((note) => !note.applied),
      },
    ])
    .filter(([, entry]) => entry.notes.length > 0),
);

process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
