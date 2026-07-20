# subSeg Linked Recall Tracer Bullet Plan

## Symptom

Selecting/cycling the `钱` langUnit in subSeg `5e315e33-ee8a-4d3b-935c-da79da19d333-1-1` created/opened an empty child subSeg instead of recalling the existing linked child content `money` from subSeg `5e315e33-ee8a-4d3b-935c-da79da19d333-0-5`.

## Current Failure Shape

- Existing canonical-ish `钱`: `5e315e33-ee8a-4d3b-935c-da79da19d333-0-4-0`, `target.type: chinWord`.
- New `钱`: `5e315e33-ee8a-4d3b-935c-da79da19d333-1-1-0`, `target.type: chinChar`.
- Existing child with recall content: `5e315e33-ee8a-4d3b-935c-da79da19d333-0-5`, linked to `...-0-4-0`, text `money\n`.
- Failed child: `5e315e33-ee8a-4d3b-935c-da79da19d333-1-2`, parent `...-1-1`, linked to `...-0-4-0`, empty.

## Root Cause

The UI groups/renders child subSegs by langUnit id/cycle target id, while canonicalization keeps `chinWord + 钱` and `chinChar + 钱` separate. Then `syncCycleSubSegRow()` creates a fresh empty child row for the active parent instead of projecting or cloning the existing child content for the equivalent lexical item.

## Vertical Tracer Bullet

1. Add a tiny resolver in `src/main.js` that maps a langUnit id to an equivalent recall key.
   - Start conservative: Chinese-only single-character `target.text` can match across `chinChar` and `chinWord`.
   - Keep current id behavior for everything else.

2. Use that resolver in child discovery.
   - Patch `getChildSubSegItemsForRenderedParent()` so `parentGroups` and child `linkTargetLangUnitId` compare by resolved recall key, not raw id only.
   - Expected result: an existing child linked to canonical `钱` can render under another visible `钱` occurrence.

3. Patch child creation path.
   - In `syncCycleSubSegRow(editor, true)`, before creating an empty row, search for an existing non-root child whose resolved recall key matches the active target.
   - If found, create the local projected row with copied `content` and `text`, preserving the new parentSubSegId and active link target.
   - Keep copy shallow and data-shaped: `content`, `text`, `isRoot: false`, `audSegId`, `linkTargetLangUnitId`, `parentSubSegId`.

4. Add one minimal browserless self-check.
   - Extract or simulate the resolver with fixture objects for `chinWord 钱`, `chinChar 钱`, and unrelated langUnits.
   - Assert `钱` resolves together and unrelated entries do not.

5. Manual verification.
   - Repair JSON first.
   - Open the app, enter the relevant audSeg, cycle target to `钱`, press Enter.
   - Expected: child row under `...-1-1` shows `money` with newline/line break rendering intact.

## Risk

The main risk is over-merging Chinese characters whose context should stay distinct. Keep the first patch narrow to exact single-character Chinese `target.text` only; broaden later only with evidence.
