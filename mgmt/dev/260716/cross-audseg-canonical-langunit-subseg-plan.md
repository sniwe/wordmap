# Cross-audSeg Canonical langUnit subSeg Plan

## Goal

Make a captured target such as `bob` recall the same canonical `langUnit` and the same linked child `subSeg` across different `audSeg` contexts when `target.type` and trimmed target text match.

## Phase 1 - Identity Model

- Treat `langUnit` as the app-wide canonical lexical node.
- Canonical key: `target.type + "\0" + trim(target.text)`.
- Same canonical key means same `langUnit._id`, regardless of `audSeg`.
- A linked child `subSeg` belongs to the canonical `langUnitId`, not to one parent occurrence.

Acceptance:

- Capturing `bob` with the same target type in two different `audSeg`s resolves to one `langUnit`.

## Phase 2 - Collection Shape

- Keep `subSeg.content` pointer-only for captures: `{ type: "langUnitRef", langUnitId }`.
- Keep one linked child `subSeg` per canonical `linkTargetLangUnitId`.
- Stop using `parentSubSegId` as identity for linked child rows.
- Keep `parentSubSegId` only as a render/focus hint if the UI still needs displayed-parent context.

Acceptance:

- There is no persisted duplicate child `subSeg` for the same canonical `linkTargetLangUnitId`.

## Phase 3 - Server Authority

- On every `subSeg` save, normalize incoming langUnit candidates by canonical key.
- Rewrite saved content refs to existing canonical ids when available.
- Ensure linked child saves resolve by `linkTargetLangUnitId`.
- Return canonicalized `subSegs` and `langUnits` needed by frontend state.

Acceptance:

- Saving a new `bob` capture in a new `audSeg` rewrites the token to the existing canonical `bob` id.

## Phase 4 - Frontend Capture Alignment

- Derive provisional `target.type` before wrapping selected text.
- Lookup by canonical key before creating a new langUnit id.
- Assign the existing canonical id immediately when found.
- Keep server remap authoritative for stale frontend state.

Acceptance:

- A repeated `bob` capture shows the canonical id immediately in the editor.

## Phase 5 - Shared Linked Child Rendering

- When a canonical langUnit bubble is targeted, find the linked child by `linkTargetLangUnitId`.
- Render that same child row under the targeted occurrence in any `audSeg`.
- Ctrl+Backspace returns to the displayed parent occurrence, not a stored ownership parent.
- Save edits from the active projected editor to the one persisted child row.

Acceptance:

- Targeting `bob` in either `audSeg` opens the same child subSeg.
- Editing from either location updates the same persisted child row.
- No sibling or non-ancestor projections appear.

## Phase 6 - Dev Data Reset

- Because this is a safe dev environment, drop backward-compat migration complexity.
- Clear or regenerate current `langUnits` and `subSegs` into the new minimal shape.
- Delete duplicate linked child rows for the same canonical langUnit.

Acceptance:

- Current data contains at most one child subSeg per canonical `linkTargetLangUnitId`.

## Phase 7 - Verification

- Capture `bob` in one `audSeg`, create linked child content.
- Capture same `bob` target type in another `audSeg`.
- Target the second `bob`; it opens the same child content.
- Edit child content from both locations and confirm one persisted row changes.
- Verify newline and line break rendering survives save/reload.
- Run `npm run build`.
