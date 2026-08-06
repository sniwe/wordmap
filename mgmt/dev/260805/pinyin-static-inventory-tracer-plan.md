# Static pinyin syllable inventory tracer-bullet plan

Date: 2026-08-05

## Objective

Make pinyin-shaped text classification recognize the full legal Mandarin syllable inventory, including `yangzhipin`, so a parent `chinFuzz` langUnit can trigger line-initial child auto-langUnit behavior for matching Chinese glosses such as `养殖品`.

Prefer one explicit, reviewable static `Set` of legal syllable strings over the current initials/finals generator. Preserve the existing public helper behavior and keep the change limited to recognition/classification.

## Current seam

- `src/main.js` owns `countPinyinSyllables()`, `PINYIN_INITIALS`, `PINYIN_FINALS`, and `PINYIN_SYLLABLES`.
- `getLangUnitTargetType()` uses `countPinyinSyllables()` to decide whether an ASCII token is pinyin-shaped and can become `chinFuzz`.
- `getMatchingPinyinSpan()` uses the same count when matching a child Chinese gloss to a parent pinyin span.
- `getLinkedSubSegLineStartAutoLangUnitRange()` requires the linked parent target type to be Chinese-compatible, then calls `getMatchingPinyinSpan()`.
- Space-key handling calls `autoLangUnitifyLinkedSubSegLineStart()`; persistence is already downstream and should not change.

## Invariants to preserve

- `countPinyinSyllables(text)` returns `0` for invalid or partially unparseable tokens.
- Tone digits `1`–`5` remain accepted and ignored.
- Apostrophe-separated syllables remain accepted.
- Existing `chinFuzz`, `chinPhrase`, `engWord`, and `engPhrase` classification boundaries remain unchanged except where the static inventory correctly identifies previously rejected pinyin.
- Child line-break rendering and `subSeg` newline persistence remain untouched.
- No collection data is cleared or rewritten by implementation work.

## Phase 1 — Inventory proof and seam test

Add a small runnable assertion script under `mgmt/dev/260805` or extend the nearest existing verifier without changing runtime behavior.

Cover the smallest representative set:

```text
yangzhipin -> 3
chuannao -> 2
ni3hao3 -> 2
xi'an -> 2
invalidpinyin -> 0
```

Tracer gate: the current implementation demonstrably fails `yangzhipin` because `yang` is absent from the generated set; the test names the expected classification seam rather than testing DOM behavior yet.

## Phase 2 — Replace generated inventory with explicit static inventory

In `src/main.js`, replace the initials/finals construction with one frozen/read-only `Set` containing every legal base pinyin syllable, including standalone syllables and `y`/`w` forms (`ya`, `yang`, `yuan`, `wai`, etc.). Keep tone handling in `countPinyinSyllables()`.

Do not add a parser library, fuzzy matching, spelling correction, or implicit segmentation fallback. The parser remains a longest-valid-syllable scan, and a token is valid only if the entire token is consumed.

Tracer gate: the Phase 1 assertions pass, and the application still parses without changing any unrelated target-type code.

## Phase 3 — Classification vertical slice

Exercise `getLangUnitTargetType()` through the existing capture/save path with a parent selection of `yangzhipin` in its mixed Chinese context.

Expected result:

```text
target.text = yangzhipin
target.type = chinFuzz
```

Tracer gate: a newly captured `yangzhipin` no longer persists as `engWord`; existing `chuannao` behavior remains stable.

## Phase 4 — Child auto-langUnit vertical slice

Use the real linked-child interaction:

1. Parent contains `这个从饲料到yangzhipin的chuannao周期大概是3-6个月`.
2. Parent `yangzhipin` is a `chinFuzz` langUnit.
3. Child is linked to that exact parent langUnit.
4. Child line begins with `养殖品`.
5. Press Space after the line-initial value.

Expected result:

- child `养殖品` becomes a langUnit bubble;
- its derived target is persisted through the existing subSeg save payload;
- parent render replaces the matching `yangzhipin` span with `养殖品`;
- the trailing-space/caret escape behavior remains intact.

Tracer gate: the behavior works without special casing `yangzhipin` or `养殖品`.

## Phase 5 — Regression verification

Run the smallest relevant checks:

- static inventory assertions;
- existing pinyin/langUnit verifier(s) under `mgmt/dev`;
- app build/lint command from `package.json`;
- manual or browser tracer for line-initial child conversion;
- confirm `subSeg` multiline input still renders and persists line breaks.

Record failures as inventory, classification, linkage, or rendering/persistence failures so a later fix does not broaden the parser unnecessarily.

## Deliberate non-goals

- no transliteration or Hanzi-to-pinyin conversion;
- no automatic correction of misspellings;
- no support for arbitrary dialect romanization;
- no data migration for already-persisted `engWord` records unless explicitly requested;
- no changes to child lookup, save debounce, or parent replacement logic unless the vertical tracer proves a separate defect.
