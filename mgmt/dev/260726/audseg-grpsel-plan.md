# audSeg grpSel — vertical tracer bullet plan

## Goal

Add contiguous audSeg grouping inside an entered audEp without changing the existing ungrouped cycle-target or audSeg-entered playback behavior.

Terminology:

- `cycle-select`: current single `state.selectedAudSegIndex` target, shown blue.
- `grpSel`: transient contiguous range selection while Ctrl+Shift is held.
- `captured group`: persisted range with a shared group id, shown green.
- `audSeg entered state`: existing `state.enteredAudSegIndex >= 0`; grpSel is only available when this is inactive.

## Lean data shape

Keep grouping on the existing `audSegs` records; do not add a group collection.

```json
{
  "_id": "audEpId-3",
  "audEpId": "audEpId",
  "audEpIndex": 0,
  "tcs": 18.1,
  "tce": 25.7,
  "grpId": "audEpId-grp-0"
}
```

- `grpId` is absent for ungrouped records and identical for every member of one persisted group.
- Group order is always the existing `getAudSegItemsForAudEp()` temporal order; membership is the set of member ids, not an index range.
- A group is valid only when it has at least two members and its members are contiguous in that ordered audSeg list.
- Group bounds are derived, never stored: minimum member `tcs` and maximum member `tce`.
- Generate the id from the parent audEp id plus the next group ordinal; never use array indexes as identity.
- Existing records load unchanged as ungrouped.

## Interaction contract to lock before implementation

1. With an entered audEp and no entered audSeg, Ctrl+ArrowLeft/Right keeps the current single-target behavior. Ctrl+ArrowUp/Down keeps the existing three-column row jump.
2. Ctrl+Shift held with no entered audSeg switches the same target into `grpSel`; the current audSeg remains the anchor and its border becomes the blue-equivalent green.
3. While `grpSel` is active, plain Left/Right changes the range endpoint by one adjacent audSeg. The range is always normalized to `[min(anchor, endpoint), max(anchor, endpoint)]`; it never wraps.
4. Releasing either Ctrl or Shift immediately clears the transient range and restores the original anchor as the only cycle target. The keyup path must handle either modifier being released first.
5. Enter captures only a range of two or more audSegs. A one-item `grpSel` is discarded and behaves like the existing single target.
6. A persisted group renders green after reload. Ctrl+Shift started on any member targets the whole group as the initial range.
7. In an existing group, Right adds the next adjacent audSeg when available. Left moves the group window one item left while preserving its size; if the intended behavior is shrink instead, settle that one choice before Phase 4. Backspace removes `grpId` from every member and removes the green border.
8. Group actions are unavailable while `enteredAudSegIndex >= 0`; existing Enter playback locking, Backspace close, Delete, and subSeg keyboard guards retain precedence.

## Phased vertical tracer bullets

### Phase 0 — executable contract and invariants

Write the smallest pure helpers in `src/main.js` (or a nearby existing utility area) and validate them with one runnable assertion check:

- sort/resolve audSegs for the active audEp;
- derive a group range from member ids;
- test contiguous membership;
- clamp a range endpoint without wrapping;
- derive group bounds;
- assign/remove a shared `grpId` immutably.

Acceptance: old records return no groups; malformed one-member/non-contiguous groups render as ungrouped and do not crash.

### Phase 1 — transient grpSel, no persistence

Implement the first visible slice in `src/main.js` and `src/styles.css`:

- add minimal runtime state: `audSegGrpSel = { anchorIndex, endIndex } | null` and a modifier-held flag derived from the current key event state;
- route Ctrl+Shift before the existing Ctrl+Arrow audSeg cycle branch;
- render the transient range with `item__segment--grp-selecting` and a green border; do not mutate `audSegItems`;
- keyup of Ctrl or Shift clears the transient range and restores `selectedAudSegIndex` to the anchor;
- plain Left/Right extends/contracts the range while the modifier pair remains held;
- Enter does nothing beyond the current behavior for a one-item range.

Acceptance: Ctrl+Shift+Left/Right can visibly select 2–N contiguous cards, release restores one blue target, and entered audSeg behavior is unchanged.

### Phase 2 — capture one group end to end

Persist the first group through the existing audSeg API:

- add `grpId` to the audSeg schema as an optional string;
- extend POST `/api/audSegs/items` to preserve a supplied `grpId` only after validating the group update, or add the smallest dedicated group mutation endpoint if POST replacement would be unsafe;
- on Enter for a valid transient range, generate one `grpId`, update all selected records, save them, then reload the audSeg collection;
- keep the range transient until the server response succeeds; on failure restore the original anchor and show the existing error/toast path;
- render captured members with a persistent green group class and no transient selection state.

Acceptance: selecting two adjacent segments, pressing Enter, reloading the page, and reopening the audEp shows the same green group.

### Phase 3 — render and maintain persisted groups

Make persisted grouping reliable across the existing lifecycle:

- normalize loaded group membership by parent audEp, remove invalid one-member groups, and prevent a group from crossing audEps;
- make rendering group-aware while preserving the three-column grid; use group boundary classes (`start`, `middle`, `end`) or a minimal group wrapper so green borders form one envelope across rows;
- when a new audSeg is committed, assign it to every persisted group whose derived bounds contain its full `[tcs, tce]` interval; if multiple groups match, reject/leave ungrouped rather than merging implicitly;
- when an audSeg is deleted, remove it from its group and delete the group identity if fewer than two members remain;
- preserve all existing subSeg deletion behavior.

Acceptance: reload, add an in-bounds segment, delete a member, and reload again; membership and green boundaries remain correct without touching subSeg data except for the existing audSeg-delete cascade.

### Phase 4 — edit an existing group

Add the existing-group branch to Ctrl+Shift entry:

- if the cycle anchor belongs to a group, initialize grpSel to that group’s first/last ordered indexes;
- Right expands the range by one next contiguous audSeg and persists the same `grpId`;
- Left shifts the group one position left while preserving group size, or implement the agreed shrink semantics from the Phase 0 contract;
- block expansion beyond list bounds and across a different audEp;
- Backspace clears `grpId` from the group, reloads group state, and returns the cycle target to the original anchor/member.

Acceptance: an existing group can expand, move/shrink according to the locked contract, ungroup, and survive reload at every step.

### Phase 5 — verification and context refresh

Run a compact behavior matrix against the dev UI/API:

- no group, one segment, two segments, all segments;
- modifier release in both orders;
- endpoint at first/last segment;
- row boundaries in the three-column grid;
- add in bounds, add out of bounds, delete member, delete whole group;
- reload after capture/edit/ungroup;
- entered audSeg playback and subSeg input newline behavior remain unchanged.

Then update `CONTEXT.md` with `grpSel`, captured group, group bounds, and group ungrouping vocabulary, and add the functionality-status lifecycle record only if an edit note is created for this feature.

## Recommended implementation order

Ship Phase 1 first, then Phase 2. That gives a visible, reversible interaction slice before adding persistence. Phase 3 and Phase 4 should not be combined: automatic membership on add is data normalization; editing an existing group is keyboard state management.

Ponytail constraint: no separate group model, no index persistence, no generic selection framework, and no new dependency unless the existing grid cannot produce a reliable envelope after the Phase 3 CSS boundary test.
