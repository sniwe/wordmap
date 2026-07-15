# langUnit target-text canonicalization plan

## Goal

Make active `subSeg` capture use one canonical `langUnit` record for the same captured `target.text` and `target.type`.

Example: two `above` captures with `target.type: "engWord"` should point to one `langUnit`; that `langUnit.instances` should contain both occurrence bindings, each with its own `audSegId`, `subSegId`, offsets, context, and target metadata.

## Current Shape

- `subSeg.content` stores lightweight `{ type: "langUnitRef", langUnitId }` tokens.
- `langUnit.text` and `langUnit.target.type` define the lexical target in practice, but identity is still often created from the source `subSegId` ordinal.
- Frontend capture already tries exact text reuse when no cycle target is active.
- Server rebuild currently preserves ids from saved `subSeg.content`; it syncs instances by referenced id but does not canonicalize same `target.type + text`.
- Older server grouping/remap helpers exist, but they are not the active save path.

## Canonical Key

Use:

```txt
normalizeTargetType(target.type) + "\0" + normalizeTargetText(target.text || langUnit.text)
```

Keep text normalization intentionally small:

- trim leading/trailing whitespace
- preserve case for now
- preserve punctuation for now

Add stronger normalization only after real examples require it.

## Phase 1 - Vertical Tracer Bullet

Implement the narrowest end-to-end path for new saves:

1. When saving a `subSeg`, derive each incoming/langUnit candidate's canonical key from `target.type` and text.
2. On the server, find an existing `langUnit` with the same canonical key.
3. If found, remap the incoming `subSeg.content` token to the canonical id before writing the subSeg.
4. Merge the incoming instance into the canonical `langUnit.instances`.
5. Return the saved subSeg plus rebuilt langUnits so the frontend updates without a full reload.

Acceptance check:

- Create a second `above` capture with `engWord`.
- The second `subSeg.content` references the first canonical `above` id.
- The canonical `above` record has two instances.
- Both bubbles still render in their own subSeg contexts.

## Phase 2 - Existing Data Migration

Add a one-shot runtime-safe canonicalization pass:

1. Scan all current `langUnits`.
2. Group by canonical key.
3. Pick the oldest existing id as canonical.
4. Rewrite all `subSeg.content.langUnitId` references from duplicate ids to canonical id.
5. Merge duplicate `instances`, preserving per-occurrence `audSegId`, `subSegId`, offsets, `remote`, `cycleGroupId`, `context`, and `target`.
6. Delete duplicate `langUnit` records after refs are rewritten.

Acceptance check:

- Current duplicate `above` entries collapse into one record.
- Both source subSegs still show `above` bubbles.
- `langUnit` reference count badge reflects both occurrences.

## Phase 3 - Frontend Capture Alignment

Make frontend pre-save behavior match server truth:

1. Replace exact-text-only lookup with canonical-key lookup.
2. When wrapping a selection, compute provisional `target.type` from selection plus context.
3. Reuse an existing matching `target.type + text` id when present.
4. Still let the server be authoritative, because frontend state may be stale.

Acceptance check:

- Capturing same text with different target types can produce separate records.
- Capturing same text with same target type reuses the canonical id immediately in the editor.

## Phase 4 - Schema Tightening

Update schemas after behavior is working:

1. Document `target` on `langUnit` as required storage shape.
2. Clarify that `langUnit._id` is stable identity, not necessarily source-derived.
3. Keep `subSeg.content.langUnitRef` pointer-only.
4. Optionally add a persisted `canonicalKey` only if lookup cost or debugging demands it.

Default: do not persist `canonicalKey`; derive it.

## Phase 5 - Regression Checks

Minimum checks before calling done:

- Newline and line break rendering in `subSeg` input survives capture/save/reload.
- Child `subSeg` rows linked through `linkTargetLangUnitId` still open from targeted bubbles.
- `Ctrl+Backspace` parent snapback still targets the direct parent row.
- `chinFuzz` equals-gloss behavior still updates parent display text.
- Bulk clear langUnits still rewrites subSeg content back to text.

## Likely Touch Points

- Server canonicalization/remap in the subSeg POST path.
- Server rebuild path so langUnit instances are synced after remaps.
- Frontend capture lookup and save response merge.
- Data migration helper or startup/admin action.
- `langUnits` schema and `CONTEXT.md` vocabulary once behavior lands.

## Risk Notes

- `linkTargetLangUnitId` currently points at a langUnit id. If an id is remapped, child subSeg parent links must be remapped too.
- `cycleGroupId` can also contain langUnit ids. Duplicate collapse must rewrite those where they point at duplicate ids.
- Source-derived ids currently encode parent subSeg. After canonicalization, deriving a parent subSeg from langUnit id is no longer reliable for canonical records reused across subSegs. Any parent lookup must use instance or `subSeg.content` occurrence data instead of parsing the id.
