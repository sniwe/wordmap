# Cycle-selected subSeg augmentation tracer plan

## Bug contract

Fixture text:

`估计还会跨大洲地跨大洲地~liandong`

Reproduction:

1. Capture the first `跨大洲地` as a `chinWord`.
2. Cycle-select it.
3. Select the adjacent `liandong` capture range and press Enter.
4. Clear the resulting composite bubble.
5. Recreate `跨大洲地`.
6. Capture `liandong` independently.

Observed persisted failure:

- first unit: `跨大洲地`
- second unit: `跨大洲地~liandong`

Expected second unit text: `liandong`.

## Root cause hypothesis to verify

`reprocessCycleTargetedSelection()` intentionally creates a composite target from
`seedText~additionText`, but `setCompositeBubbleMetadata()` places that aggregate
target on every part bubble. The aggregate target then survives extraction,
rendering, and save/reload as the second part's lexical text. Clearing the
composite removes the visual bubbles but does not establish a clean independent
capture boundary for the later re-created unit.

## Phase 1 — Add one vertical tracer fixture — complete

Trace the exact sequence through DOM, draft payload, POST payload, persisted
`subSeg`, and persisted `langUnit` records. Record for every bubble/token:

- visible text
- `langUnitId`
- `compositionId` / `partId`
- `data-langunit-target-text`
- extracted `content[].text`
- instance `target.text`

Success signal: the focused verifier records the composite/part boundary and
asserts that the later independent capture remains `liandong`. Keep this as the
single regression fixture; no broad test framework or collection reset.

## Phase 2 — Preserve part text during composite conversion — complete

Patch the shared composite metadata path, not each key handler:

- keep the composite aggregate only as the parent langUnit target/composition
  target;
- store each bubble's own part text separately;
- make `extractSubSegEditorPayload()` use that part text for the corresponding
  `langUnitRef.text` and instance text;
- ensure the seed part remains `跨大洲地` and the addition part remains
  `liandong`.

Acceptance:

- composite parent may remain `跨大洲地~liandong`;
- its addition part and rendered addition bubble are `liandong`;
- no part token contains the aggregate prefix.

Implemented in `src/main.js`: aggregate target state is held on the parent
payload, while each instance and `langUnitRef` keeps its own bubble text.

## Phase 3 — Make clear a real boundary — complete

When the composite group is cleared, remove composite-only metadata from the
unwrapped text path and ensure the next independent capture cannot inherit the
old `compositionId`, `partId`, aggregate target, or cycle group. Preserve the
linked child row only when it still points to a live canonical langUnit.

Acceptance:

- clearing leaves plain text;
- recreating `跨大洲地` creates/reuses only the `跨大洲地` canonical unit;
- capturing `liandong` creates/reuses only the `liandong` unit;
- no second capture receives the former composite target.

The existing clear path unwraps the complete target group; the patch also makes
addition bubbles remove stale aggregate attributes, so a later extraction has
no part-level aggregate metadata to inherit.

The reload boundary also repairs legacy records where seed and addition were
stored under split IDs and the addition token carried the aggregate text.

## Phase 4 — Canonicalization and reload verification — complete

Run the fixture through the real save/reload path and assert:

- `subSeg.content` contains separate text values `跨大洲地` and `liandong`;
- the second langUnit has `text === "liandong"`;
- no `chinColl` record remains referenced after clear;
- the first unit's child link is not silently transferred to the second unit;
- same-text captures still reuse the canonical unit while distinct text remains
  distinct.

Because this touches subSeg input, explicitly verify multiline input and Enter
line-break rendering remain unchanged.

The build and focused verifier pass; the verifier explicitly guards the
newline-to-`<br>` rendering path.

## Phase 5 — Minimal regression check and handoff — complete

Leave one runnable assert-based tracer for the fixture or extend the nearest
existing tracer. Keep the patch limited to the composite metadata/extraction
boundary and clear cleanup. Do not alter collection data as part of the fix.

Done means the exact reproduction yields `liandong` for the second unit after
save, reload, and a fresh independent capture.

Runnable check: `node mgmt/dev/260801/verify-cycle-selected-subseg-augmentation.mjs`.
