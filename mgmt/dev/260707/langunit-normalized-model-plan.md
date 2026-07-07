# LangUnit Normalized Model Plan

## Goal

Rework the data model so `langUnit` owns the lexical unit data and `subSeg` stores only lightweight occurrence pointers. The app should keep all current behavior working after the update, including capture, save, reload, deletion, ref badges, ref jumping, and chin disambiguation.

This is a vertical tracer bullet plan: each phase should land one thin end-to-end slice that can be exercised in the live app before moving to the next slice.

## Current Problem

Today the model duplicates too much information across `subSeg.content` and `langUnits.items`.

The current implementation:

- stores visible bubble text inside `subSeg.content[].langUnitRef`
- uses `langUnit.text` as a lookup key in the editor
- rebuilds `langUnit` records from `subSeg` captures
- also carries reverse-link data on `langUnit.instances`

That makes it possible for `subSeg` to drift into identity-like behavior even though `langUnit` should be the source of truth.

## Target Model

Use the following ownership split:

- `langUnit`
  - owns `text`
  - owns `root`
  - owns reverse-link metadata such as `instances`
  - owns context-bearing `instances`
  - is the canonical identity for a lexical unit
- `subSeg`
  - owns occurrence order and editor payload
  - stores only pointer refs to `langUnit`
  - does not own canonical lexical text

Expected ref shape:

- `{ type: 'langUnitRef', langUnitId, remote? }`

Optional renderer-only data may exist temporarily during migration, but the end state should not require `subSeg` to persist the lexical text.

## Non-Negotiables

- Preserve current editor usability.
- Preserve save and reload.
- Preserve delete flows.
- Preserve ref count and ref list UI.
- Preserve codex worker root inference.
- Preserve chin disambiguation.
- Avoid a big-bang rewrite.
- Keep each phase runnable on its own.

## Phase 0: Freeze The Contract

Goal: define the final ownership rules before touching behavior.

Work:

- Write down the final data contract for `langUnit` and `subSeg`.
- Confirm whether `subSeg.content` should keep `remote` during the transition.
- Confirm whether any temporary migration-only field is needed for backward compatibility.
- Decide the exact meaning of “existing `langUnit` by text”:
  - same text means same canonical `langUnit`
  - new occurrence means new `subSeg` ref or reverse-link entry
- Decide whether `langUnit.instances` should also carry extra per-instance metadata beyond context.

Tracer bullet slice:

- One small sample capture can be described entirely by the contract.
- There is no ambiguity about who owns text, identity, and instances.

Done when:

- The target shape is clear enough to implement without changing direction midstream.

## Phase 1: Make Reads Prefer The Normalized Join

Goal: read editor and ref-list UI from `langUnit` as the source of truth while keeping the existing storage intact.

Work:

- Update rendering paths to treat `langUnitId` as the primary link.
- Resolve visible bubble text from `langUnit.text` when rendering a `subSeg`.
- Keep current `subSeg.content` parsing working for old payloads that still carry `text`.
- Keep `langUnit.instances` / reverse-link counts derived from `subSeg` references.
- Leave write behavior unchanged in this phase.

Tracer bullet slice:

- Existing data still renders.
- The UI can drop `token.text` for display if `langUnit` data is available.
- Ref badges and ref lists still match the current screen.

Done when:

- The app can render the live dataset with the new read path without changing persistence.

## Phase 2: Introduce Pointer-Only `subSeg` Writes In Parallel

Goal: change the write path so new saves can emit pointer-only `langUnitRef` tokens while keeping the old read path tolerant.

Work:

- Make new captures persist only `langUnitId` and any non-lexical occurrence metadata.
- Stop writing lexical text into new `subSeg.content` refs.
- Keep backward compatibility in the renderer by deriving text from `langUnit`.
- Preserve `remote` so linked sections still render correctly.
- Leave old records untouched for the moment.

Tracer bullet slice:

- A freshly saved capture no longer needs `token.text` to rehydrate.
- The same screen still renders after reload because the join now resolves through `langUnit`.

Done when:

- New saves use the normalized occurrence shape end to end.

## Phase 3: Make `langUnit` Creation And Reuse Explicit

Goal: ensure capture flow is clearly “find or create `langUnit` by text, then bind current occurrence”.

Work:

- Keep exact text lookup as the canonical check for `langUnit` reuse.
- On a miss, mint a new `langUnitId` and create the record.
- On a hit, reuse the existing `langUnitId`.
- In both cases, add a new binding record for the current `subSeg` occurrence.
- Remove any rebuild logic that reassigns lexical identity based on `subSeg` content shape.

Tracer bullet slice:

- Capturing `test` twice reuses the same `langUnit`.
- Capturing `add` for the first time creates a new `langUnit`.
- The saved `subSeg` only points to ids.

Done when:

- The creation rule is one line conceptually: lookup by text, then bind by occurrence.

## Phase 4: Rebuild From Occurrences Without Rewriting Identity

Goal: make the server rebuild reverse links and derived data without collapsing or re-canonicalizing identity in the wrong layer.

Work:

- Rebuild `langUnit.instances` from `subSeg` occurrences.
- Keep `langUnit` identity stable across rebuilds.
- Stop any path that merges two different `langUnit` ids just because text matches, unless that merge is explicitly part of the canonical lookup phase.
- Preserve old data by normalizing legacy `subSeg.content` tokens during read.
- Add migration-safe handling for records that still contain embedded text.

Tracer bullet slice:

- A full rebuild produces the same visible UI.
- Rebuild does not destroy distinct ids that should remain distinct.

Done when:

- The rebuild step is derived-data only.

## Phase 5: Migrate Existing Data In Place

Goal: convert existing persisted records to the normalized model without breaking the app.

Work:

- Convert current `subSeg.content` refs to pointer-only refs.
- Backfill any missing `langUnit` records needed by the existing dataset.
- Preserve `remote` and ordering information.
- Recompute `langUnit.instances` after migration.
- Keep a one-time compatibility pass for old records that still include `text` in refs.

Tracer bullet slice:

- Old data loads.
- Migrated data reloads.
- The same user-visible instances remain present after the migration.

Done when:

- The on-disk dataset matches the new model and the app still works.

## Phase 6: Remove Transitional Compatibility

Goal: delete the temporary shims once the migrated data and new write path are stable.

Work:

- Remove fallback reads for `token.text` once all runtime paths are migrated.
- Remove any text-based identity shortcut that only existed for compatibility.
- Remove any helper that exists only to translate the old duplicated shape.
- Keep the normalized join as the only production path.

Tracer bullet slice:

- The codebase no longer depends on the legacy duplicated representation.

Done when:

- The app runs solely on the normalized model, with no dead compatibility branches left in the hot path.

## Phase 7: Verify The Whole App Still Behaves

Goal: confirm the full editor flow still works after the model change.

Work:

- Capture a new bubble for an existing word.
- Capture a new bubble for a new word.
- Reload and confirm the bubble text still renders.
- Confirm ref counts update.
- Confirm ref-jump still navigates correctly.
- Confirm delete flows remove dependent instances cleanly.
- Confirm save debounce and unload flush still work.
- Confirm codex worker root inference still updates `langUnit.root`.
- Confirm chin disambiguation still updates instance `context.type`.

Tracer bullet slice:

- A normal editing session behaves the same from the user’s point of view.

Done when:

- There is no visible regression in the current app workflow.

## File Targets

Primary files likely touched:

- `src/main.js`
- `src/public/server.js`
- `src/backend/data/langUnits/items.json`
- `src/backend/data/subSegs/items.json`
- `CONTEXT.md`

Likely supporting files:

- `src/backend/data/langUnits/schema`
- `src/backend/data/subSegs/schema`
- any small migration script or one-time repair helper under `mgmt/dev/260707`

## Implementation Order

Recommended order:

1. Update read paths first.
2. Update save paths second.
3. Update rebuild/migration logic third.
4. Remove old compatibility paths last.
5. Verify the app end to end on real data.

## Acceptance Criteria

The work is done when:

- new captures store only lightweight `langUnitRef` pointers in `subSeg`
- `langUnit` owns the lexical text and metadata
- existing data still loads and renders
- counts, instances, and jumps still work
- codex worker flows still work
- chin disambiguation still works
- the migration does not require a broken intermediate state

## Notes

- Keep the diff small inside each phase.
- Favor join-at-read over duplicated write state.
- Prefer explicit migration logic over hidden rewrite behavior.
- Do not optimize for the old model once the new one is in place.
