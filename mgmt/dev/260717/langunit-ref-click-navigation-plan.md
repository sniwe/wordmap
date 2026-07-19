# langUnit Ref Click Navigation Patch Plan

## Goal

Make a click on a `langUnit` ref list item complete a full destination navigation every time: destination `audSeg` enters, its `subSeg` editor/list renders, the intended `langUnit` bubble is targeted, and the destination ref list refreshes.

## Working Diagnosis

The click path currently updates navigation state, then relies on `lockSelectedAudSegPlayback()` to render and focus the destination editor. That playback helper can return before rendering when the destination `audSeg` lacks a valid closed time range (`tcs`/`tce`, or `tce <= tcs`). This leaves the UI in a partial navigation state.

## Phase 1: Trace the Click End to End

Tracer bullet:

- Click `.item__langunit-ref`.
- Confirm only the ref click handler runs.
- Confirm `openLangUnitRef(ref)` resolves the expected destination `audSegId`, `langUnitId`, `audEpIndex`, and `selectedAudSegIndex`.
- Confirm the failing path reaches playback validation before render.

Patch work:

- No behavior change unless a missing guard is found.
- Add temporary local inspection only if needed; remove it before final patch.

Done when:

- The exact early-return branch is confirmed as the reason render/focus/ref-list refresh is skipped.

## Phase 2: Split Navigation Render from Playback Lock

Tracer bullet:

- From a known destination item, call one small render/focus path without creating a playback lock.
- Destination `audSeg` and `subSeg` UI render even if audio range is invalid.

Patch work:

- Extract the render/focus body from `lockSelectedAudSegPlayback()` into a helper such as:

  ```js
  function renderEnteredAudSegAndFocus(item) { ... }
  ```

- Keep the helper limited to:

  - `renderAudEps(state.audEpItems)`
  - `requestAnimationFrame(...)`
  - destination `.item__subseg-input` lookup
  - `syncLangUnitBubbleTarget(input, false)`
  - focus with `preventScroll`

Done when:

- `lockSelectedAudSegPlayback()` still behaves the same for valid playback ranges, but render/focus can be reused by navigation code without passing through playback validation.

## Phase 3: Make Ref Click Navigate First

Tracer bullet:

- Click a ref whose destination has missing/open `tce`.
- UI still enters the destination `audSeg`, renders its `subSeg` editor/list, targets the intended bubble, and shows the destination ref list.

Patch work:

- In `openLangUnitRef(ref)`, after destination resolution:

  - set `state.selectedAudEpIndex`
  - set `state.enteredAudEpIndex`
  - set `state.selectedAudSegIndex`
  - set `state.enteredAudSegIndex`
  - set root `subSeg` bubble target index with `getLangUnitBubbleIndex(audSegId, langUnitId)`
  - call the extracted render/focus helper directly

- Treat playback as optional follow-up behavior:

  - if destination range is valid, keep existing lock/seek behavior
  - if destination range is invalid, do not let playback validation block navigation/render

Done when:

- Ref-click navigation no longer depends on `lockSelectedAudSegPlayback()` succeeding.

## Phase 4: Keep Playback State Honest

Tracer bullet:

- Navigate from a locked segment to a ref destination with an invalid range.
- The destination UI renders and no stale lock causes the old segment to keep behaving as selected/entered.

Patch work:

- Clear or replace `state.audSegPlaybackLock` only when it no longer matches the destination.
- Prefer the smallest condition that prevents stale lock behavior without changing unrelated playback flows.

Done when:

- Valid destinations still lock/seek as before.
- Invalid/open destinations render without carrying a misleading playback lock.

## Phase 5: Regression Checks

Tracer bullet:

- Repeatedly click ref items across valid and invalid destination ranges.
- Each click produces a full UI transition, not a partial state mutation.

Checks:

- Valid `tcs`/`tce` destination: `audSeg`, `subSeg` list/editor, targeted bubble, and destination ref list render.
- Missing/open `tce` destination: same render path succeeds, with no early return blocking UI.
- Destination ref list items can navigate back or onward.
- Event bubbling remains blocked; the click does not also trigger parent audEp/audSeg selection behavior.
- `subSeg` newline and line break rendering remains intact after navigation and save/reload.
- `npm run build` passes.

## Preferred Patch Boundary

Keep the diff inside `src/main.js` unless investigation proves a second file owns the render/focus behavior. Avoid reshaping data or list rendering unless the tracer bullet exposes a separate defect.

## Applied Status

- Implemented in `src/main.js`.
- Ref-click navigation now sets entered destination state and renders/focuses independently of playback lock success.
- Valid closed playback ranges still use the existing lock/seek path.
- Invalid/open playback ranges clear stale playback lock and still render the destination `subSeg` UI/ref list.
- `subSeg` newline rendering path remains unchanged: stored text still flows through `normalizeSubSegLineBreaks(...).replaceAll('\n', '<br>')`, and `.item__subseg-input` keeps `white-space: pre-wrap`.
- Verification: `npm run build`.
