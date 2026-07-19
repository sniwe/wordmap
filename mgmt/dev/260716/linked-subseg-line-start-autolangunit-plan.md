# Linked subSeg Line-Start Auto-langUnit Plan

## Goal

In a non-root `subSeg` linked to a parent `langUnit`, let a user type a Chinese character at the start of a line and press Space to auto-wrap that character as a new `langUnit` when it is part of the parent target text and the parent target is `chinWord` or `chinPhrase`.

Example: parent target `小伙子`, child line starts with `小`, Space creates a `小` bubble and leaves the user-entered space after it. Child line starts with `你`, Space stays normal text.

## Phase 1 - Runtime Detection

- Add a narrow helper for the focused `subSeg` editor:
  - editor is non-root.
  - editor has `data-link-target-langunit-id`.
  - linked parent `langUnit.target.type` is `chinWord` or `chinPhrase`.
  - caret is collapsed after exactly one Chinese character at the current line start.
  - that character is included in `langUnit.target.text`.
- Return `null` unless every condition matches.

Acceptance:

- `小|` in a child of parent target `小伙子` returns a match.
- `你|` in the same child returns no match.
- `abc 小|`, middle-of-line `小|`, selected text, and root subSeg input return no match.

## Phase 2 - Space-Key Hook

- In the existing focused-subSeg Space handling path, call the detector before `handleLangUnitBubbleSpace`.
- If matched, prevent the browser default space insertion.
- Wrap only the matched character into a `langunit-bubble`.
- Insert one normal text space after the bubble from the same user Space press.
- Place the caret after that inserted space.
- Call `syncSubSegEditorDraft(editor)`.

Acceptance:

- Typing `小` does nothing until Space.
- Pressing Space transforms `小` into a bubble followed by one plain space.
- No synthetic double-space escape is fired.

## Phase 3 - Reuse Existing Capture Shape

- Reuse the existing `wrapSelectedSubSegText` data model where possible:
  - derived `langUnitId` from current child `subSegId`.
  - canonical lookup by target via `getLangUnitItemByCanonicalTarget`.
  - bubble dataset fields compatible with `extractSubSegEditorPayload`.
- Keep the new logic local to line-start character capture; do not change manual selection capture.

Acceptance:

- Save payload stores `{ type: "langUnitRef", langUnitId }` for the auto-created bubble.
- The new `langUnit` has target text `小` and normal instance/context data after save.

## Phase 4 - Linked Parent Constraints

- Resolve parent target through the child editor's `data-link-target-langunit-id`.
- Use the canonical cycle target id only if the current data model requires it for linked groups.
- Match by actual parent target text, not rendered bubble text, so display overrides do not affect detection.

Acceptance:

- Parent target `小伙子` allows line-start `小`, `伙`, or `子`.
- Parent target `小伙子` does not allow `你`.
- Parent target types other than `chinWord` or `chinPhrase` do not trigger.

## Phase 5 - Verification

- Manual runtime test:
  - create parent subSeg text `你好，小伙子`.
  - capture `小伙子`.
  - cycle target it and press Enter into the linked child subSeg.
  - type `你` then Space: plain text only.
  - new line, type `小` then Space: `小` becomes a bubble plus one trailing plain space.
- Persistence test:
  - wait for save, reload, confirm bubble and line breaks render intact.
  - confirm `src/backend/data/subSegs/items.json` keeps line breaks as text tokens.
  - confirm `src/backend/data/langUnits/items.json` has the new `小` unit and instance.
- Run `npm run build`.

