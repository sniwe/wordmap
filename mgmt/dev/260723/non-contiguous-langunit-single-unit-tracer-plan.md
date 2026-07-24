# Non-Contiguous langUnit Single-Unit Tracer Plan

## Goal

Change non-contiguous linked `langUnit bubble` groups from "separate langUnits tied by `cycleGroupId`" into one actual `langUnit` with multiple surface occurrences.

User flow:

1. Cycle-target an existing `langUnit bubble`.
2. Select a non-contiguous substring outside that bubble.
3. Press `Enter`.

Expected result:

- The newly captured part points to the same `langUnitId` as the targeted bubble.
- The merged `langUnit` is reclassified from the full set of captured parts after every added part.
- Each rendered bubble still displays only its own captured surface text.
- Save, reload, child `subSeg` opening, ref traversal, dotted connectors, and cycle-select all treat the group as one langUnit immediately.

## Current Runtime Shape

The current implementation models this as separate langUnits:

- `wrapSelectedSubSegText(editor)` creates a new `data-langunit-id` for the selected part.
- If a cycle target is active, it writes `data-langunit-cycle-group-id` pointing at the targeted group.
- `getLangUnitBubbleGroupIds()` and render paths treat `cycleGroupId || langUnitId` as the cycle index.
- Save persists the group through `langUnits[].instances[].cycleGroupId`.

That preserves interaction grouping but leaves each part with its own `langUnit.text`, `target.type`, root inference, and other langUnit-level properties.

## New Root Rule

The targeted `langUnitId` is the unit id.

When capture happens against an active cycle target:

- Use the active target group id as the captured bubble's `data-langunit-id`.
- Do not create a second langUnit for the new part.
- Store the occurrence text on the langUnit instance so each bubble can render its own text.
- Recompute `langUnit.text` and `langUnit.target` from all instance texts in document order.
- Keep `cycleGroupId` only as a temporary migration/compatibility input, not as the primary model for new captures.

## Schema Adjustment

Add one optional field to `langUnits/items.json` instance records:

```json
{
  "text": "captured surface text"
}
```

Meaning:

- `langUnit.text`: merged whole used for classification, canonicalization, recall, root inference, and list identity.
- `langUnit.target.text`: same merged whole unless an existing special target rule overrides it.
- `langUnit.instances[].text`: exact surface text for that occurrence.
- `subSeg.content[]`: can remain pointer-only `{ "type": "langUnitRef", "langUnitId": "..." }`; repeated refs to the same id are allowed.

Rationale:

- A single langUnit id cannot render different non-contiguous bubble texts from `langUnit.text` alone.
- Keeping occurrence text on instances preserves the existing item/instance split and avoids a new top-level `parts` collection.

## Merge Text Rule

Add one shared helper, duplicated client/server only if needed:

`getMergedLangUnitText(instances)`

Rules:

1. Use instance texts in rendered document order: `audSegId`, `subSegId`, `start`, `end`, then original array order.
2. Trim empty/punctuation-only texts out of the merge only if their target type would be `no-op`.
3. If any part contains CJK, concatenate parts with no separator.
4. Otherwise join parts with a single space.

Then classify with the existing `createLangUnitTarget(mergedText, contextType, selection)` / `normalizeLangUnitTarget(...)` logic. This keeps the type rules centralized instead of inventing a second classifier.

## Phase 1: Runtime Capture Uses Anchor Id

Tracer bullet:

1. In `wrapSelectedSubSegText(editor)`, when `targetLangUnitId` exists:
   - set `bubble.dataset.langunitId = targetLangUnitId`
   - skip assigning `data-langunit-cycle-group-id`
   - preserve `data-langunit-source-text` only if display text differs from stored part text
2. Keep the non-targeted path unchanged.
3. Keep `getLangUnitBubbleGroupIds()` behavior unchanged so legacy `cycleGroupId` groups still work during migration.

Acceptance:

- Target a bubble, select text elsewhere, press `Enter`.
- New bubble appears immediately and has the same `data-langunit-id` as the target.
- `Ctrl+ArrowLeft/Right` cycle-select includes both bubbles immediately.
- Pressing `Enter` with no selection still opens the child `subSeg` for the shared langUnit id.

## Phase 2: Extract And Persist Per-Occurrence Text

Tracer bullet:

1. In `extractSubSegEditorPayload(editor)`, collect repeated same-id bubbles as multiple instances under the same langUnit.
2. Preserve each instance's surface text as `instance.text`.
3. Recompute the outgoing langUnit's:
   - `text` from all instance texts
   - `target` from the merged text
4. Keep outgoing `subSeg.content` pointer-only, with repeated `{ type: "langUnitRef", langUnitId }` refs.

Acceptance:

- Save payload has one langUnit item for the grouped parts.
- That langUnit has multiple instances with distinct `text`, `start`, `end`, `context`, and `target`.
- `subSeg.content` repeats the same `langUnitId` where the bubbles appear.

## Phase 3: Server Normalization And Migration

Tracer bullet:

1. Preserve `instance.text` in `normalizeLangUnitInstance()`.
2. In `mergeLangUnitItems()` and `syncLangUnitInstances()`, recompute item-level `text` and `target` from instance texts when an item has multiple instance texts.
3. Add a migration in `rebuildLangUnitItems()`:
   - find items with `instances[].cycleGroupId`
   - merge them into the target `cycleGroupId` item
   - rewrite `subSeg.content[].langUnitId` from remote ids to the target id
   - rewrite child `subSeg.linkTargetLangUnitId` from remote ids to the target id
   - remove `cycleGroupId` from merged instances after ids are rewritten
4. Leave legacy `cycleGroupId` reading in the client until after existing entries have been migrated.

Acceptance:

- Existing collection entries migrate without clearing data.
- Old remote langUnit ids disappear or become remapped aliases only during the rebuild.
- Reload shows the same bubbles, but their content refs all point to one langUnit id.
- The merged langUnit's type changes as parts are added if the merged text crosses current classifier thresholds.

## Phase 4: Render Repeated Same-Id Occurrences

Tracer bullet:

1. In `renderSubSegContentTokens(tokens, subSegId)`, track occurrence index per `langUnitId`.
2. Resolve display text from matching `langUnit.instances[]` by `{ subSegId, occurrenceIndex }`.
3. Fall back in this order:
   - token text, if present in old drafts
   - matching `instance.text`
   - `langUnit.text`
4. Keep current repeated same-id remote styling and connector behavior.

Acceptance:

- Reloaded non-contiguous bubbles display their individual captured text, not the merged langUnit text in every bubble.
- Text between same-id occurrences still gets dotted connector styling.
- Ref badge count is not inflated by repeated occurrences inside the same `subSeg`.

## Phase 5: Type Reclassification On Successive Capture

Tracer bullet:

1. Capture a first part that classifies as a smaller type, for example `chinChar` or `engWordPart`.
2. Capture another non-contiguous part into the same target.
3. Confirm item-level `target.type` is recomputed from merged text, for example:
   - one Chinese char -> `chinChar`
   - two Chinese chars -> `chinWord`
   - three or more Chinese chars -> `chinPhrase`
   - English parts joined with a space -> `engPhrase`
4. Confirm child `subSeg` recall and root inference use the merged item-level target.

Acceptance:

- Each added part can change the langUnit's item-level type.
- Existing per-instance context remains available for disambiguation.
- No separate remote langUnit keeps stale type/root data.

## Phase 6: Interaction Regression

Tracer bullet:

1. Capture multiple non-contiguous parts in one `subSeg`.
2. Capture across a line break.
3. Save, reload, and repeat cycle-select.
4. Test:
   - `Ctrl+ArrowLeft/Right`
   - `Enter` target-open
   - `Tab` ref traversal
   - `Ctrl+Delete` unwrap
   - `Ctrl+Backspace` child-to-parent snapback
   - double-space bubble escape

Acceptance:

- All grouped parts cycle-select as one id before and after reload.
- `Ctrl+Delete` unwraps all visible occurrences of the shared id.
- Line breaks render as `<br>` after save/reload.
- Child `subSeg` rows are keyed by the shared id, not by a retired remote id.

## Phase 7: Small Runtime Verifier

Tracer bullet:

Update or add `mgmt/dev/260723/verify-non-contiguous-langunit-single-unit.mjs`.

Assert:

1. Capturing into an active target uses the target id, not a new id plus `cycleGroupId`.
2. Instance normalization preserves `instance.text`.
3. A synthetic repeated-ref `subSeg.content` can render distinct instance texts for one `langUnitId`.
4. Migration remaps old remote ids and child `linkTargetLangUnitId` to the target id.
5. Merged type is recomputed from merged instance text.
6. Newline-to-`<br>` rendering remains present in the subSeg path.

Acceptance:

- `node mgmt/dev/260723/verify-non-contiguous-langunit-single-unit.mjs` passes.
- `npm run build` passes.
- No collection data is cleared; existing entries are migrated in place if the schema changes.

## Likely Files

- `src/main.js`
  - `wrapSelectedSubSegText`
  - `extractSubSegEditorPayload`
  - `renderSubSegContentTokens`
  - ref/cycle helpers only if repeated same-id paths expose gaps
- `src/public/server.js`
  - `normalizeLangUnitInstance`
  - `mergeLangUnitItems`
  - `syncLangUnitInstances`
  - `rebuildLangUnitItems`
  - `remapSubSegLangUnitIds`
- `mgmt/dev/260723/verify-non-contiguous-langunit-single-unit.mjs`

## Cut Line

Do not add a new top-level `langUnit.parts` collection unless `instances[].text` proves insufficient. The existing instance list already has occurrence position, context, remote state, and subSeg linkage; adding `text` is the smallest schema change that makes one logical langUnit render multiple non-contiguous surface parts.
