# Time tracking: phased vertical tracer-bullet plan

## Outcome

Persist cumulative usage time with one reusable tracker that samples elapsed wall-clock time from a monotonic browser clock, attributes each sample to the current page/audio/entity context, and sends compact deltas to the server.

Tracked totals:

1. page open time
2. active page time
3. audEp playtime
4. active audEp playtime
5. audSeg playtime
6. audSeg group playtime
7. active audSeg playtime
8. subSeg playtime
9. active subSeg playtime

`active` means the page is visible and has received a qualifying user signal within a configurable inactivity window. Audio time is counted only while the relevant media element is genuinely playing. A single elapsed sample may contribute to multiple nested scopes: page → audEp → audSeg/group → subSeg.

## Data shape decision

Use one new collection rather than adding mutable counters to every existing entity shape:

`src/backend/data/timeTracking/items.json`

Each record is an aggregate bucket:

```json
{
  "_id": "audSeg:aud-seg-id",
  "scopeType": "page | audEp | audSeg | audSegGroup | subSeg",
  "scopeId": "stable-id-or-page",
  "parent": {
    "audEpId": "optional",
    "audSegId": "optional",
    "grpId": "optional"
  },
  "totals": {
    "openMs": 0,
    "activeMs": 0,
    "playMs": 0,
    "activePlayMs": 0
  },
  "updatedAt": "ISO timestamp"
}
```

Rules:

- `page` uses `scopeId: "app"`; its `openMs` and `activeMs` satisfy page open/active page time.
- `audEp` uses `playMs` and `activePlayMs`.
- `audSeg`, `audSegGroup`, and `subSeg` use `playMs` and `activePlayMs`.
- Unused metric fields remain zero so one generic accumulator/API handles every scope.
- `audSegGroup` is necessary because `grpId` is currently only membership metadata on individual `audSeg` records; group playback is an interval envelope, not safely derivable from member totals.
- Existing `audEp`, `audSeg`, `subSeg`, and `langUnit` shapes stay focused on domain data. Their stable ids are referenced by tracking records.
- Keep the schema permissive/additive so new scopes or metrics can be introduced without rewriting old records.

## Reusable infrastructure

Create a small frontend tracker module, preferably `src/timeTracking.js`, with no DOM-specific knowledge:

- `createTimeTracker({ clock, flush, idleAfterMs, sampleEveryMs })`
- `signalActivity(kind, at?)`
- `setVisibility(isVisible)`
- `setContext(context)`
- `tick(at?)`
- `flush({ reason })`
- `stop()`

The tracker owns monotonic elapsed calculations using `performance.now()`, visibility and idle state, a pending delta map keyed by `scopeType + scopeId`, flush coalescing, protection against negative/duplicate elapsed intervals, and pagehide/hidden flushing.

The context adapter supplies only normalized facts:

```js
{
  pageVisible,
  playing,
  audEpId,
  audSegId,
  audSegGroupId,
  subSegId
}
```

The tracker derives page open/active time and nested playtime attribution. One sample can increment page → audEp → audSeg/group → subSeg when each scope is active.

## Phased vertical tracer bullets

### Phase 1 — persistence seam and one page metric

Deliver one end-to-end slice: visible page time and active page time survive a reload.

- Add `timeTracking` schema and empty collection file.
- Add server read/merge/atomic-write helpers using the existing JSON write conventions.
- Add `POST /api/timeTracking/deltas` accepting a batch of `{ scopeType, scopeId, parent, totals }` deltas.
- Validate scope type, ids, finite non-negative integer deltas, and cap unreasonable payloads.
- Merge deltas by stable scope key; never replace existing totals.
- Add tracker signals for `visibilitychange`, `focus`, `blur`, `pointerdown`, `pointermove`, `keydown`, `input`, `wheel`, `touchstart`, and `scroll`.
- Use a 30-second idle threshold as the initial constant; activity signals reset it.
- Sample around every 1 second, flush around every 10 seconds, and flush immediately on hidden/pagehide.
- Acceptance: opening increments `app.openMs`; interaction increments `app.activeMs`; background time increments neither; refresh continues totals.

### Phase 2 — audEp playback attribution

Extend the same tracker to count the existing `Audio` lifecycle without changing playback behavior.

- Set tracker context from `handleAudioPlay`, `handleAudioStop`, `pauseOtherAudio`, and audio reset paths.
- Treat actual `!audio.paused && !audio.ended` as playing, not merely a requested play action.
- Resolve stable `audEpId` from the existing audio index/item lookup.
- Flush the previous context before replacing it on switch, pause, or reset.
- Acceptance: ordinary episode playback increments only that audEp `playMs`; page activity during playback controls `activePlayMs`; seeking does not create time.

### Phase 3 — audSeg and audSeg-group attribution

Add segment and group metrics using the existing playback range calculations.

- Expose one pure resolver from current audio time to `{ audSegId, audSegGroupId }`.
- Count `audSeg` time only while current time lies within that segment's effective range.
- Count group time while current time lies within the group's effective envelope, including existing playback-lock envelope rules.
- On gaps between grouped segments, keep group playtime if the current group envelope includes the gap; do not assign that gap to a member segment.
- At boundaries, the next sample changes attribution; flush on lock/context changes where useful.
- Acceptance: segment playback produces audEp + segment totals; grouped playback produces audEp + group totals and member segment totals only inside each member; loops count once per loop.

### Phase 4 — subSeg attribution

Add the most specific scope using the existing editor/playback relationship.

- Record the `subSegId` that initiated `toggleSubSegAudEpPlayback(editor)` as the playback source context.
- Preserve that source while playback continues; clear it on pause/end, explicit episode playback, segment-lock changes, or a different source.
- For subSeg-started playback, count nested audEp, audSeg/group, and subSeg totals when their ranges qualify.
- Define subSeg playtime as playback attributed to that editor source, not time merely spent with the editor focused.
- Acceptance: `Ctrl+Space` in a subSeg increments that subSeg plus parent scopes; page activity controls `activeSubSegMs`; playback started elsewhere does not credit the focused editor.

### Phase 5 — durability, batching, and recovery

Make the tracker safe under normal browser lifecycle and network failure.

- Keep deltas in memory until acknowledged; failed flushes merge into the next batch.
- Use `navigator.sendBeacon` for pagehide as best effort, with normal `fetch` batching during runtime.
- Include a client/session batch id if needed for server idempotency; prefer additive deltas with dedupe over frequent full-record writes.
- Do not clear tracking records when audEp/audSeg/subSeg collections are cleared; add an explicit tracking-clear action later if needed.
- Acceptance: intermittent failures do not lose sampled in-memory deltas; repeated pagehide delivery cannot double-apply a batch.

### Phase 6 — observability and reusable adoption points

Expose the infrastructure for future scopes without adding UI prematurely.

- Add `GET /api/timeTracking/items` for diagnostics and later reporting.
- Add a debug-only summary hook for pending deltas, last flush, active context, and idle/visible state.
- Document the adapter contract and scope rules in `CONTEXT.md` after implementation.
- Add focused tests for delta merging, idle/visibility transitions, nested attribution, segment boundaries, group gaps, and failed-flush retry.
- Keep reporting separate from accumulation so later features consume the same records.

## Verification order

1. Static shape/API checks and schema validation.
2. Unit checks for tracker clock/idle/visibility math with a fake monotonic clock.
3. Browser smoke check for page open/active accumulation and reload persistence.
4. Playback smoke check for audEp, segment, group, and subSeg attribution, including pause, seek, loop, tab hide, and pagehide.
5. Inspect `timeTracking/items.json` to confirm only expected aggregate deltas changed and existing collection data was not rewritten.

## Deliberate non-goals for the first tracer bullet

- No per-event history; aggregate deltas keep writes small and satisfy running totals.
- No modification of existing domain records; stable references provide the join without coupling counters to content mutations.
- No inference of subSeg time from focus alone; attribution follows explicit subSeg playback source to avoid misleading totals.
