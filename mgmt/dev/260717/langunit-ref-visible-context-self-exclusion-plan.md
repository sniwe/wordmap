# langUnit Ref Visible Context Self-Exclusion Patch Plan

## Goal

Make `langUnitRef` list clicks expose every valid destination when the same canonical `langUnit` has occurrences both inside the current audEp path and across another audEp path.

The ref list must not hide a valid cross-audEp destination just because the visible projected row reuses the same canonical `subSegId` as one stored occurrence.

Current concrete data:

- `communist` langUnit `08639bd2-41d9-4d84-9cb9-5fae7e61500a-0-0-0`
  - canonical occurrence: audSeg `08639...-0`, subSeg `08639...-0-0`
  - cross-audEp occurrence: audSeg `5c517...-0`, subSeg `5c517...-0-0`
- `commune` langUnit `08639bd2-41d9-4d84-9cb9-5fae7e61500a-0-1-0`
  - canonical child occurrence: audSeg `08639...-0`, subSeg `08639...-0-1`
  - same-audEp/audSeg-family root occurrence: audSeg `08639...-1`, subSeg `08639...-1-0`
- projected visible row can have canonical `subSegId = 08639...-0-1` while rendered under a different visible parent/audEp context.

## Working Diagnosis

`openLangUnitRef(ref)` navigates to the clicked row's `data-audseg-id`. It does not choose a destination by itself.

The destination preference comes earlier, in `renderLangUnitRefsList(audSegItem)`:

```js
if (itemSubSegId === subSegId || seen.has(itemSubSegId)) {
  continue;
}
```

That compares only canonical `subSegId`.

For projected rows this is too coarse:

- visible location = destination audSeg/root path plus rendered parent edge
- persisted row id = canonical child `subSegId`
- self-exclusion by canonical `subSegId` can hide the canonical destination even when the visible row is a projection under another audEp

The ref list should exclude only the current visible occurrence, not every stored occurrence that happens to share the projected row's canonical id.

## Phase 1: Prove the Ref List Source of Truth

Tracer bullet:

- Target `communist` on canonical audSeg `08639...-0`.
- Confirm list includes cross-audEp root `5c517...-0-0`.
- Target `communist` on cross-audEp audSeg `5c517...-0`.
- Confirm list includes canonical root `08639...-0-0`.
- Target `commune` inside projected child context.
- Confirm current code cannot distinguish:
  - projected visible child `08639...-0-1` under cross-audEp parent
  - stored canonical child `08639...-0-1` under canonical parent

Patch work:

- No behavior change.
- Use current `state.subSegItems`, `getLangUnitRefListTarget(audSegId)`, and rendered tree entries to list actual emitted refs.

Done when:

- The failure is reduced to one invariant:
  - ref-list self-exclusion must use visible occurrence context, not canonical `subSegId` alone.

## Phase 2: Carry Visible Ref Context from Tree Target

Tracer bullet:

- `getLangUnitRefListTarget(audSegId)` should return enough context to identify the active visible occurrence.
- For projected child rows, that means at least:
  - visible audSeg id
  - canonical subSeg id
  - rendered parent subSeg id

Patch work:

- Keep the change local to `src/main.js`.
- Extend the return value from `getLangUnitRefListTarget(audSegId)` minimally:

  ```js
  { audSegId, subSegId, parentSubSegId, langUnitId }
  ```

- Reuse the existing `getSubSegEntriesInTreeOrder(audSegId)` entry shape; it already carries `parentSubSegId`.
- Do not create a new ref-list data model.

Done when:

- The active visible ref target can distinguish canonical child rendered under canonical parent from the same canonical child projected under a different visible parent.

## Phase 3: Replace Canonical-Only Self Exclusion

Tracer bullet:

- Build ref rows for `commune` while the visible target is projected child `08639...-0-1` under cross-audEp parent `5c517...-0-0`.
- The list should not hide canonical occurrence solely because `itemSubSegId === subSegId`.

Patch work:

- Replace:

  ```js
  itemSubSegId === subSegId
  ```

  with a small helper such as:

  ```js
  function isSameVisibleLangUnitRefTarget(ref, target) { ... }
  ```

- The helper should exclude only when the candidate matches the active visible occurrence.
- Lean first pass:
  - root/local rows: same `audSegId` and same `subSegId`
  - projected child rows: same visible `audSegId`, same canonical `subSegId`, and same rendered parent edge when available
- If candidate rows do not carry render parent data, do not pretend they do; fall back to audSeg+subSeg only for non-projected/root rows.

Done when:

- A projected visible row no longer suppresses the canonical stored occurrence unless it is actually the same visible occurrence.
- Same-root self links are still suppressed.

## Phase 4: Preserve Click Semantics

Tracer bullet:

- Clicking any emitted `.item__langunit-ref` still navigates by that row's `data-audseg-id` and `data-langunit-id`.

Patch work:

- Avoid touching `openLangUnitRef(ref)` unless Phase 3 proves the clicked row lacks enough destination data.
- If needed, add only one extra `data-*` field for destination `subSegId`; do not add a routing registry.

Done when:

- The fix changes which rows are shown, not how a shown row navigates.

## Phase 5: Verification

Tracer bullet:

- With current collection data, both local and cross-audEp destination options are reachable by clicking visible ref rows.

Checks:

- `communist` targeted from canonical root lists and navigates to cross-audEp root.
- `communist` targeted from cross-audEp root lists and navigates to canonical root.
- `commune` targeted from canonical child lists and navigates to the other occurrence.
- `commune` targeted from projected child context does not lose the canonical occurrence because of canonical `subSegId` self-exclusion.
- Ref list follows deepest targeted visible row.
- No duplicate rows for the same visible destination.
- No new `subSeg` record is created by list render or click navigation.
- `npm run build` passes.
- Because this touches `subSeg` render/navigation behavior, verify newline rendering remains intact:
  - `normalizeSubSegLineBreaks(...).replaceAll('\n', '<br>')`
  - `.item__subseg-input { white-space: pre-wrap; }`

## Preferred Patch Boundary

Keep the code change in `src/main.js`.

Do not introduce a second ref-list store. The lean fix is to make the existing derived ref list compare the active visible occurrence instead of comparing only persisted canonical ids.
