# Chin Target/Context Disambiguation Tracer Plan

Date: 2026-07-16

## Problem Correction

- Current worker result is wired to `langUnit.instances[n].context.type`.
- That is the wrong primary destination for the ambiguous result.
- `context.type` describes the whole bounded context span:
  - `chinPhrase` for a Chinese sentence/phrase-sized bound.
  - `chinWord` for a Chinese word-sized bound.
  - `engPhrase`, `engWord`, etc. for non-Chinese bounds.
- `target.type` describes the selected langUnit substring.
- Therefore Chinese disambiguation needs a two-field result:
  - `contextType`: classification of the bounded context text.
  - `targetType`: classification of the selected substring inside that context.
- Persistence must update the matched instance target, and only update context when the worker explicitly confirms the bounded context type differs.

## Phase 1: Rename The Contract In Place

- Keep the worker task name `contextType` for compatibility during the tracer.
- Change its logical contract from "return one Chinese type" to "return context and target types".
- New envelope:
  - `{ "res": { "contextType": "chinPhrase", "targetType": "chinWord" } }`
- Compatibility fallback:
  - If old worker output is `{ "res": "chinWord" }`, treat it as `targetType`.
  - Derive `contextType` locally from existing `context.text` unless the new object is present.
- Expected proof:
  - Existing callers do not crash.
  - New callers can read both fields.

## Phase 2: Prompt Update

- Revise the worker prompt to classify two things separately:
  - bounded `context` text.
  - selected `target` / `substring` text.
- Prompt rules:
  - `contextType` follows existing bounding rules and usually remains `chinPhrase` for sentence-like Chinese context.
  - `targetType` answers whether the selected substring is `chinWord`, `chinPhrase`, `chinChar`, or `no-op`.
  - Never use the surrounding sentence length alone to decide `targetType`.
- Example expectations:
  - `U+8349 U+6CE5 U+9A6C U+662F U+4E00 U+79CD U+9A6C U+5417` / cao-ni-ma-shi-yi-zhong-ma-ma + target `U+8349 U+6CE5 U+9A6C` / cao-ni-ma -> `{ contextType: "chinPhrase", targetType: "chinWord" }`
  - `U+64CD U+4F60 U+5988 U+4E0D U+662F U+6587 U+660E U+4EBA U+8BF4 U+7684` / cao-ni-ma-bu-shi-wen-ming-ren-shuo-de + target `U+6587 U+660E U+4EBA` / wen-ming-ren -> `{ contextType: "chinPhrase", targetType: "chinWord" }`
  - `U+64CD U+4F60 U+5988 U+4E0D U+662F U+6587 U+660E U+4EBA U+8BF4 U+7684` / cao-ni-ma-bu-shi-wen-ming-ren-shuo-de + target `U+64CD U+4F60 U+5988` / cao-ni-ma -> `{ contextType: "chinPhrase", targetType: "chinPhrase" }`
  - `U+4F60 U+597D U+4E16 U+754C` / ni-hao-shi-jie + target `U+4F60 U+597D U+4E16 U+754C` / ni-hao-shi-jie -> `{ contextType: "chinPhrase", targetType: "chinPhrase" }`
  - `U+4F60 U+597D U+4E16 U+754C` / ni-hao-shi-jie + target `U+4F60 U+597D` / ni-hao -> `{ contextType: "chinPhrase", targetType: "chinWord" }`
  - `U+4F60 U+597D U+4E16 U+754C` / ni-hao-shi-jie + target `U+4E16 U+754C` / shi-jie -> `{ contextType: "chinPhrase", targetType: "chinWord" }`
- Expected proof:
  - Worker self-test asserts the new object shape.

## Phase 3: Server Persistence Wiring

- Replace `inferLangUnitContextType` with a narrowly renamed path such as `inferLangUnitChineseTypes`.
- Keep instance targeting by:
  - `langUnitId`
  - `audSegId`
  - `subSegId`
  - `cycleGroupId`
  - `start`
  - `end`
- Update matched `instances[n]`:
  - `instances[n].context.type = result.contextType` only when provided and valid.
  - `instances[n].target.type = result.targetType` when provided and valid.
  - Preserve `instances[n].context.text`.
  - Preserve `instances[n].target.text`.
- Recompute parent `langUnit.target` from the primary/canonical instance target after the matched instance update.
- Expected proof:
  - `U+6587 U+660E U+4EBA` / wen-ming-ren can have `instance.context.type === "chinPhrase"` and `instance.target.type === "chinWord"`.
  - `U+8349 U+6CE5 U+9A6C` / cao-ni-ma can have `instance.context.type === "chinPhrase"` and `instance.target.type === "chinWord"`.

## Phase 4: Candidate Selection

- Continue iterating instances, not just langUnit parents.
- Candidate if:
  - context text has Chinese.
  - target text has Chinese.
  - target is not punctuation/symbol-only.
  - current `target.type` is ambiguous or broad enough to refine:
    - `chinPhrase`
    - empty/missing
    - locally derived Chinese multi-char type.
- Do not require `context.type === "chinPhrase"` as a gate for updating target.
- Expected proof:
  - A word target inside phrase context is still sent to the worker.

## Phase 5: Passive Background Save Semantics

- Keep the current collection write path passive from the user's perspective:
  - save subSeg.
  - rebuild langUnits.
  - run worker-backed refinement.
  - write langUnits.
- For tracer reliability, keep POST response returning refined `langUnits` after worker completion.
- If latency becomes annoying later, split to background write plus UI refresh/poll; do not add that now.
- Expected proof:
  - One save response includes refined `instances[n].target.type`.
  - Reloaded `langUnits/items.json` matches the response.

## Phase 6: Vertical Runtime Probe

- Add or keep a temporary verifier that:
  - backs up `subSegs/items.json`, `langUnits/items.json`, and `audSegs/items.json`.
  - posts a synthetic subSeg with tracer targets.
  - reads response and persisted collection.
  - restores backups.
- Assertions:
  - `U+8349 U+6CE5 U+9A6C` / cao-ni-ma: context `chinPhrase`, target `chinWord`.
  - `U+6587 U+660E U+4EBA` / wen-ming-ren: context `chinPhrase`, target `chinWord`.
  - `U+64CD U+4F60 U+5988` / cao-ni-ma: context `chinPhrase`, target `chinPhrase`.
  - `U+4F60 U+597D U+4E16 U+754C` / ni-hao-shi-jie: context `chinPhrase`, target `chinPhrase`.
  - `U+4F60 U+597D` / ni-hao: context `chinPhrase`, target `chinWord`.
  - `U+4E16 U+754C` / shi-jie: context `chinPhrase`, target `chinWord`.

## Done Criteria

- Worker returns an object with separate `contextType` and `targetType`.
- Old single-string worker responses remain tolerated during transition.
- Matched `langUnit.instances[n].target.type` is the primary disambiguation destination.
- Matched `langUnit.instances[n].context.type` still describes the bounded context.
- Parent `langUnit.target.type` mirrors the canonical/primary instance target.
- Real server probe proves response and persisted collection agree.
