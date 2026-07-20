# langUnit-Linked subSeg Canonical Recall Tracer Plan

## Goal

Make every `langUnit`-linked child `subSeg` recall by canonical `langUnitId`.

Concrete rule:

- Same `target.type` and trimmed `target.text` always reuse the existing `langUnit` row.
- The new witnessed context is added to that row's `instances` array.
- A new `langUnit` row is created only when the target has never been seen before, or when the same text has a different final `target.type`.
- Therefore, for the same canonical target, concrete `langUnitId`s must not differ.

Concrete failing case:

- Parent subSeg `d9b729d0-d753-4c5f-b01d-ff174dce6b04-0-0` contains `后`.
- Existing canonical `后` langUnit `0eeb2acf-41e0-4a98-9890-7c688496464f-0-1-0` already owns linked child subSeg `0eeb2acf-41e0-4a98-9890-7c688496464f-0-2`.
- Expected child content under the new `后` context: `WHAT YOU ARE WEARING MAY KILL YOU`.
- Current failure: the new capture can keep/use a separate local `langUnitId`, so its child row is created empty.

## Root Rule

`subSeg.content[].langUnitId` and non-root `subSeg.linkTargetLangUnitId` must point to the canonical `langUnitId` for the final `{ target.type, target.text }`.

Do not solve this with a second recall key. The canonical langUnit id is the recall key.

If the Codex chin-disambiguation worker is enabled and the target is applicable, canonicalization must wait for the worker result before choosing/reusing the langUnit id. Linking before final `target.type` is known can attach to the wrong canonical langUnit.

## Target Collection Shape

`langUnits/items.json` item:

```json
{
  "_id": "canonical langUnit id",
  "text": "后",
  "target": { "text": "后", "type": "chinWord" },
  "instances": [
    {
      "audSegId": "audSeg id",
      "subSegId": "subSeg id",
      "context": { "text": "后门儿", "type": "chinPhrase" },
      "target": { "text": "后", "type": "chinWord" }
    }
  ]
}
```

`subSegs/items.json` non-root item:

```json
{
  "_id": "subSeg id",
  "audSegId": "owning audSeg id",
  "isRoot": false,
  "linkTargetLangUnitId": "canonical langUnit id",
  "parentSubSegId": "visible parent subSeg id",
  "content": [],
  "text": ""
}
```

No `linkRecallKey` field is needed.

## Phase 1: Canonical Key First

Tracer bullet:

1. Define one canonical key helper on client and server:
   - `getLangUnitCanonicalKey({ target, text })`
   - key = `<normalized target.type>\0<trimmed target.text>`
2. Remove any same-Chinese-character recall shortcut that merges different target types.
3. Keep `chinChar:后` and `chinWord:后` separate unless disambiguation changes one into the other before canonicalization.

Acceptance:

- Same `{ target.type: "chinWord", text: "后" }` maps to one canonical langUnit.
- `{ target.type: "chinChar", text: "后" }` remains a different canonical langUnit unless worker updates the type before save/link.

## Phase 2: Await Applicable Disambiguation Before Link

Tracer bullet:

1. In the subSeg save path, build pending langUnit candidates with context and provisional target.
2. If chin disambiguation is enabled and the candidate is applicable:
   - await worker classification
   - update the candidate instance `context.type`
   - update the candidate instance/parent `target.type`
3. Only after that, compute the canonical key and pick the canonical langUnit id.
4. If worker fails or returns no useful type, use the local provisional type and mark no special fallback path.

Acceptance:

- The `后` in `后门儿` gets canonicalized only after its final type is known.
- If final type is `chinWord`, the new occurrence points to existing langUnit `0eeb2acf-41e0-4a98-9890-7c688496464f-0-1-0`.
- The parent subSeg content token is rewritten to that canonical id.

## Phase 3: Merge Into Existing langUnit

Tracer bullet:

1. During server normalization/canonicalization:
   - group incoming and existing langUnits by canonical key
   - pick one id as canonical
   - append normalized instances from duplicates into the canonical row
   - dedupe instances by occurrence fields: `audSegId`, `subSegId`, `start`, `end`, `cycleGroupId`
2. Rewrite every `subSeg.content[].langUnitId` from duplicate/local ids to canonical ids.
3. Rewrite every non-root `subSeg.linkTargetLangUnitId` from duplicate/local ids to canonical ids.

Acceptance:

- There is exactly one `langUnits` row for `{ target.type: "chinWord", text: "后" }`.
- The d9b parent content points at that canonical id.
- The d9b child `linkTargetLangUnitId` points at that same canonical id.

## Phase 4: Child subSeg Recall By Canonical Link

Tracer bullet:

1. In `syncCycleSubSegRow(editor, true)`, resolve the active bubble id to its canonical langUnit id before searching/creating child rows.
2. Search existing non-root subSegs by exact `linkTargetLangUnitId`.
3. Prefer:
   - same visible `parentSubSegId`
   - row with non-empty `content`
   - row with non-empty `text`
   - oldest `createdAt`
4. If the best match belongs to another parent, create/update the local visible row using:
   - current `audSegId`
   - current `parentSubSegId`
   - canonical `linkTargetLangUnitId`
   - copied `content` and `text` from the best match

Acceptance:

- Targeting canonical `后` under `d9b729d0-d753-4c5f-b01d-ff174dce6b04-0-0` opens a child containing `WHAT YOU ARE WEARING MAY KILL YOU`.
- No empty child row is created when a contentful canonical child exists.

## Phase 5: Render By Canonical Id

Tracer bullet:

1. In tree rendering, parent bubble groups should already be canonical ids after save.
2. While an editor is live and unsaved, prefer DOM bubble group ids but canonicalize them before matching child links.
3. Compare child branches by exact canonical `linkTargetLangUnitId`, not by raw local ids and not by same-character heuristics.

Acceptance:

- Newly created bubbles still expand/collapse while focused.
- After save, exact canonical id matching renders the same child content across contexts.
- Different target types with same text do not share child subSegs.

## Phase 6: Schema Reset

Tracer bullet:

1. Update `src/backend/data/langUnits/schema` to make `target` required and canonical.
2. Update `src/backend/data/subSegs/schema` to document that `linkTargetLangUnitId` is canonical for non-root rows.
3. Since data is disposable, add a one-time dev reset/normalize script that:
   - rebuilds langUnits into canonical rows by final `{ target.type, target.text }`
   - rewrites subSeg content ids
   - rewrites non-root child links
   - drops duplicate empty child rows where a canonical contentful row exists

Acceptance:

- Current JSON collections parse.
- No duplicate langUnit rows exist for the same final `{ target.type, target.text }`.
- No non-root subSeg links to a non-canonical langUnit id.

## Phase 7: Verification

Tracer bullet:

1. Add one Node verification script under `mgmt/dev/260720`.
2. Assert:
   - `d9b729d0-d753-4c5f-b01d-ff174dce6b04-0-0` `后` token points to the same canonical langUnit id as the existing contentful `后`.
   - `0eeb2acf-41e0-4a98-9890-7c688496464f-0-2` is selected as the recall source.
   - local child content under the d9b parent equals `WHAT YOU ARE WEARING MAY KILL YOU`.
   - no same-text/different-type langUnits are collapsed unless worker finalized them to the same type.
3. Run `npm run build`.
4. Because this touches subSeg input behavior, verify newline rendering remains intact:
   - `insertSubSegLineBreak()` still inserts `<br>`
   - text render still converts `\n` through `normalizeSubSegLineBreaks(...).replaceAll('\n', '<br>')`

## Non-Goals

- No secondary recall-key data model.
- No backwards compatibility for old collection data.
- No many-row synchronization engine.
- No child sharing across different final target types.
