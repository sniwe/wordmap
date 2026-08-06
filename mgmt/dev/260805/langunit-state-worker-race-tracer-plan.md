# langUnit state / Codex worker race tracer-bullet plan

Date: 2026-08-05

## Objective

Make `Ctrl+ArrowUp/Down` on a cycle-selected langUnit change only its marking state:

```text
default (grey) <-> working (light blue) <-> done (green)
```

The state must persist across save, rebuild, refresh, and worker completion. A state-only action must not enqueue unrelated chin-disambiguation work or allow an older worker snapshot to restore `done`.

## Current failure seam

- `src/main.js:cycleLangUnitStatus()` mutates status, then calls `syncSubSegEditorDraft()`.
- That schedules the ordinary subSeg save.
- `saveSubSeg()` sets `disambiguateChinContexts` based on any candidate in the payload, even when only status changed.
- `src/public/server.js` then calls `collectChinDisambiguationJobs(updatedLangUnits, true)`, which scans the full rebuilt langUnit set and queues many jobs.
- Worker completions and `refreshLangUnitsQuietly()` replace client langUnit state asynchronously.
- An older queued worker can write a stale langUnit snapshot after the status save and restore `done`.

Preserve the existing subSeg content, cycle-target, and line-break behavior. Status is metadata; it must not be encoded into subSeg text or content tokens.

## Phase 1 — Separate state-only save from content save

Add one explicit save intent to the existing save path:

```text
saveSubSeg(subSegId, { disambiguate: true | false })
```

For `cycleLangUnitStatus()`:

1. Update the canonical langUnit status in memory.
2. Update visible bubble data attributes in place.
3. Send the existing subSeg/langUnit payload with `disambiguate: false`.
4. Keep caret, selection, cycle target index, and line breaks untouched.

For ordinary text/context edits, retain current disambiguation behavior.

Tracer gate:

- Cycling status produces zero new chin worker jobs.
- The browser remains on the same input and target.
- `default`, `working`, and `done` are visibly reachable in both directions.

## Phase 2 — Persist canonical status without broad payload side effects

Keep the canonical-ID status mapping already added to `extractSubSegEditorPayload()`, but make the status update shape explicit and minimal.

Preferred vertical slice:

```text
POST /api/langUnits/items/:id/status
{ "status": "default|working|done" }
```

The endpoint should:

- validate the three allowed values;
- read the current canonical item immediately before writing;
- update only `status` and `updatedAt`;
- return the updated canonical item;
- avoid rebuilding subSegs and avoid disambiguation enqueueing.

Use this endpoint from `cycleLangUnitStatus()`. Retain the subSeg save fallback only if the endpoint fails, and keep that fallback disambiguation-free.

Tracer gate:

- A status change updates `langUnits/items.json` in the isolated runtime fixture.
- Re-fetching langUnits returns the new status.
- No subSeg content, `text`, token order, or `<br>` rendering changes.

## Phase 3 — Fence stale worker completions

Prevent an older worker job from overwriting newer langUnit metadata.

Use the existing queue revision/job metadata and add a status revision fence:

```text
langUnit.statusUpdatedAt / statusRevision
```

When a worker completion writes an item:

1. Read the latest persisted item.
2. Preserve its current `status` and status revision.
3. Apply only the worker-owned context/target fields.
4. Write the merged item.

Do not let worker results replace arbitrary newer fields from their captured snapshot. This fence must cover normal completion, retry completion, and late completion after a worker restart.

Tracer gate:

- Queue a worker job from a fixture where status is `done`.
- Change status to `working` before completion.
- Complete the old job.
- Final persisted and fetched status remains `working`.

## Phase 4 — Narrow disambiguation enqueue scope

Even after state-only saves bypass disambiguation, reduce accidental queue amplification for normal edits.

Change `collectChinDisambiguationJobs()` call sites so a save passes only langUnits whose relevant context/target changed, rather than the entire `updatedLangUnits` rebuild result.

Keep dedupe keys and existing expected-instance checks. Do not remove disambiguation for genuine text/context edits.

Tracer gate:

- Status-only save: zero jobs.
- One qualifying text/context edit: only its affected instance/job is queued.
- Repeated identical save: no duplicate pending job.
- Existing worker completion behavior remains intact.

## Phase 5 — Real runtime verifier and regression pass

Add a disposable verifier under `mgmt/dev/260805` using an isolated data copy and the real API. If browser automation is available, drive the actual contenteditable input; otherwise test the status handler/save payload and API path separately.

Required assertions:

1. `working -> done -> working -> default -> done` works with Ctrl+ArrowUp/Down semantics.
2. Status-only actions enqueue zero worker jobs.
3. Status persists after save, GET refresh, and langUnit rebuild.
4. A stale worker completion cannot restore an older status.
5. Cycle target selection remains active after status changes.
6. SubSeg text, `<br>` line breaks, content token order, and caret offsets remain unchanged.
7. Existing ordinary Chinese disambiguation still queues and completes.

Run:

```text
npm run build
git diff --check
powershell -NoProfile -ExecutionPolicy Bypass -File mgmt/dev/260805/verify-langunit-state-worker-race.ps1
```

The verifier must print observed before/after status values, queued-job counts, and final persisted status. Do not claim completion from build output alone.

## Suggested edit order for today

1. Phase 1: split state-only save intent and prove zero new worker jobs.
2. Phase 2: add the minimal canonical status endpoint and switch the keyboard path to it.
3. Phase 3: add latest-item merge fencing for worker writes.
4. Phase 4: narrow normal disambiguation enqueue scope.
5. Phase 5: run the isolated/runtime verifier, then manually check the live browser cycle path.

Each phase leaves a runnable tracer gate and should be committed only after its gate passes.
