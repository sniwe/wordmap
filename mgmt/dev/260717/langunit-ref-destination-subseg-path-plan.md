# langUnit Ref Destination subSeg Path Patch Plan

## Goal

When a `langUnitRef` list item is clicked, the destination `audSeg` should render the `subSeg` path that actually contains the clicked `langUnit`, even when that `langUnit` lives below the root `subSeg`.

Current concrete case:

- clicked `langUnitId`: `08639bd2-41d9-4d84-9cb9-5fae7e61500a-0-1-0` (`commune`)
- source visible ref: audSeg `...-1`, root subSeg `...-1-0`
- destination local subSeg: audSeg `...-0`, child subSeg `...-0-1`
- required parent path: root subSeg `...-0-0` targets `...-0-0-0` (`communist`) so child subSeg `...-0-1` is included, then child subSeg `...-0-1` targets `commune`

## Working Diagnosis

`openLangUnitRef(ref)` currently seeds only the destination root target:

```js
setSubSegBubbleTargetIndex(rootSubSegId, getLangUnitBubbleIndex(audSegId, langUnitId));
```

That works only when the clicked `langUnitId` is present in the root `subSeg`. For `commune`, the root `subSeg` does not contain `commune`; it contains `communist`, whose selected child row contains `commune`.

`getSubSegEntriesInTreeOrder(audSegId)` already knows how to render children, but only when each parent `subSeg` target is set to the child row's `linkTargetLangUnitId`.

## Phase 1: Prove the Current Data Path

Tracer bullet:

- Input: destination audSeg `...-0`, target langUnit `...-0-1-0` (`commune`).
- Find the destination subSeg containing the target: `...-0-1`.
- Walk upward through `parentSubSegId`: `...-0-1` -> `...-0-0`.
- Confirm parent link target: `...-0-1.linkTargetLangUnitId` is `...-0-0-0` (`communist`).

Patch work:

- No behavior change.
- Use the existing data shape:
  - `subSeg.content[].type === 'langUnitRef'`
  - `subSeg.linkTargetLangUnitId`
  - `subSeg.parentSubSegId`

Done when:

- The path can be described as ordered target seeds:
  - set root `...-0-0` target to `communist`
  - set child `...-0-1` target to `commune`

## Phase 2: Add One Path-Finding Helper

Tracer bullet:

- Given `(audSegId, langUnitId)`, return the destination subSeg path needed to reveal and target that langUnit.
- For current data, the helper returns:
  - `{ subSegId: '...-0-0', targetLangUnitId: '...-0-0-0' }`
  - `{ subSegId: '...-0-1', targetLangUnitId: '...-0-1-0' }`

Patch work:

- Add a small helper near existing subSeg tree helpers, likely:

  ```js
  function getSubSegTargetPathForLangUnit(audSegId, langUnitId) { ... }
  ```

- Keep it read-only:
  - find destination subSegs in `getSubSegItemsForAudSeg(audSegId)`
  - choose the first subSeg whose content contains the target `langUnitId`
  - walk ancestors with `parentSubSegId` / `getSubSegParentSubSegId`
  - for each edge, seed the parent with the child's `linkTargetLangUnitId`
  - append the destination subSeg seeded with the clicked `langUnitId`

Done when:

- The helper does not create subSegs, mutate state, or render.
- Missing target returns an empty path or root fallback without throwing.

## Phase 3: Seed the Full Path on Ref Click

Tracer bullet:

- Click the `commune` ref in audSeg `...-1`.
- Before render, `langUnitBubbleTargetIndexByAudSegId` is prepared for both:
  - root subSeg `...-0-0` -> `communist`
  - child subSeg `...-0-1` -> `commune`

Patch work:

- Replace the root-only target seeding in `openLangUnitRef(ref)` with path seeding:

  ```js
  for (const step of getSubSegTargetPathForLangUnit(audSegId, langUnitId)) {
    setSubSegBubbleTargetIndex(step.subSegId, getLangUnitBubbleIndexForSubSeg(audSegId, step.subSegId, step.targetLangUnitId));
  }
  ```

- Keep existing navigation/render/playback behavior unchanged.
- If no path is found, keep the current root fallback so simple root refs still work.

Done when:

- Destination rendering is still triggered by the existing `renderEnteredAudSegAndFocus(audSegItem)` / playback path.
- The only new behavior is better target preparation before render.

## Phase 4: Confirm Destination Display

Tracer bullet:

- After clicking the `commune` ref from audSeg `...-1`, destination audSeg `...-0` displays:
  - root `subSeg` text: `this is a [communist] test`
  - child `subSeg` `...-0-1`: `[commune]`
  - optional next child `...-0-2` visible if `commune` is targeted and its linked child exists
  - destination ref list reflects the currently targeted `commune`

Checks:

- Root-target case still works for `communist`.
- Nested-target case works for `commune`.
- Clicking onward/back through destination ref list preserves the path behavior.
- No new subSeg records are created just by navigating.
- Event bubbling remains blocked in the existing click handler.

## Phase 5: Regression Gates

Tracer bullet:

- A single `langUnitRef` click prepares state, renders, and focuses without requiring manual target cycling.

Verification:

- `npm run build`
- Because the fix touches subSeg display preparation, verify newline/line break rendering remains intact:
  - stored text path still uses `normalizeSubSegLineBreaks(...).replaceAll('\n', '<br>')`
  - `.item__subseg-input` still uses `white-space: pre-wrap`

## Preferred Patch Boundary

Keep the code change in `src/main.js`. Reuse the current tree mechanics instead of introducing a separate destination-display model.

## Applied Status

Implemented in `src/main.js`:

- `getSubSegTargetPathForLangUnit(audSegId, langUnitId)` derives the ordered ancestor target path from existing `subSeg` collection data.
- `openLangUnitRef(ref)` seeds every step in that path before rendering, with the old root-only behavior preserved as fallback.
- `getLangUnitRefListTarget(audSegId)` makes the destination ref list follow the deepest targeted visible `subSeg`, so the nested `commune` case excludes the local child occurrence and lists other occurrences.

Current data tracer:

- clicked `commune` ref from audSeg `...-1`
- destination audSeg `...-0`
- seeded path: root `...-0-0` -> `communist`, child `...-0-1` -> `commune`

Verification:

- `npm run build` passed.
- subSeg newline rendering path remains present:
  - `normalizeSubSegLineBreaks(...).replaceAll('\n', '<br>')`
  - `.item__subseg-input { white-space: pre-wrap; line-break: anywhere; }`
