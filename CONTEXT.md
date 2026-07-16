# Context

| Term | Definition |
| --- | --- |
| `audEp` | An audio episode item in the list, backed by `src/backend/data/audEps/items.json`. |
| `audEp id` | The stable `_id` on an `audEp`; it is the base id for that episode's `audSeg` and `subSeg` chain. |
| `audEp list` | The main list rendered in the canvas for `audEp` items. |
| `addAudEp button` | The `+` button used to add or upload a new `audEp`. |
| `settings button` | The top-right gear button that opens the placeholder settings popover. |
| `settings popover` | The empty dropdown panel anchored to the settings button and currently showing `no options yet..`. |
| `ethereal seed item` | A non-data-driven placeholder list item shown when the list needs a starter entry. |
| `cycle targeting` | Keyboard-driven selection movement through list items. |
| `entered state lock` | The expanded inline panel state on a targeted `audEp` after pressing `Enter`. |
| `audSegs` | The empty segment list rendered inside an entered `audEp`, currently shown with placeholder text. |
| `audSegs collection` | The backend data collection scaffold in `src/backend/data/audSegs`. |
| `audSeg parent ref` | The `audEpIndex` field that ties an `audSeg` record to its parent `audEp`. |
| `audSeg card row` | The wrapped flexbox card layout used to show up to three `audSeg` items per row. |
| `audSeg item` | A single card inside the `audSegs` row layout. |
| `audSeg id` | The stable `_id` assigned to an `audSeg`; it is the foreign key for `subSeg` content. |
| `audSeg derived id` | The chained `audSeg` id format `\`${audEpId}-${audSegOrdinal}\`` used by the new scheme. |
| `audSeg targeting` | Keyboard focus/selection cycling across `audSeg` cards while inside entered state. |
| `audSeg target indicator` | The blue outline used to show the currently targeted `audSeg` card. |
| `audSeg row jump` | `Ctrl+ArrowUp/Down` moves `audSeg` targeting by whole visual rows of 3 cards inside entered `audEp` state. |
| `lol overlay` | The centered faded `lol` text rendered on the page background. |
| `audSeg capture flow` | Shift creates a tentative `audSeg`; Shift+Space commits its end time and saves it. |
| `audSeg add action` | The wired capture/save flow that creates an `audSeg`, stores its parent reference, and rerenders the parent `audEp`. |
| `audSeg playback lock` | The entered-state mode where Enter on a targeted `audSeg` seeks audio to the segment start and keeps playback wrapped within that segment's time range. |
| `shift-release cancel` | The auto-removal of a tentative `audSeg` draft when `Shift` is released without committing it with `Shift+Space`. |
| `entered audSeg state` | The locked `audSeg` row mutation applied after Enter, distinct from the temporary targeted state used while cycling with arrows. |
| `subSeg list` | The list rendered under an entered `audSeg`'s time text, seeded with a root editor row and persisted non-root child rows ordered directly under their linked parent subSeg. |
| `subSeg root row` | The persistent `subSeg` editor row with `isRoot: true` that owns the main text for an entered `audSeg`. |
| `subSeg cycle row` | A non-root `subSeg` editor row with `isRoot: false` and `linkTargetLangUnitId`, initialized from a committed `langUnit` target and kept visible after reload once saved. |
| `subSeg tree order` | The render order where a linked child subSeg appears immediately after the subSeg that owns its target langUnit bubble, recursively for arbitrary nesting depth. |
| `subSeg parent link` | The required `linkTargetLangUnitId` edge on every non-root subSeg; it points to the langUnit bubble that owns that child row, while `parentSubSegId` stores the owning subSeg row explicitly for canonical langUnit ids. |
| `subSeg parent snapback` | `Ctrl+Backspace` from a non-root subSeg focuses only the direct parent subSeg that owns its `linkTargetLangUnitId`, one parent step at a time, with no fallback jump. |
| `subSeg descendant expansion` | A child subSeg subtree and all of its descendants are visible only while the ancestor langUnit bubble that owns the branch is cycle-targeted; sibling branches stay collapsed. |
| `subSegId` | The stable `_id` assigned to a persisted `subSeg` row; root and non-root child rows each need their own `subSegId`. |
| `subSeg derived id` | The chained `subSeg` id format `\`${audSegId}-${subSegOrdinal}\`` used by the new scheme. |
| `subSeg editor` | The contenteditable host inside the seed `subSeg` item that accepts text, saves on debounce, and keeps Enter as a newline. |
| `subSeg editor height` | The editor grows with its content instead of staying collapsed to a fixed line box. |
| `subSeg autosize` | The editor height is recalculated from its content on render and input so it grows and shrinks without an internal scrollbar. |
| `langUnit bubble` | The inline pill span used to wrap captured text inside the subSeg editor. |
| `remote section` | A non-contiguous span that belongs to the same `langUnit bubble` group as an anchor bubble, rendered with bubble styling plus a dotted connector back to the anchor. |
| `linked bubble group` | The set of contiguous and remote `langUnit` spans that share one cycle-target index and are treated as one logical capture unit. |
| `dotted connector` | The subtle dotted underline used to visually link a remote section back to its anchor `langUnit bubble`. |
| `langUnit instance` | One persisted reverse-link record inside a `langUnit.instances` array; it carries `audSegId`, `subSegId`, `start`, `end`, `remote`, `context`, `target`, and any extra occurrence metadata needed. |
| `langUnit ref` | Legacy shorthand for `langUnit instance`. |
| `langUnit extension` | A new `langUnit` created from a selected substring while a cycle-target is active; its context instance stores the shared `cycleGroupId`. |
| `langUnit cycle group` | The shared group identifier stored on context-bound instances so cycle targeting and dotted underline rendering treat linked langUnits as one group. |
| `langUnit reuse by target-text` | The creation rule that reuses an existing `langUnit` record when the selected bubble has the same normalized `target.type` and trimmed `target.text`. |
| `langUnit target-text canonicalization` | The storage rule that collapses identical `target.type + target.text` pairs into one `langUnit` record and rewrites saved `subSeg` references to the canonical `langUnitId`. |
| `cross-audSeg canonical child` | A non-root `subSeg` linked by `linkTargetLangUnitId` to a canonical `langUnit`; the same child row is projected under matching `langUnit` occurrences in any `audSeg`, with `parentSubSegId` used only as visible focus context. |
| `langUnit add badge` | The tiny round count badge on a `langUnit bubble` that shows how many direct references belong to that `langUnit`. |
| `langUnit add list` | The collapsible side list beside an active `langUnit bubble` that shows other reference locations for that `langUnit` and their context text. |
| `langUnit add links` | The in-memory reverse-link list for a `langUnit` record that stores which `audSeg`/`subSeg` pairs contain its direct references; it is derived from subSeg content and not persisted. |
| `langUnit capture jump` | The click action on a `langUnit capture list` item that exits the current editor state and jumps to the referenced `audSeg` and bubble. |
| `subSeg bubble` | Deprecated previous name for the `langUnit bubble`. |
| `subSeg ref content` | The saved `subSeg` payload model that stores text tokens plus `langUnit` references instead of persisting bubble HTML directly. |
| `normalized langUnit model` | The target storage design where `langUnit` owns the lexical text and metadata while `subSeg` stores only lightweight occurrence pointers. |
| `pointer-only langUnitRef` | The intended `subSeg.content` reference shape that keeps only `langUnitId` plus non-lexical occurrence metadata such as `remote`. |
| `langUnit occurrence binding` | One saved link from a `subSeg` capture to a `langUnit`, counted as an occurrence rather than a new lexical identity. |
| `langUnits collection` | The backend scaffold under `src/backend/data/langUnits` for reusable bubble text records. |
| `langUnit item` | A reusable text record referenced by `subSeg` bubble spans through `data-langunit-id` and saved `langUnitRef` tokens; it owns `text`, `root`, and `instances`, with context living on the instances. |
| `langUnit derived id` | The chained `langUnit` id format `\`${subSegId}-${langUnitOrdinal}\`` used by the new capture scheme. |
| `langUnit reverse link` | The stored list of occurrence bindings that point back to a `langUnit` from its `subSeg` locations; the runtime now treats these as `instances`. |
| `langUnit context` | The immediate sentence or line substring around a specific `langUnit instance`, persisted on the instance record rather than the parent `langUnit`. |
| `langUnit context object` | The persisted occurrence-context shape with `{ text, type }`, attached to a `langUnit instance` and where `type` is one of `chinPhrase`, `chinWord`, `chinFuzzWord`, `engPhrase`, or `engWord`. |
| `langUnit context normalization` | The loader/save rule that recomputes an instance `context.type` from the stored text and only preserves `chinWord` for Chinese-only text. |
| `langUnit target` | The captured substring itself, persisted on the instance record alongside `context` and mirrored onto the parent `langUnit.target` so the selected text can be classified separately from its surrounding text. |
| `langUnit target object` | The persisted occurrence-target shape with `{ text, type }`, attached to a `langUnit instance` and the parent `langUnit`; `type` is one of `chinChar`, `chinWord`, `chinPhrase`, `chinFuzz`, `chinFuzzPart`, `engWordPart`, `engWord`, `engPhrase`, or `no-op`. |
| `langUnit target normalization` | The loader/save rule that stores the selected substring text, derives its target type from the substring plus `context.type` when needed, and keeps the normalized result on both the instance and the parent `langUnit`. |
| `chinChar` | A single Chinese character selected as a target. |
| `chinFuzz` | A target that is Chinese-plus-Latin or pinyin-shaped in a mixed context where the selection should stay tied to Chinese-style capture rules. |
| `chinFuzz equals gloss` | Direct child `subSeg` lines starting with `=` instantly override only the corresponding parent `chinFuzz` `langUnit` bubble's displayed text with valid nonempty Chinese-only text whose character count matches the parent pinyin syllable count; multiple valid lines render joined by ` / `, and no valid lines snap back to stored `langUnit.text`. |
| `chinFuzzPart` | A mixed or pinyin-shaped target captured while the surrounding context is `chinFuzzWord`. |
| `engWordPart` | A short English-like target captured inside an `engPhrase` or `engWord` context when the selection is only part of a larger English word. |
| `no-op` | A rejected or illegal target shape, usually blank or punctuation-only text that should not produce a meaningful capture classification. |
| `chinWord` | A single Chinese lexical unit, used when the chin disambiguation flow decides a `langUnit` is narrower than a phrase. |
| `chinFuzzWord` | An ASCII-only pinyin-like target that resolves to exactly 1 syllable; multi-syllable pinyin-like text is treated as `chinPhrase` instead. |
| `chin disambiguation` | The Settings-controlled worker-backed flow that refines ambiguous Chinese instance types after save by classifying the bounded context separately from the selected target substring. |
| `instance-targeted chin disambiguation` | The save-time chin disambiguation flow that sends one ambiguous `langUnit instance` occurrence to the worker, persists `contextType` to the matched instance's `context.type`, and persists `targetType` to the matched instance's `target.type`. |
| `pinyin chinPhrase` | Pure ASCII pinyin-like context text, or mixed Chinese plus only valid pinyin syllables, that can be segmented into 2 or more valid pinyin syllables, so it is captured as `chinPhrase` instead of `chinFuzzWord` or `engPhrase`. |
| `subSeg empty reset` | Clearing all text from the subSeg editor resets any bubble targeting back to `-1` so the next typed input behaves like normal plain text. |
| `subSeg enter guard` | `Enter` while a bubble target is active opens or keeps the cycle row instead of inserting a newline. |
| `subSeg illegal-action toast` | The short worker-toast message shown when an attempted subSeg action is blocked and turned into a no-op. |
| `subSeg wrap at row width` | `subSeg` content wraps inside the row instead of widening the editor or its panel. |
| `langUnit bubble persistence` | Saving and reloading the editor markup so a captured `langUnit bubble` reappears after refresh. |
| `entered panel width lock` | The entered `audEp` panel stays width-constrained instead of growing to match subSeg content. |
| `audSeg list balance` | The `audSeg` list keeps equal horizontal padding on both sides in dev. |
| `langUnit bubble no target` | The `-1` cycle state that means no bubble is currently targeted. |
| `capture subSeg` | The Enter-key action that wraps a highlighted substring in a `langUnit bubble`. |
| `bubble edge escape` | The double-space escape that moves the caret out of a `langUnit bubble` and keeps only one outside space. |
| `subSegs collection` | The backend scaffold under `src/backend/data/subSegs` for sub-segment records tied to an `audSeg`. |
| `subSeg save debounce` | The 500ms delayed save that persists `subSeg` input text to the `subSegs` collection for the selected `audSeg`. |
| `subSeg save no rerender` | Successful debounced `subSeg` saves update persistence and in-memory state without rerendering the entered `audEp` subtree, so focus stays on the input. |
| `subSeg line break persistence` | The rule that newline characters in a saved `subSeg` editor value are preserved and rerendered as visible line breaks instead of being trimmed away. |
| `subSeg bulk clear` | The settings action that deletes every persisted `subSeg` record and refreshes the entered `audEp` view. |
| `subSeg draft reset` | The settings action that clears unsaved in-memory `subSeg` draft state and cancels pending saves. |
| `langUnit bulk clear` | The settings action that clears all persisted `langUnit` records and rewrites `subSeg` content back to plain text. |
| `subSeg unload flush` | The `pagehide` fallback that sends any pending debounced `subSeg` text to persistence before a page reload or navigation. |
| `dev reload tone` | The short 880Hz chime that plays on Vite dev reloads once the browser has allowed audio playback. |
| `subSeg playback hotkey` | `Ctrl+Space` while focused in a `subSeg` input toggles audio playback and other key combinations are ignored by the global shortcut layer. |
| `subSeg auto-focus` | The immediate focus jump to the `subSeg` input after Enter locks an `audSeg` into entered state. |
| `subSeg focused guard` | The document-level shortcut handler checks the focused `subSeg` input first so `Ctrl+Backspace` exits entered `audSeg` state instead of deleting a word. |
| `subSeg draft mirror` | The in-memory text cache keyed by `audSegId` that keeps the current input value visible across rerenders until the debounced save flushes it to persistence. |
| `frontend` | The `src/frontend` directory that holds the app's HTML entry point. |
| `public` | The `src/public` directory that holds the Node server entry point. |
| `tentative audSeg` | A temporary in-memory `audSeg` draft shown during capture before persistence. |
| `pbNow` | The current playback time read when starting an `audSeg` capture. |
| `ctrl+backspace target reset` | `Ctrl+Backspace` clears `audEp` cycle targeting back to `-1` and closes any delete dialog; `Delete` opens the delete confirm dialog for the targeted `audEp`. |
| `delete confirm dialog` | The in-item confirmation state shown before deleting an `audEp`. |
| `audSeg delete dialog` | The in-row confirmation state shown before deleting an `audSeg`. |
| `audSeg delete confirm` | The confirm action that deletes the targeted `audSeg` and its dependent `subSeg` data. |
| `functionalityStatus` | Per-note lifecycle record that tracks whether the note's described functionality is active, retired, or partially active, plus what remains, what is missing, and what replaced it. |
| `functionalityStatus maintenance skill` | The skill used to update `functionalityStatus` records as runtime behavior changes. |
| `edit-notes store` | The persisted note file tree under `mgmt/edit-notes`, with `notes.json` as the source of truth for saved selector notes. |
| `list-unapplied-notes.mjs` | The lightweight filter script that reads `notes.json` and prints only falsey or missing `applied` notes to stdout. |
| `sidebar targeting` | `Ctrl+click`-based selector capture for elements inside the edit-notes sidebar itself, used to add notes about the sidebar's own components and behavior. |
| `selector chain` | The clickable breadcrumb trail in the edit-notes sidebar that switches the active note target to an ancestor selector. |
| `dist build output` | The production Vite output tree under `mgmt/dist`. |
| `active` | The described behavior still exists in the current runtime. |
| `retired` | The described behavior no longer exists in the current runtime. |
| `partially active` | Some described behavior remains, with the missing parts and replacements recorded separately. |
| `rich input` | The editable item input that supports text editing behavior beyond a plain placeholder. |
| `codex CLI worker` | The checkbox label inside the settings popover for the long-lived Codex CLI worker. |
| `codex word root inference` | The checkbox-controlled flow that asks the Codex worker to fill in a langUnit's `root` after creation. |
| `codex worker` | The mini-module under `mgmt/codex-worker` that keeps one long-lived Codex CLI terminal session alive for scripted prompt/response work. |
| `codex worker context-type request` | The worker request mode that asks Codex to return `chinWord` or `chinPhrase` for an ambiguous Chinese context. |
| `prompt-shaped root inference` | The worker prompt wording and examples that steer Codex to return the English base/root directly, instead of relying on local suffix-stripping code. |
| `codex worker status toast` | The tiny bottom-left viewport toast that reports worker readiness and payload completion. |
| `single English word target` | The root-inference guard that allows only one ASCII word token to trigger worker lookup. |
| `worker terminal` | The spawned Node-managed terminal process that hosts the Codex CLI worker and exposes stdin, stdout, and stderr for monitoring. |
| `discern-languageUnit-root` | The planned tailored skill that reads `context` and `target` strings plus a substring and returns the resolved `langUnitRoot`. |
| `langUnitRoot` | The final resolved language-unit root string returned by the worker in the envelope `{res: ${langUnitRoot}}`. |
| `langUnit root` | The persisted inferred root string on a `langUnit` record. |
| `same codex thread` | The single persisted Codex conversation/session the worker reuses across requests instead of starting a fresh one per run. |
| `worker request` | One JSON payload with `context`, `target`, and `substring` consumed by the codex worker. |
| `worker session id` | The stored Codex thread id reused by `resume` for the next request in the same worker process. |
| `worker line mode` | The tty mode where each JSON line is treated as one worker request and one envelope is printed back. |
| `startup probe` | The literal `test` message the codex worker sends to itself on `npm run dev` or `npm start` before it accepts user input. |
| `startup probe complete` | The point after the startup `test` round trip returns and the worker is ready for normal requests. |
