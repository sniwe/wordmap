# langUnits JSON Write Corruption Tracer Bullet Plan

## Symptom

`src/backend/data/langUnits/items.json` became invalid JSON. The valid array closes, then stale bytes remain:

```text
]7-19T07:25:46.962Z",
    "updatedAt": "2026-07-19T07:25:46.962Z"
  }
]
```

## Current Failure Shape

- `subSegs/items.json` parses.
- `langUnits/items.json` fails at line 114, column 2.
- The trailing bytes look like an older write suffix left after a newer shorter write.
- The Codex worker likely returns parsed envelopes; it is not directly writing raw collection JSON.

## Root Cause

Multiple async request paths can write `langUnits/items.json` with plain `fs.writeFile()` and no per-file serialization. The subSeg save route can write langUnits, rebuild them, and then run worker-backed disambiguation that writes again. Overlapping autosaves can interleave whole-file writes.

Secondary bug: `readLangUnitItems()` catches parse failure and returns `[]`, which can silently erase behavior and later overwrite good data.

## Vertical Tracer Bullet

1. Add a minimal per-file write queue in `src/public/server.js`.
   - Wrap only collection JSON writes first, starting with `writeLangUnitItems()`.
   - Keep it boring: module-level `let langUnitWriteQueue = Promise.resolve()`.

2. Make writes atomic.
   - Serialize normalized JSON to a string.
   - Write to `items.json.tmp`.
   - Rename tmp over `items.json`.
   - This prevents stale suffixes from surviving shorter writes.

3. Stop swallowing parse corruption as empty data.
   - Change `readLangUnitItems()` catch path to log the parse error and return the last good in-memory snapshot if available.
   - If no snapshot exists, throw so the request fails instead of treating the collection as empty.

4. Reduce same-request write count.
   - In `POST /api/subSegs/items`, avoid the separate payload langUnit write followed immediately by rebuild if possible.
   - Minimal version: keep behavior but rely on queue/atomic write first; optimize write count after verifying.

5. Add a small node self-check.
   - Simulate two overlapping `writeLangUnitItems()` calls with different output lengths.
   - Assert final file always parses and has no stale suffix.

6. Manual verification.
   - Repair current `langUnits/items.json`.
   - Enable chin disambiguation.
   - Trigger rapid subSeg autosaves on Chinese langUnit content.
   - Repeatedly run `node -e "JSON.parse(require('fs').readFileSync('src/backend/data/langUnits/items.json','utf8')); console.log('ok')"` and confirm no corruption.

## Risk

Atomic rename on Windows can fail if another process has the file open. If that happens, add a tiny retry around rename; do not add a database or broad storage abstraction for this tracer.
