# Chin Disambiguation Tracer Bullet Plan

Date: 2026-07-16

## Current Check

- App build passes: `npm run build`.
- Codex worker smoke test passes: `npm test` in `mgmt/codex-worker`.
- Direct `contextType` worker calls run successfully.
- Direct worker results for planned test selections all returned `chinPhrase`:
  - `U+8349 U+6CE5 U+9A6C` / cao-ni-ma -> `chinPhrase`
  - `U+64CD U+4F60 U+5988` / cao-ni-ma -> `chinPhrase`
  - `U+4F60 U+597D U+4E16 U+754C` / ni-hao-shi-jie -> `chinPhrase`
  - `U+4F60 U+597D` / ni-hao inside ni-hao-shi-jie -> `chinPhrase`
  - `U+4E16 U+754C` / shi-jie inside ni-hao-shi-jie -> `chinPhrase`

## Capability Verdict

- Current setup is wired but not yet correctly capable.
- It can run the Codex CLI worker and receive `contextType` responses.
- It can write a returned type into persisted langUnit data.
- It is not reliable for correct disambiguation because the prompt currently biases broad and returned `chinPhrase` for every checked case.
- It is not structurally correct for repeated langUnit selections because persistence updates only `instances[0].context.type`, while the ambiguous occurrence may be any instance.
- The UI save response returns before background disambiguation completes, so the browser state will not see the corrected type until a later reload/fetch.

## Minimal Vertical Tracer Bullet

### Phase 1: Deterministic Worker Contract

- Add a non-Codex test seam for `contextType` so persistence can be tested without waiting on live model output.
- Keep production worker behavior unchanged.
- Expected proof:
  - Given fake worker result `{ "res": "chinWord" }`, the app persists exactly that result.

### Phase 2: Instance-Targeted Persistence

- Pass occurrence identity into disambiguation:
  - `langUnitId`
  - `instance` key fields: `audSegId`, `subSegId`, `start`, `end`, `cycleGroupId`
  - `context.text`
  - `target.text`
- Update the matching `instances[n].context.type`, not always `instances[0]`.
- Re-normalize that same instance target.
- Recompute parent `langUnit.target` from the canonical/primary instance only after the instance update.
- Expected proof:
  - A langUnit with two `U+4E16 U+754C` / shi-jie instances can update the second instance without changing the first.

### Phase 3: Candidate Selection

- Iterate candidate instances, not candidate langUnits.
- Candidate rule:
  - current instance `context.type === "chinPhrase"`
  - context, target, and substring contain Chinese characters
  - target is not punctuation/symbol-only
- Expected proof:
  - One `U+4E16 U+754C` / shi-jie occurrence can remain `chinWord` while another occurrence can still be considered independently.

### Phase 4: Prompt Tightening

- Revise `contextType` prompt with short examples and decision rules:
  - single lexicalized word/expression -> `chinWord`
  - whole clause/sentence or multiword span -> `chinPhrase`
  - evaluate the selected target inside context, not the whole context alone
- Add live smoke examples:
  - `U+8349 U+6CE5 U+9A6C` / cao-ni-ma should be expected `chinWord`
  - `U+64CD U+4F60 U+5988` / cao-ni-ma can be expected `chinPhrase` or intentionally documented if treated as lexicalized phrase
  - `U+4F60 U+597D U+4E16 U+754C` / ni-hao-shi-jie should be `chinPhrase`
  - `U+4F60 U+597D` / ni-hao should be `chinWord`
  - `U+4E16 U+754C` / shi-jie should be `chinWord`
- Expected proof:
  - Worker returns a mix of `chinWord` and `chinPhrase` for the example set.

### Phase 5: UI Refresh After Background Save

- Add the smallest refresh path after background disambiguation:
  - either return pending disambiguation result in the save response after awaiting it,
  - or expose a cheap `/api/langUnits/items` refresh after worker completion.
- Prefer awaiting only for explicit tracer tests; keep normal UI background behavior if latency is too high.
- Expected proof:
  - After save, UI-visible langUnit state reflects persisted disambiguated context type without manual page reload.

### Phase 6: End-to-End Test Script

- Add one narrow script that:
  - backs up `langUnits/items.json` and `subSegs/items.json`
  - seeds a tiny subSeg with the five test selections
  - runs disambiguation through the server path
  - reads persisted langUnits
  - prints each instance context type
  - restores the original data files
- Expected proof:
  - Persistence is demonstrated without leaving test data behind.

## Done Criteria

- Worker returns differentiated results for the five Chinese selections.
- Server persists returned type to the matched langUnit instance.
- Repeated selections of the same langUnit text can have independent context types.
- UI can observe the updated type after save or through a documented refresh path.
