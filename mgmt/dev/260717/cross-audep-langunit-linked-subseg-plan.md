# Cross-audEp langUnit-Linked subSeg Display Patch Plan

## Goal

Make `langUnit`-linked `subSeg` display and surrounding behavior consistent when the linked child `subSeg` record is canonicalized under one `audEp`, but projected under matching `langUnit` occurrences in another `audEp`.

Current concrete data:

- audEp index `1`, audSeg `08639bd2-41d9-4d84-9cb9-5fae7e61500a-0`
  - root subSeg `...-0-0` contains `communist`
  - canonical child subSeg `...-0-1` is linked to `communist`
  - nested child subSeg `...-0-2` is linked to `commune`
- audEp index `0`, audSeg `5c517c44-a5d8-45b2-9d5f-e68bb5bcbeaf-0`
  - root subSeg `...-0-0` also contains canonical `communist`
  - when root targets `communist`, canonical child `08639...-0-1` should project under this audEp root
  - when projected child targets `commune`, nested child `08639...-0-2` should also display under the projected child

## Working Diagnosis

`getSubSegEntriesInTreeOrder(audSegId)` currently builds `parentIdsByLangUnitId` from only `items`, where `items = getSubSegItemsForAudSeg(audSegId)`.

That is enough for first-level projection:

- destination audSeg root contains `communist`
- canonical child `...-0-1.linkTargetLangUnitId = communist`
- tree projects `...-0-1` below the destination root

It fails for deeper projected descendants:

- projected child `...-0-1` contains `commune`
- nested child `...-0-2.linkTargetLangUnitId = commune`
- because `...-0-1` is not part of destination audSeg `items`, its content is not indexed as a parent source for `commune`
- therefore `...-0-2` is never connected under projected `...-0-1` across audEp bounds

There is also a surrounding behavior risk:

- projected rows render with destination `data-subseg-audseg-id`
- projected rows keep their canonical `data-subseg-id`
- some focus/save/parent behaviors query only by `data-subseg-id`, which is ambiguous once the same canonical child can render under a different visible parent context

## Phase 1: Prove the Failing Cross-audEp Chain

Tracer bullet:

- Enter audSeg `5c517c44-a5d8-45b2-9d5f-e68bb5bcbeaf-0`.
- Target root `communist`.
- Expected visible chain:
  - root `5c517...-0-0`: `oh my god is there a [communist] here too?`
  - projected child `08639...-0-1`: `[commune]`
  - projected nested child `08639...-0-2`: `friends in teh motherland`

Patch work:

- No behavior change.
- Add a tiny local runtime/data check only if needed while implementing.
- Confirm the current walker indexes only destination audSeg-local parent content and misses projected child content.

Done when:

- The failure is reduced to one invariant:
  - every rendered/projected `subSeg` row must be eligible to act as a parent for deeper linked children, regardless of the row's canonical `audSegId`.

## Phase 2: Make Tree Building Projection-Aware

Tracer bullet:

- Start from destination root.
- Add children whose `linkTargetLangUnitId` matches the current row target.
- For every child that becomes visible, also index that child's own `langUnitRef` tokens as possible parent anchors.
- Repeat recursively.

Patch work:

- Keep the change inside `getSubSegEntriesInTreeOrder(audSegId)`.
- Replace the up-front, audSeg-local-only parent index with a lazy recursive traversal:
  - root comes from destination audSeg.
  - children are found from `sortSubSegItems(state.subSegItems)`.
  - a child can attach under a visible parent when:
    - the parent has a matching `langUnitRef` token, and
    - the child `linkTargetLangUnitId` matches that token's canonical target.
  - the child is rendered only when the parent currently targets that same `langUnit`.

Preferred helper shape:

```js
function getChildSubSegItemsForRenderedParent(audSegId, parentItem, parentSubSegId) { ... }
```

Use existing helpers first:

- `getOrderedLangUnitIds(getSubSegContentTokens(audSegId, parentSubSegId))`
- `getTargetedLangUnitIdForSubSeg(audSegId, parentSubSegId)`
- `subSegLinkMatchesLangUnitTarget(child, targetedLangUnitId)`
- `getSubSegLinkTargetLangUnitId(child)`

Important detail:

- For projected child content, `getSubSegContentTokens(destinationAudSegId, projectedSubSegId)` already resolves by `subSegId`, so it can read canonical child content without needing a second data model.

Done when:

- A projected child row can itself project its linked child row.
- No new persisted `subSeg` records are created just by displaying projected descendants.
- Existing same-audEp nesting still works.

## Phase 3: Preserve Render Context Explicitly

Tracer bullet:

- Rendered row identity has two parts:
  - canonical row id: `subSegId`
  - visible parent context: `parentSubSegId`
- A projected child under audEp index `0` may have canonical `subSegId = 08639...-0-1`, but visible parent `parentSubSegId = 5c517...-0-0`.

Patch work:

- Keep `data-subseg-id` as the canonical persisted id.
- Continue setting `data-parent-subseg-id` from the render edge.
- Add the smallest missing context only if needed:
  - likely `data-render-parent-subseg-id` is unnecessary because `data-parent-subseg-id` already carries render context.
  - avoid adding another id unless an existing behavior cannot distinguish canonical parent from visible parent.

Audit these behaviors after Phase 2:

- `focusedPathEdges` in `getSubSegEntriesInTreeOrder`
- `focusCycleSubSegInput(editor)`
- `focusParentSubSegInput(editor)`
- `refreshLinkedParentLangUnitText(editor)`
- `getLiveSubSegEditor(subSegId)`
- `saveSubSeg(subSegId)`

Done when:

- Parent focus from a projected child returns to the visible parent row, not only the canonical parent row.
- Focus restore after target cycling returns to the visible row instance.
- Saving a projected child still persists the canonical child record.

## Phase 4: Fix Ref List Semantics for Projected Rows

Tracer bullet:

- If audEp index `0` root targets `communist`, ref list should use `communist`.
- If projected child `commune` is the deepest visible target, ref list should use `commune`.
- The local visible projected row should not show as a self-link, but other actual occurrences should.

Patch work:

- Re-check `getLangUnitRefListTarget(audSegId)` after projection-aware tree traversal.
- If self-exclusion by only `subSegId` hides too much, compare by visible context:
  - current `subSegId`
  - current visible `audSegId`
  - current rendered parent edge
- Keep the first fix minimal; do not introduce a separate ref-list model unless the data proves it is necessary.

Done when:

- Ref list follows the deepest targeted visible row.
- Cross-audEp projected child display does not remove valid remote references from the list.
- Same-audEp root and nested ref navigation still behave as before.

## Phase 5: Patch Navigation Path Seeding Across audEps

Tracer bullet:

- Clicking a `langUnitRef` to a destination occurrence whose child path is canonicalized in another audEp should seed:
  - destination root target
  - projected child target
  - projected descendants as needed

Patch work:

- Re-check `getSubSegTargetPathForLangUnit(audSegId, langUnitId)`.
- Current helper searches only `getSubSegItemsForAudSeg(audSegId)`, so it may miss a target contained inside a projected canonical child.
- Adjust it to derive a path through the same projection-aware tree logic from Phase 2.
- Preferred shape:
  - first try local destination audSeg path
  - then try projected tree path
  - return ordered `{ subSegId, langUnitId }` seeds

Done when:

- Clicking a ref can open an audEp whose visible destination path crosses canonical subSeg ownership.
- The path seeding and tree rendering use the same parent/child rules.

## Phase 6: Regression and Runtime Checks

Tracer bullet:

- One target click or cycle should be enough to display all expected projected descendants across audEp bounds.

Verification:

- `npm run build`
- Data-path check for current collection entries:
  - destination audSeg `5c517...-0`
  - root target `communist`
  - projected child `08639...-0-1`
  - projected grandchild `08639...-0-2`
- Root-only case still works.
- Same-audEp nested `commune` case still works.
- Cross-audEp projected `communist -> commune -> friends in teh motherland` case works.
- No duplicate rows for the same visible parent edge.
- No new subSeg record is created by navigation/display alone.

Because this touches subSeg display/render behavior, also verify newline handling remains intact:

- stored/rendered text path still uses `normalizeSubSegLineBreaks(...).replaceAll('\n', '<br>')`
- `.item__subseg-input` still uses `white-space: pre-wrap`

## Preferred Patch Boundary

Keep the patch in `src/main.js`.

Do not introduce a separate projection store. The lean fix is to make the existing tree traversal operate on rendered parent edges instead of assuming every parent row belongs to the destination audSeg.
