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
| `audSeg targeting` | Keyboard focus/selection cycling across `audSeg` cards while inside entered state. |
| `audSeg row jump` | `Ctrl+ArrowUp/Down` moves `audSeg` targeting by whole visual rows of 3 cards inside entered `audEp` state. |
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
| `subSeg bubble persistence` | Saving and reloading the editor markup so a captured `subSeg bubble` reappears after refresh. |
| `subSeg bubble no target` | The `-1` cycle state that means no bubble is currently targeted. |
| `capture subSeg` | The Enter-key action that wraps a highlighted substring in a `subSeg bubble`. |
| `bubble edge escape` | The double-space escape that moves the caret out of a `subSeg bubble` and keeps only one outside space. |
| `subSegs collection` | The backend scaffold under `src/backend/data/subSegs` for sub-segment records tied to an `audSeg`. |
| `subSeg save debounce` | The 500ms delayed save that persists `subSeg` input text to the `subSegs` collection for the selected `audSeg`. |
| `subSeg save no rerender` | Successful debounced `subSeg` saves update persistence and in-memory state without rerendering the entered `audEp` subtree, so focus stays on the input. |
| `subSeg unload flush` | The `pagehide` fallback that sends any pending debounced `subSeg` text to persistence before a page reload or navigation. |
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
