# Persistence clearance bug: vertical tracer-bullet patch plan

Date: 2026-07-28

## Working diagnosis

The dangerous path is the collection read fallback in `src/public/server.js`:

- `readSubSegItems()`, `readAudSegItems()`, and `readAudEpItems()` catch every filesystem and JSON error.
- They return `[]` for both “file does not exist” and “file exists but is temporarily unreadable/corrupt”.
- A caller then performs a normal save using that empty array and overwrites valid persisted data.

The first patch should target this shared boundary. `grpSel` is not part of this tracer bullet.

## Minimal vertical slice

1. Reproduce and capture the failure

   - Back up the disposable test JSON files in-memory or to a temporary test path.
   - Exercise a normal `POST /api/subSegs/items` save while the subSeg JSON is malformed or unavailable.
   - Confirm current behavior: the request succeeds or proceeds far enough to write `[]`.
   - Confirm the same read/write shape for audSegs and audEps.

2. Make collection reads fail closed

   - Change the three collection readers so `ENOENT` returns `[]` only when the collection has never been created.
   - For all other errors, including JSON parse errors and non-array JSON, throw an error with the collection/file name.
   - Do not return `[]` as a recovery value for an existing unreadable file.
   - Let the existing request boundary return a 5xx response; never enter mutation logic with an unknown collection state.

3. Make the write boundary atomic for the touched collections

   - Route `writeSubSegItems`, `writeAudSegItems`, and `writeAudEpItems` through the existing `atomicWriteJsonFile` helper.
   - Keep explicit user-requested clears valid: an intentional `write...Items([])` remains allowed because it originates from a successful read or a dedicated clear endpoint.
   - Do not add a “reject empty arrays” guard; that would break legitimate deletion/clear operations and hide intent rather than fix the bad read fallback.

4. Add one narrow regression check

   - Add a small runnable Node check or endpoint-level script that:
     1. writes a non-empty fixture,
     2. makes the fixture malformed or unreadable,
     3. attempts a save,
     4. asserts the request fails, and
     5. asserts the original file is not replaced with `[]`.
   - Also assert that an explicit clear endpoint still produces an empty collection.

5. Verify the real app path

   - Start the server, save a subSeg, reload it, and confirm persistence.
   - Test a malformed-file save and inspect both HTTP response and file contents.
   - Test audSeg group capture/ungroup afterward to prove the shared read boundary did not alter `grpSel` behavior.
   - Check `git diff` and preserve all unrelated dirty workspace changes.

## Out of scope for this slice

- No chin-disambiguation queue redesign yet. Its stale-write risk remains a follow-up after the empty-fallback overwrite is eliminated.
- No grpSel behavior change. Its old-group removal is intentional and should be tested, not rewritten speculatively.
- No collection-data reset or migration.

## Success condition

An existing collection read failure produces a visible failed request and leaves the last valid JSON untouched; only an explicit clear path can persist `[]`.
