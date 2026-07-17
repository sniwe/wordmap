# langUnitRef Graph Panel Tracer Plan

## Goal

Enhance the `langUnitRef` side list from plain text context cards into a keyboard-traversable, badge-first list whose entered item shows a resizable canvas graph of collection relationships centered on that destination `langUnit` occurrence.

Current surface:

- `renderLangUnitRefsList(audSegItem)` in `src/main.js` scans `state.subSegItems` for `subSeg.content` tokens whose `type === 'langUnitRef'`.
- Each list row currently renders a badge plus context text.
- Click navigation uses `openLangUnitRef(ref)`.
- The source of truth for relationships is already local state:
  - `audEp._id`
  - `audSeg.audEpId`
  - `subSeg.audSegId`
  - `subSeg.content[].langUnitId`
  - `langUnit.instances[]`, rebuilt from `subSeg.content`

## Lean Data Shape

Use one derived graph payload. Do not persist it.

```js
{
  nodes: [{ id, kind, label, x, y, opacity, target }],
  edges: [{ from, to, opacity }],
  focusNodeId,
}
```

Node ids should be boring and stable:

- `origin`
- `audEp:${audEpId}`
- `audSeg:${audSegId}`
- `subSeg:${subSegId}`
- `instance:${audSegId}:${subSegId}:${langUnitId}:${ordinal}`

Opacity rule:

- `1`: path from origin to the selected ref item's destination instance
- `0.5`: other contextual instances of the same `langUnitId`
- `0.15`: unrelated collection nodes and unrelated langUnit instances

## Phase 1: Collapse Row Display to Badge

Tracer bullet:

- Target a `langUnit` bubble.
- Ref list still appears.
- Each `.item__langunit-ref` shows only its badge by default.
- No context text box is visible until entered.

Patch work:

- Keep `renderLangUnitRefsList(audSegItem)` as the only list renderer.
- Keep row `data-audseg-id`, `data-subseg-id`, and `data-langunit-id`.
- Add one state field for list targeting:

  ```js
  state.langUnitRefTargetIndex = -1;
  state.enteredLangUnitRefIndex = -1;
  ```

- CSS default:
  - `.item__langunit-ref` collapses to badge-sized hit target.
  - context text is hidden or not rendered unless entered.

Done when:

- Existing click navigation still works.
- Empty/no-target list remains hidden.
- No graph code exists yet.

## Phase 2: Move Focus From subSeg to Ref List

Tracer bullet:

- Cycle-target a `langUnit` bubble inside a `subSeg` input.
- Press `Tab`.
- Focus ownership transfers to the ref list.
- First ref item gets cycle-select styling.
- `Ctrl+Backspace` returns focus to the source `subSeg` input.

Patch work:

- Add only enough state to remember the source editor:

  ```js
  state.langUnitRefSource = { audSegId, subSegId };
  ```

- Reuse the existing document `keydown` path.
- When `Tab` is pressed inside `.item__subseg-input` and `getLangUnitRefListTarget(audSegId).langUnitId` is truthy:
  - prevent default
  - set `langUnitRefTargetIndex = 0`
  - set source ids
  - rerender or sync list classes

Done when:

- Browser tab focus does not leave the app in this mode.
- `Ctrl+Backspace` returns to the exact source editor and clears ref-list targeting.

## Phase 3: Ref List Traversal

Tracer bullet:

- With ref-list focus active, `Ctrl+ArrowDown` and `Ctrl+ArrowUp` cycle the targeted ref item index.
- The targeted row gets the same visual intent as cycle-selected `langUnit` bubbles.
- The source `subSeg` target remains intact.

Patch work:

- Add a helper:

  ```js
  function getVisibleLangUnitRefRows(audSegId) { ... }
  ```

- Have `renderLangUnitRefsList` use that helper so keyboard and render use the same row order.
- Clamp/wrap `state.langUnitRefTargetIndex` against current row count after every render.
- CSS class: `is-targeted`.

Done when:

- Traversal survives list refresh from `syncLangUnitRefsLists()`.
- Traversal does not navigate; it only targets rows.

## Phase 4: Entered Ref Item State

Tracer bullet:

- Press `Enter` on a targeted collapsed ref item.
- That item expands into a container box.
- `Ctrl+Backspace` collapses it back to badge-only.
- While expanded, `Ctrl+ArrowUp/Down` no longer changes ref-list target.

Patch work:

- Treat entered state as index-based:

  ```js
  state.enteredLangUnitRefIndex = state.langUnitRefTargetIndex;
  ```

- Render expanded body only when row index matches `enteredLangUnitRefIndex`.
- Keep click navigation intact, but do not trigger it from keyboard `Enter` in this mode.

Done when:

- Expanded state belongs to one row only.
- Collapse returns to list traversal mode.
- `Ctrl+Backspace` from non-entered traversal still returns to source `subSeg`.

## Phase 5: Graph Data Derivation

Tracer bullet:

- For the entered ref row, derive a full collection graph in memory.
- The focus path is:
  - origin
  - destination `audEp`
  - destination `audSeg`
  - destination `subSeg`
  - selected destination `langUnit` instance

Patch work:

- Add one pure helper in `src/main.js`:

  ```js
  function buildLangUnitRefGraph(ref) { ... }
  ```

- Build from existing state only.
- Do not trust `langUnit.instances` alone for presence; use `subSeg.content` as the occurrence scan, same as `renderLangUnitRefsList`.
- Use `langUnit.instances` for context metadata only when it matches `audSegId + subSegId + occurrence order`.

Layout rule:

- Columns:
  - origin
  - audEps
  - audSegs
  - subSegs
  - langUnit instances
- Sort nodes by existing app order:
  - `audEpItems`
  - `getAudSegItemsForAudEp(...)`
  - `sortSubSegItems(...)`
  - token order in `subSeg.content`

Done when:

- Helper returns deterministic nodes and edges for current JSON data.
- No canvas yet; log-free, render-free pure data only.

## Phase 6: Canvas Renderer

Tracer bullet:

- Expanded ref row shows a canvas.
- Canvas centers and zooms near the selected destination instance node.
- Focus path is full opacity, same-langUnit sibling instances are 50%, unrelated nodes are 15%.

Patch work:

- Use native `<canvas>`, no graph dependency.
- Add:

  ```js
  function renderLangUnitRefGraphCanvas(canvas, graph, view) { ... }
  ```

- Reuse visual language:
  - instance nodes use `langunit-bubble`-like pill fill/border.
  - origin is a blue dot only.
  - audEp/audSeg/subSeg nodes use compact rounded labels, not large cards.

Done when:

- Canvas renders after `requestAnimationFrame`.
- It is readable at default size.
- Centering uses `focusNodeId`.

## Phase 7: Resize, Pan, Zoom

Tracer bullet:

- Drag expanded box edge to resize graph area.
- Drag inside canvas to pan.
- Hold `Ctrl` and mousewheel to zoom around pointer.

Patch work:

- Prefer native CSS resize first:

  ```css
  resize: both;
  overflow: hidden;
  ```

- Use `ResizeObserver` to redraw canvas after container resize.
- Store view by ref row key:

  ```js
  langUnitRefGraphViewByKey.set(refKey, { scale, x, y })
  ```

- Pointer events:
  - plain drag pans
  - `ctrlKey && wheel` zooms
  - prevent default only for handled canvas gestures

Done when:

- Resizing does not shift/corrupt the surrounding `subSeg` input.
- Pan/zoom state survives redraw while the same ref item remains entered.

## Phase 8: Verification

Tracer bullet:

- Use current collection data:
  - target `communist`
  - target `commune`
  - cross-audEp occurrence
  - nested child `subSeg` occurrence

Checks:

- Badge-only collapsed list.
- `Tab` from cycle-targeted `langUnit` moves into ref-list traversal.
- `Ctrl+ArrowUp/Down` traverses collapsed ref rows.
- `Enter` expands only targeted row.
- Expanded graph shows the target destination centered.
- Full-opacity path reaches the selected destination instance.
- Same `langUnit` other contexts are 50% opacity.
- Unrelated nodes are 15% opacity.
- `Ctrl+Backspace` collapses entered row; second `Ctrl+Backspace` returns to source `subSeg`.
- Click navigation on rows still works where currently supported.
- `subSeg` newline rendering remains intact:
  - `normalizeSubSegLineBreaks(...).replaceAll('\n', '<br>')`
  - `.item__subseg-input { white-space: pre-wrap; }`
- `npm run build` passes.

## Preferred Patch Boundary

Keep the first implementation inside:

- `src/main.js`
- `src/styles.css`

Avoid changing persisted schemas. The graph is a derived view over existing collections, not a new collection.
