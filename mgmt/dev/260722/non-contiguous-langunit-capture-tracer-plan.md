# Non-Contiguous langUnit Capture Tracer Plan

## Goal

Restore the runtime flow where a cycle-targeted `langUnit bubble` can absorb a newly selected, non-contiguous substring into the same logical cycle group.

User flow:

1. Cycle-target an existing `langUnit bubble`.
2. Select a substring outside that targeted bubble.
3. Press `Enter`.

Expected result:

- The selected substring becomes a new `langUnit bubble`.
- The new bubble shares the targeted bubble's cycle-select index through `data-langunit-cycle-group-id`.
- The original and remote bubble render as one `linked bubble group`.
- Save, reload, ref badges, dotted connectors, and child `subSeg` opening still work.

## Current Runtime Blocker

The old capture machinery still exists in `src/main.js`:

- `wrapSelectedSubSegText(editor)` assigns `data-langunit-cycle-group-id` when a bubble target is active.
- `getLangUnitBubbleGroupIds(editor)` groups bubbles by `cycleGroupId || langUnitId`.
- `renderSubSegContentTokens()` renders remote bubbles and dotted connectors.
- `extractSubSegEditorPayload()` copies `data-langunit-cycle-group-id` into `langUnit.instances[].cycleGroupId`.

But the focused `subSeg` `Enter` path currently handles active cycle targets before selection wrapping:

1. selection touching an existing bubble triggers nested child capture.
2. active bubble target opens the linked child `subSeg`.
3. `wrapSelectedSubSegText(editor)` is reached only after that.

That means non-contiguous selection outside the targeted bubble never reaches the existing grouping code.

## Root Rule

Selection wins over target-open.

When `Enter` is pressed in a `subSeg` input:

- If the selection touches an existing bubble, keep the current nested substring behavior.
- Else if there is a non-empty selection, wrap it before opening a linked child `subSeg`.
- Else if a bubble target is active, open/focus the linked child `subSeg`.
- Else insert a line break.

Do not add a new mode. This is an ordering fix around the current primitives.

## Phase 1: Minimal Enter Reorder

Tracer bullet:

1. In the `subSeg` `Enter` handler, call `wrapSelectedSubSegText(editor)` before `focusCycleSubSegInput(editor)` when the selection does not touch an existing bubble.
2. Leave `selectionTouchesLangUnitBubble(editor)` first so nested `chinWord` / `chinPhrase` substring capture keeps priority.
3. Do not change `wrapSelectedSubSegText()` yet.

Acceptance:

- Target a bubble, select plain text elsewhere in the same editor, press `Enter`.
- The selection becomes a bubble in-place.
- The editor does not jump to the linked child `subSeg`.
- Pressing `Enter` with no selection while a bubble is targeted still opens the linked child `subSeg`.
- Selecting inside an existing `chinWord` / `chinPhrase` bubble still routes to `captureChinSubstringIntoLinkedSubSeg()`.

## Phase 2: Persist The Shared Cycle Group

Tracer bullet:

1. Confirm the newly wrapped remote bubble has:
   - its own `data-langunit-id`
   - `data-langunit-cycle-group-id` equal to the active target group id
2. Save the parent `subSeg`.
3. Confirm persisted `langUnits/items.json` keeps `instances[].cycleGroupId`.
4. Confirm persisted `subSegs/items.json` keeps the remote occurrence as a pointer-only `langUnitRef`.

Acceptance:

- Reload keeps both bubbles visible.
- Cycling target lands on both bubbles at the same index.
- The remote bubble has dotted underline styling.
- Text between grouped bubbles gets the dotted connector.

## Phase 3: Canonicalization And Remap Safety

Tracer bullet:

1. Capture a remote substring that canonicalizes to an existing `langUnit`.
2. Save and let server canonicalization remap ids.
3. Confirm `remapLangUnitInstanceIds()` rewrites `cycleGroupId` when the original target id is remapped.
4. Confirm `syncEditorLangUnitIdsFromContent()` does not strip the remote bubble's `data-langunit-cycle-group-id`.

Acceptance:

- Same `{ target.type, target.text }` still collapses to one canonical `langUnit`.
- Remote grouping survives canonical id remap.
- Child `subSeg` recall uses the group target id, not the remote bubble's local id.

## Phase 4: Ref List And Navigation Check

Tracer bullet:

1. With a linked bubble group active, press `Tab` to enter `langUnitRef` traversal.
2. Confirm the ref list target is the shared cycle group, not only the anchor bubble.
3. Click a ref-list destination for either grouped occurrence.
4. Confirm destination navigation targets the rendered grouped bubble path.

Acceptance:

- Ref badge count is not duplicated by the grouped remote section.
- Ref list rows still represent real `subSeg.content` occurrences.
- `openLangUnitRef(ref)` can navigate to a destination where the clicked occurrence is a remote section.

## Phase 5: Focus, Line Break, And Escape Regression

Tracer bullet:

1. Repeat the flow across a multi-line `subSeg`.
2. Capture a remote substring after a `<br>`.
3. Save, reload, and verify line breaks remain visible.
4. Test `Ctrl+Backspace`, `Ctrl+Delete`, and double-space bubble escape.

Acceptance:

- `subSeg line break persistence` remains intact.
- `Ctrl+Backspace` from child `subSeg` still snapbacks to the direct parent.
- `Ctrl+Delete` unwraps the targeted linked group back into plain text.
- Double-space at a bubble edge still exits the bubble without producing duplicate spaces.

## Phase 6: Small Runtime Verifier

Tracer bullet:

Add the smallest verifier that exercises the data shape without browser automation:

1. Build a synthetic `subSeg.content` with:
   - anchor `langUnitRef`
   - text gap
   - remote `langUnitRef`
2. Build matching `langUnits` where the remote instance has `cycleGroupId`.
3. Assert:
   - group id resolves to one cycle target
   - remote marker survives normalization
   - canonical remap rewrites `cycleGroupId`

Acceptance:

- `node mgmt/dev/260722/verify-non-contiguous-langunit-capture.mjs` passes.
- No collection data is cleared or replaced.

## Implementation Notes

- Likely code file: `src/main.js`.
- Possible server check only if `cycleGroupId` persistence fails: `src/public/server.js`.
- Keep the first patch to the Enter ordering unless verification proves a second defect.
- Do not introduce a new data field; current `cycleGroupId` is enough.
- After any `subSeg` input edit, verify line break rendering before calling the patch complete.
