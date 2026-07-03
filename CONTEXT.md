# Context

| Term | Definition |
| --- | --- |
| `audEp` | An audio episode item in the list, backed by `src/backend/data/audEps/items.json`. |
| `audEp list` | The main list rendered in the canvas for `audEp` items. |
| `addAudEp button` | The `+` button used to add or upload a new `audEp`. |
| `ethereal seed item` | A non-data-driven placeholder list item shown when the list needs a starter entry. |
| `cycle targeting` | Keyboard-driven selection movement through list items. |
| `entered state lock` | The expanded inline panel state on a targeted `audEp` after pressing `Enter`. |
| `audSegs` | The empty segment list rendered inside an entered `audEp`, currently shown with placeholder text. |
| `audSegs collection` | The backend data collection scaffold in `src/backend/data/audSegs`. |
| `audSeg parent ref` | The `audEpIndex` field that ties an `audSeg` record to its parent `audEp`. |
| `audSeg card row` | The wrapped flexbox card layout used to show up to three `audSeg` items per row. |
| `audSeg item` | A single card inside the `audSegs` row layout. |
| `audSeg id` | The stable `_id` assigned to an `audSeg`; it is no longer derived from `audEpIndex` and is used as the foreign key for `subSeg` content. |
| `audSeg targeting` | Keyboard focus/selection cycling across `audSeg` cards while inside entered state. |
| `audSeg target indicator` | The blue outline used to show the currently targeted `audSeg` card. |
| `audSeg row jump` | `Ctrl+ArrowUp/Down` moves `audSeg` targeting by whole visual rows of 3 cards inside entered `audEp` state. |
| `lol overlay` | The centered faded `lol` text rendered on the page background. |
| `audSeg capture flow` | Shift creates a tentative `audSeg`; Shift+Space commits its end time and saves it. |
| `audSeg add action` | The wired capture/save flow that creates an `audSeg`, stores its parent reference, and rerenders the parent `audEp`. |
| `audSeg playback lock` | The entered-state mode where Enter on a targeted `audSeg` seeks audio to the segment start and keeps playback wrapped within that segment's time range. |
| `shift-release cancel` | The auto-removal of a tentative `audSeg` draft when `Shift` is released without committing it with `Shift+Space`. |
| `entered audSeg state` | The locked `audSeg` row mutation applied after Enter, distinct from the temporary targeted state used while cycling with arrows. |
| `subSeg list` | The one-row list rendered under an entered `audSeg`'s time text, currently seeded with a single ethereal editor item. |
| `subSeg editor` | The contenteditable host inside the seed `subSeg` item that accepts text, saves on debounce, and keeps Enter as a newline. |
| `subSeg editor height` | The editor grows with its content instead of staying collapsed to a fixed line box. |
| `subSeg autosize` | The editor height is recalculated from its content on render and input so it grows and shrinks without an internal scrollbar. |
| `subSeg bubble` | The inline pill span used to wrap captured text inside the subSeg editor. |
| `subSeg ref content` | The saved `subSeg` payload model that stores text tokens plus `langUnit` references instead of persisting bubble HTML directly. |
| `langUnits collection` | The backend scaffold under `src/backend/data/langUnits` for reusable bubble text records. |
| `langUnit item` | A reusable text record referenced by `subSeg` bubble spans through `data-langunit-id` and saved `langUnitRef` tokens. |
| `subSeg empty reset` | Clearing all text from the subSeg editor resets any bubble targeting back to `-1` so the next typed input behaves like normal plain text. |
| `subSeg enter guard` | `Enter` does nothing while a `subSeg` bubble target is active. |
| `subSeg wrap at row width` | `subSeg` content wraps inside the row instead of widening the editor or its panel. |
| `subSeg bubble persistence` | Saving and reloading the editor markup so a captured `subSeg bubble` reappears after refresh. |
| `entered panel width lock` | The entered `audEp` panel stays width-constrained instead of growing to match subSeg content. |
| `audSeg list balance` | The `audSeg` list keeps equal horizontal padding on both sides in dev. |
| `subSeg bubble no target` | The `-1` cycle state that means no bubble is currently targeted. |
| `capture subSeg` | The Enter-key action that wraps a highlighted substring in a `subSeg bubble`. |
| `bubble edge escape` | The double-space escape that moves the caret out of a `subSeg bubble` and keeps only one outside space. |
| `subSegs collection` | The backend scaffold under `src/backend/data/subSegs` for sub-segment records tied to an `audSeg`. |
| `subSeg save debounce` | The 500ms delayed save that persists `subSeg` input text to the `subSegs` collection for the selected `audSeg`. |
| `subSeg save no rerender` | Successful debounced `subSeg` saves update persistence and in-memory state without rerendering the entered `audEp` subtree, so focus stays on the input. |
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
| `codex worker` | The mini-module under `mgmt/codex-worker` that keeps one long-lived Codex CLI terminal session alive for scripted prompt/response work. |
| `worker terminal` | The spawned Node-managed terminal process that hosts the Codex CLI worker and exposes stdin, stdout, and stderr for monitoring. |
| `discern-languageUnit-root` | The planned tailored skill that reads `context` and `target` strings plus a substring and returns the resolved `langUnitRoot`. |
| `langUnitRoot` | The final resolved language-unit root string returned by the worker in the envelope `{res: ${langUnitRoot}}`. |
| `same codex thread` | The single persisted Codex conversation/session the worker reuses across requests instead of starting a fresh one per run. |
| `worker request` | One JSON payload with `context`, `target`, and `substring` consumed by the codex worker. |
| `worker session id` | The stored Codex thread id reused by `resume` for the next request in the same worker process. |
| `worker line mode` | The tty mode where each JSON line is treated as one worker request and one envelope is printed back. |
| `startup probe` | The literal `test` message the codex worker sends to itself on `npm run dev` or `npm start` before it accepts user input. |
| `startup probe complete` | The point after the startup `test` round trip returns and the worker is ready for normal requests. |
