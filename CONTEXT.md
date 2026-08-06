# Context

| Term | Definition |
| --- | --- |
| `audEp` | An audio episode item in the list, backed by `src/backend/data/audEps/items.json`. |
| `audEp → audSeg → subSeg → langUnit` chain | The primary data relationship: an `audEp` owns audio/media, its `audSeg` records mark timed slices, each `audSeg` owns `subSeg` editor rows, and `subSeg.content` may point at reusable `langUnit` records. |
| `audEp ownership` | An `audEp` is the top-level list item and media owner. Its stable `_id` is the preferred parent identity; `audEpIndex` remains a positional field used by capture/UI and shifted when episodes are inserted or deleted. |
| `audEp id` | The stable `_id` on an `audEp`; it is the base id for that episode's `audSeg` and `subSeg` chain. |
| `audEp list` | The main list rendered in the canvas for `audEp` items. |
| `addAudEp button` | The `+` button used to add or upload a new `audEp`. |
| `settings button` | The top-right gear button that opens the placeholder settings popover. |
| `studyBtn` | The top-left book-icon button aligned above the audEp container. |
| `settings popover` | The empty dropdown panel anchored to the settings button and currently showing `no options yet..`. |
| `ethereal seed item` | A non-data-driven placeholder list item shown when the list needs a starter entry. |
| `cycle targeting` | Keyboard-driven selection movement through list items. |
| `cycle-targeted audEp seek` | Plain Left/Right arrows seek the currently cycle-targeted `audEp` backward/forward by 5 seconds; in entered `audEp` state, Shift+Left/Right does the same for the entered target. |
| `entered state lock` | The expanded inline panel state on a targeted `audEp` after pressing `Enter`. |
| `audSegs` | The empty segment list rendered inside an entered `audEp`, currently shown with placeholder text. |
| `audSegs collection` | The backend data collection scaffold in `src/backend/data/audSegs`. |
| `audSeg parent ref` | `audSeg.audEpId` is the stable foreign key to its parent `audEp`; `audEpIndex` is the positional companion used by the UI and legacy/index-shift maintenance. |
| `audSeg data role` | A timed, ordered slice of one `audEp`, carrying `tcs`/`tce` playback bounds, optional `ssHead`, and optional contiguous-group membership. It does not own lexical text; its `subSeg` rows do. |
| `audSeg card row` | The wrapped flexbox card layout used to show up to three `audSeg` items per row. |
| `audSeg item` | A single card inside the `audSegs` row layout. |
| `audSeg id` | The stable `_id` assigned to an `audSeg`; it is the foreign key for `subSeg` content. |
| `audSeg derived id` | The chained `audSeg` id format `\`${audEpId}-${audSegOrdinal}\`` used by the new scheme. |
| `audSeg targeting` | Keyboard focus/selection cycling across `audSeg` cards while inside entered state. |
| `audSeg target indicator` | The blue outline used to show the currently targeted `audSeg` card. |
| `grpSel` | The transient contiguous audSeg range selection active while Ctrl+Shift is held and no audSeg is in entered state. |
| `grpSel anchor` | The audSeg cycle-target index where a transient group selection starts; modifier release restores this as the sole cycle target. |
| `captured audSeg group` | A persisted group of two or more contiguous audSegs sharing one `grpId` and rendered with a permanent green boundary. |
| `audSeg group id` | The shared `grpId` stored on each member audSeg; it identifies membership without persisting array indexes. |
| `audSeg group bounds` | Derived earliest member `tcs` through latest member `tce` timing interval used for automatic membership of newly added audSegs. |
| `audSeg group envelope` | The connected green border rendered around the contiguous members of a captured audSeg group. |
| `audSeg ungroup` | Backspace action that removes a captured group's shared `grpId` from all members and restores ordinary cycle targeting. |
| `audSeg row jump` | `Ctrl+ArrowUp/Down` moves `audSeg` targeting by whole visual rows of 3 cards inside entered `audEp` state. |
| `lol overlay` | The centered faded `lol` text rendered on the page background. |
| `audSeg capture flow` | Shift captures an unrounded `audio.currentTime` start into a tentative `audSeg`; Shift+Space captures and saves its unrounded end, while audSeg timing labels display `MM:SS` only. |
| `audSeg add action` | The wired capture/save flow that creates an `audSeg`, stores its parent reference, and rerenders the parent `audEp`. |
| `audSeg playback lock` | The entered-state mode where Enter on a targeted `audSeg` seeks audio to the segment start and keeps playback wrapped within that segment's time range. |
| `shift-release cancel` | The auto-removal of a tentative `audSeg` draft when `Shift` is released without committing it with `Shift+Space`, restoring the cycle target that was active before capture. |
| `entered audSeg state` | The locked `audSeg` row mutation applied after Enter, distinct from the temporary targeted state used while cycling with arrows. |
| `entered audSeg focus memory` | Session-scoped runtime memory that stores the last focused element for the currently entered `audSeg` and restores it when the browser window regains focus. |
| `subSeg list` | The list rendered under an entered `audSeg`'s time text, seeded with a root editor row and persisted non-root child rows ordered directly under their linked parent subSeg. |
| `subSeg root row` | The persistent `subSeg` editor row with `isRoot: true` that owns the main text for an entered `audSeg`. |
| `subSeg cycle row` | A non-root `subSeg` editor row with `isRoot: false` and `linkTargetLangUnitId`, initialized from a committed `langUnit` target and kept visible after reload once saved. |
| `subSeg tree order` | The render order where a linked child subSeg appears immediately after the subSeg that owns its target langUnit bubble, recursively for arbitrary nesting depth. |
| `subSeg parent link` | The required `linkTargetLangUnitId` edge on every non-root subSeg; it points to the langUnit bubble that owns that child row, while `parentSubSegId` stores the owning subSeg row explicitly for canonical langUnit ids. |
| `destination subSeg path` | The ordered parent-to-child target sequence needed after clicking a `langUnitRef` so the destination `audSeg` expands the ancestor subSeg rows before targeting the clicked nested `langUnit`. |
| `subSeg parent snapback` | `Ctrl+Backspace` from a non-root subSeg focuses only the direct parent subSeg that owns its `linkTargetLangUnitId`, one parent step at a time, with no fallback jump. |
| `subSeg descendant expansion` | A child subSeg subtree and all of its descendants are visible only while the ancestor langUnit bubble that owns the branch is cycle-targeted; sibling branches stay collapsed. |
| `subSeg ownership` | Every persisted `subSeg` carries `audSegId`; one root row represents the segment's primary editable text, while non-root rows are linked child editors rather than additional audio segments. |
| `subSeg content shape` | The persisted editor payload is token data: plain text tokens plus `{ type: 'langUnitRef', langUnitId, ... }` occurrence pointers. Rendered HTML/bubble markup is a view, not the collection's source shape. |
| `subSegId` | The stable `_id` assigned to a persisted `subSeg` row; root and non-root child rows each need their own `subSegId`. |
| `subSeg derived id` | The chained `subSeg` id format `\`${audSegId}-${subSegOrdinal}\`` used by the new scheme. |
| `subSeg editor` | The contenteditable host inside the seed `subSeg` item that accepts text, saves on debounce, and keeps Enter as a newline. |
| `subSeg editor height` | The editor grows with its content instead of staying collapsed to a fixed line box. |
| `subSeg autosize` | The editor height is recalculated from its content on render and input so it grows and shrinks without an internal scrollbar. |
| `langUnit bubble` | The inline pill span used to wrap captured text inside the subSeg editor. |
| `langUnit bubble clear` | `Ctrl+Delete` while a `langUnit bubble` is cycle-targeted in a focused `subSeg` editor unwraps that bubble back into normal editable text. |
| `auto-langUnitification` | The Space-key runtime action that auto-wraps qualifying line-start Chinese text in a linked child `subSeg` as a `langUnit bubble`; `chinChar` parents also accept any multi-character Chinese line-start candidate, while other parents require a matching character or pinyin span. |
| `auto-langUnit double-space escape` | A rapid second Space after line-start auto-langUnitification is consumed as the bubble-boundary escape, leaving the caret after the single external space rather than inside the new `langUnit bubble`. |
| `remote section` | A non-contiguous span that belongs to the same `langUnit bubble` group as an anchor bubble, rendered with bubble styling plus a dotted connector back to the anchor. |
| `linked bubble group` | The set of contiguous and remote `langUnit` spans that share one cycle-target index and are treated as one logical capture unit. |
| `dotted connector` | The subtle dotted underline used to visually link a remote section back to its anchor `langUnit bubble`. |
| `langUnit instance` | One persisted reverse-link record inside a `langUnit.instances` array; it carries `audSegId`, `subSegId`, `start`, `end`, `remote`, `context`, `target`, and any extra occurrence metadata needed. |
| `langUnit ref` | Legacy shorthand for `langUnit instance`. |
| `langUnit extension` | A new `langUnit` created from a selected substring while a cycle-target is active; its context instance stores the shared `cycleGroupId`. |
| `nested chin substring capture` | Enter on a substring selected inside a `chinWord`, `chinPhrase`, or `chinFuzz` `langUnit bubble` puts it at the first line start of the bubble's linked child `subSeg` (using the empty first line or appending a new line), wraps it as a new `langUnit bubble`, cycle-targets it, and opens its linked child `subSeg`. |
| `langUnit cycle group` | The shared group identifier stored on context-bound instances so cycle targeting and dotted underline rendering treat linked langUnits as one group. |
| `langUnit linked subSeg canonical recall` | The rule that same final `target.type + target.text` reuses one canonical `langUnitId`, appends the new witnessed context to `instances`, and makes linked child subSeg recall by that canonical id; different final target types keep different langUnits even when text matches. |
| `langUnit reuse by target-text` | The creation rule that reuses an existing `langUnit` record when the selected bubble has the same normalized `target.type` and trimmed `target.text`. |
| `langUnit target-text canonicalization` | The storage rule that collapses identical `target.type + target.text` pairs into one `langUnit` record and rewrites saved `subSeg` references to the canonical `langUnitId`. |
| `cross-audSeg canonical child` | A non-root `subSeg` linked by `linkTargetLangUnitId` to a canonical `langUnit`; the same child row is projected under matching `langUnit` occurrences in any `audSeg`, with `parentSubSegId` used only as visible focus context. |
| `cross-audEp projected subSeg chain` | A visible `subSeg` tree where a canonical linked child from one `audEp` is rendered under a matching `langUnit` occurrence in another `audEp`, and that projected child can itself render deeper linked descendants. |
| `langUnit add badge` | The tiny round count badge on a `langUnit bubble` that shows how many direct references belong to that `langUnit`. |
| `langUnit add list` | The collapsible side list beside an active `langUnit bubble` that shows other reference locations for that `langUnit` and their context text. |
| `langUnit add links` | The in-memory reverse-link list for a `langUnit` record that stores which `audSeg`/`subSeg` pairs contain its direct references; it is derived from subSeg content and not persisted. |
| `visible langUnitRef target` | The currently rendered occurrence that owns the ref list, keyed by visible `audSegId` plus canonical `subSegId`, so projected child rows do not suppress real stored destinations. |
| `langUnit capture jump` | The click action on a `langUnit capture list` item that exits the current editor state and jumps to the referenced `audSeg` and bubble. |
| `langUnitRef list traversal` | The keyboard mode where `Tab` from a cycle-targeted `langUnit` bubble moves focus into the side ref list and `Ctrl+ArrowUp/Down` cycle-targets ref rows. |
| `entered langUnitRef item` | The expanded state of a targeted `langUnitRef` list row, opened with `Enter` and collapsed with `Ctrl+Backspace`. |
| `langUnitRef graph panel` | The expanded ref-row canvas that shows collection relationships from origin to audEp, audSeg, subSeg, and langUnit contextual instance nodes. |
| `subSeg bubble` | Deprecated previous name for the `langUnit bubble`. |
| `subSeg ref content` | The saved `subSeg` payload model that stores text tokens plus `langUnit` references instead of persisting bubble HTML directly. |
| `normalized langUnit model` | The target storage design where `langUnit` owns the lexical text and metadata while `subSeg` stores only lightweight occurrence pointers. |
| `langUnit ownership` | A `langUnit` owns canonical lexical identity (`text` plus normalized `target.type`), target metadata, optional root/composition data, and reverse-link `instances`; it is not owned by one `audSeg` or one `subSeg`. |
| `langUnit instance relationship` | Each `langUnit.instances[]` entry witnesses one `subSeg` occurrence and binds it to `audSegId`, `subSegId`, offsets, context, target, and remote/cycle metadata. The backend rebuilds these reverse links from saved `subSeg.content`. |
| `langUnit canonical identity` | Reuse is keyed by normalized final `target.type + target.text`; a derived capture id is only an initial id and can be rewritten when equivalent targets are canonicalized. |
| `cross-collection data flow` | The browser loads all four collections, renders `audEp`, filters `audSeg` by parent id/index, renders `subSeg` by `audSegId`, and resolves each `langUnitRef` through `langUnits`. Saving a `subSeg` can merge langUnits, rebuild reverse instances, hydrate linked child rows, and return refreshed `subSegs` plus `langUnits`. |
| `langUnit projection` | A canonical langUnit can cause a linked non-root subSeg to render under matching occurrences in other audSegs/audEps; the stored child still has one `audSegId`, while `parentSubSegId` records the local visible ancestor. |
| `pointer-only langUnitRef` | The intended `subSeg.content` reference shape that keeps only `langUnitId` plus non-lexical occurrence metadata such as `remote`. |
| `langUnit occurrence binding` | One saved link from a `subSeg` capture to a `langUnit`, counted as an occurrence rather than a new lexical identity. |
| `langUnits collection` | The backend scaffold under `src/backend/data/langUnits` for reusable bubble text records. |
| `langUnit item` | A reusable text record referenced by `subSeg` bubble spans through `data-langunit-id` and saved `langUnitRef` tokens; it owns `text`, `root`, and `instances`, with context living on the instances. |
| `langUnit status` | The persisted two-state learning/progress marker on a canonical `langUnit`; valid values are `default` and `done`, with invalid or missing values normalized to `default`. |
| `langUnit default state` | The baseline state for a new or unresolved `langUnit`; it is also the fallback state after loading malformed or unknown status values. |
| `langUnit done state` | The completed/recognized state for a `langUnit`; it is toggled from a targeted bubble with `Ctrl+ArrowDown` or `Ctrl+ArrowUp`. |
| `langUnit status cycling` | With a `langUnit` bubble targeted in a focused `subSeg`, `Ctrl+ArrowUp/Down` cycles `default ↔ done`, updates all visible bubbles in that canonical cycle group, and persists the canonical item's status. |
| `langUnit status persistence` | Status changes are written through `/api/langUnits/items/:id/status`, increment `statusRevision`, update `statusUpdatedAt`/`updatedAt`, and are re-merged into the frontend before refreshing bubble indicators and segment content indicators. |
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
| `chinFuzz gloss` | Direct child `subSeg` line-initial content instantly overrides only the corresponding parent `chinFuzz` `langUnit` bubble when its first whitespace-delimited chunk is Chinese-only and matches a parent pinyin span's syllable count; the first option replaces that span, later matching options append after ` / `, and no valid option restores stored `langUnit.text`. |
| `pinyin syllable replacement options` | Space after a linked child `subSeg` line-initial Chinese value auto-langUnitifies it when its character count matches a pinyin span in a `chinPhrase` or `chinFuzz` parent; the first option replaces that span in the full parent text and later same-length line options append without repeating the parent prefix, e.g. `把厄尔尼诺分成4档 / 当`. |
| `pinyin option pseudo-langUnit` | Each derived replacement option is decorated inside the real parent bubble with a non-semantic `langunit-pseudo` span, giving it langUnit-like visual distinction without IDs, persistence meaning, or capture behavior. |
| `pinyin option equals selector` | A leading `=` on a linked child line marks that option as the sole parent replacement; the `=` stays outside the auto-wrapped child langUnit and is not displayed in the parent bubble. |
| `equals bubble-boundary insertion` | An unmodified `=` keypress at the visual start of a line-initial child langUnit is inserted as a plain-text sibling before the bubble, even when the browser reports the caret inside the span boundary. |
| `Enter bubble-boundary line break` | Enter at the visual start of a line-initial child langUnit inserts a sibling `<br>` before the bubble and leaves the caret outside, even when the browser reports the caret inside the span boundary. |
| `chinFuzzPart` | A mixed or pinyin-shaped target captured while the surrounding context is `chinFuzzWord`. |
| `engWordPart` | A short English-like target captured inside an `engPhrase` or `engWord` context when the selection is only part of a larger English word. |
| `no-op` | A rejected or illegal target shape, usually blank or punctuation-only text that should not produce a meaningful capture classification. |
| `chinWord` | A single Chinese lexical unit, used when the chin disambiguation flow decides a `langUnit` is narrower than a phrase. |
| `chinFuzzWord` | An ASCII-only pinyin-like target that resolves to exactly 1 syllable; multi-syllable pinyin-like text is treated as `chinPhrase` instead. |
| `chin disambiguation` | The Settings-controlled worker-backed flow that refines ambiguous Chinese instance types after save by classifying the bounded context separately from the selected target substring. |
| `chin disambiguation candidate` | A Chinese-bearing `langUnit instance` whose selected substring has at least two Chinese characters, making it potentially ambiguous between `chinWord` and `chinPhrase` and worth sending to the worker. |
| `chinFuzz on chinPhrase` | A `chinFuzz` target inside a `chinPhrase` context; this is treated as already resolved enough and should not trigger a worker disambiguation call. |
| `chinPhrase line length skip` | A save-time chin disambiguation shortcut where `chinPhrase` context text longer than 7 characters is accepted as phrase-shaped and not sent to the worker. |
| `instance-targeted chin disambiguation` | The save-time chin disambiguation flow that sends one ambiguous `langUnit instance` occurrence to the worker, persists `contextType` to the matched instance's `context.type`, and persists `targetType` to the matched instance's `target.type`. |
| `chin disambiguation queue` | The in-memory backend FIFO of instance-scoped chin disambiguation jobs created after a `subSeg` save when the Settings-controlled option is enabled; jobs are disposable across server restarts. |
| `chin disambiguation queue batch` | The set of candidate jobs collected from the rebuilt langUnit collection for one save request; all jobs in the batch share a generated `queueId`, while each job keeps its own expected instance snapshot. |
| `chin disambiguation drain` | The single backend drain guarded by `chinDisambiguationDrainActive`; `setImmediate` schedules it, it shifts one job at a time, awaits the worker-backed type inference, rebuilds langUnits after a successful mutation, and continues after individual errors. |
| `chin disambiguation drain status` | The `/api/langUnits/disambiguation-status` response `{ pending, active, revision, lastError }`; `revision` increments in the drain finally block for every dequeued job, including failed or stale no-op jobs. |
| `chin disambiguation completion event` | The bounded backend event record emitted for every dequeued job with its revision, langUnit/subSeg ids, target/context content, and any error; the frontend consumes events using `afterRevision`. |
| `chin disambiguation completion toast` | The frontend toast shown once per completion event, queued into a client-side display sequence so rapid completions do not overwrite one another; target and bounded context text identify the update. |
| `chin disambiguation job deduplication` | The backend key set that prevents the same langUnit instance snapshot from being enqueued repeatedly while it is already pending or active; the key is released when that job completes or fails. |
| `codex worker request timeout` | The server-side 60-second guard around one worker request; a timed-out request kills the worker child so the next queue job can recreate and prime a clean worker instead of waiting indefinitely. |
| `chin disambiguation stale-job guard` | `requireInstanceMatch: true` makes a queued job update only the same langUnit instance whose context text/type and target text/type still match the enqueue snapshot; changed content becomes a safe no-op. |
| `chin disambiguation frontend poll` | The browser refresh loop started after a non-empty queue response; it polls status every 250ms while `pending > 0` or `active` is true and refreshes `/api/langUnits/items` on each poll before reporting completion. |
| `langUnit write queue` | A separate Promise chain serializing atomic writes to `langUnits/items.json`; each write catches the previous rejection before appending, updates `lastGoodLangUnitItems`, and is independent of the chin disambiguation FIFO. |
| `pinyin chinPhrase` | Pure ASCII pinyin-like context text, or mixed Chinese plus only valid pinyin syllables, that can be segmented into 2 or more valid pinyin syllables, so it is captured as `chinPhrase` instead of `chinFuzzWord` or `engPhrase`. |
| `subSeg empty reset` | Clearing all text from the subSeg editor resets any bubble targeting back to `-1` so the next typed input behaves like normal plain text. |
| `subSeg enter guard` | `Enter` while a bubble target is active opens or keeps the cycle row instead of inserting a newline. |
| `subSeg illegal-action toast` | The short worker-toast message shown when an attempted subSeg action is blocked and turned into a no-op. |
| `subSeg wrap at row width` | `subSeg` content wraps inside the row instead of widening the editor or its panel. |
| `langUnit bubble persistence` | Saving and reloading the editor markup so a captured `langUnit bubble` reappears after refresh. |
| `entered panel width lock` | The entered `audEp` panel stays width-constrained instead of growing to match subSeg content. |
| `audSeg list balance` | The `audSeg` list keeps equal horizontal padding on both sides in dev. |
| `langUnit bubble no target` | The `-1` cycle state that means no bubble is currently targeted. |
| `langUnit bubble awaiting pulse` | The orange/yellow pulsing outline on the cycle-targeted `langUnit bubble` while Enter is waiting for async save/canonicalization before opening the linked child `subSeg`. |
| `capture subSeg` | The Enter-key action that wraps a highlighted substring in a `langUnit bubble`. |
| `bubble edge escape` | The double-space escape that moves the caret out of a `langUnit bubble` and keeps only one outside space. |
| `subSegs collection` | The backend scaffold under `src/backend/data/subSegs` for sub-segment records tied to an `audSeg`. |
| `subSeg save debounce` | The 500ms delayed save that persists `subSeg` input text to the `subSegs` collection for the selected `audSeg`. |
| `subSeg save no rerender` | Successful debounced `subSeg` saves update persistence and in-memory state without rerendering the entered `audEp` subtree, so focus stays on the input. |
| `subSeg line break persistence` | The rule that newline characters in a saved `subSeg` editor value are preserved and rerendered as visible line breaks instead of being trimmed away. |
| `subSeg IME Enter commit` | Enter used to accept an active IME composition (such as pinyin) stays native to the input method and must not also run the subSeg newline or capture action. |
| `subSeg entity decode` | The render/save boundary behavior where common HTML entities such as `&#39;`, `&quot;`, `&amp;`, `&lt;`, `&gt;`, and numeric entities are decoded back to user-facing characters before the subSeg editor escapes display HTML. |
| `subSeg bulk clear` | The settings action that deletes every persisted `subSeg` record and refreshes the entered `audEp` view. |
| `subSeg draft reset` | The settings action that clears unsaved in-memory `subSeg` draft state and cancels pending saves. |
| `langUnit bulk clear` | The settings action that clears all persisted `langUnit` records and rewrites `subSeg` content back to plain text. |
| `subSeg unload flush` | The `pagehide` fallback that sends any pending debounced `subSeg` text to persistence before a page reload or navigation. |
| `dev reload tone` | The short 880Hz chime that plays on Vite dev reloads once the browser has allowed audio playback. |
| `subSeg playback hotkey` | `Ctrl+Space` while focused in a `subSeg` input toggles audio playback; page-level `Ctrl+Space` does the same outside entered `audSeg` state. |
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
| `time tracking` | The aggregate usage recorder in `src/timeTracking.js` plus the `timeTracking` backend collection; it records visible page time and nested playback time without mutating domain items. |
| `page open time` | `timeTracking` scope `page:app` `openMs`, counted only while the app document is visible. |
| `active page time` | `page:app` `activeMs`, counted while visible and after a qualifying user signal within the 30-second idle window. |
| `playtime` | `playMs` on an `audEp`, `audSeg`, `audSegGroup`, or `subSeg` aggregate; counted only while the associated audio element is actually playing and its context qualifies. |
| `active playtime` | `activePlayMs`, the playback counterpart counted only when the page is also active. It supplies active audEp, audSeg, group, and subSeg time. |
| `audSeg group playtime` | `audSegGroup:<grpId>` `playMs`, counted across the group's derived envelope, including gaps between contiguous grouped members; gap time is not assigned to a member audSeg. |
| `subSeg playback source` | The subSeg editor that initiated playback; subSeg time follows this explicit source and is not inferred from focus alone. |
| `time tracking aggregate bucket` | One record keyed by `${scopeType}:${scopeId}` with optional parent ids, `totals`, and `updatedAt`; deltas are additively merged into `src/backend/data/timeTracking/items.json`. |
| `time tracking activity` | Pointer, keyboard, input, wheel, touch, scroll, focus, and visibility signals used to reset idle state and gate active totals. |
| `time tracking flush` | A batched POST to `/api/timeTracking/deltas`, with in-memory deltas retained after failed fetches and a best-effort `sendBeacon` pagehide path. |
| `time tracking debug hook` | Dev-only `window.__timeTracker` and `window.__timeTrackingDebug` handles used to inspect pending scopes and drive live verification without affecting production builds. |
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
