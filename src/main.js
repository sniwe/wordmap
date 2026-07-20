import './styles.css';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="settings-shell">
    <button class="settings-button" id="settings-button" type="button" aria-haspopup="menu" aria-expanded="false">⚙</button>
    <div class="settings-popover" id="settings-popover" role="menu" hidden>
      <label class="settings-popover__item">
        <input type="checkbox" data-settings-toggle="codex-worker" />
        <span>codex CLI worker</span>
      </label>
      <label class="settings-popover__item">
        <input type="checkbox" data-settings-toggle="chin-disambiguation" />
        <span>chin disambiguation</span>
      </label>
      <button class="settings-popover__action" type="button" data-settings-action="clear-subsegs">clear all subSegs</button>
      <button class="settings-popover__action" type="button" data-settings-action="clear-langunits">clear all langUnits</button>
    </div>
  </div>
  <div class="worker-toast" id="worker-toast" role="status" aria-live="polite" aria-atomic="true" hidden></div>
  <div class="container" id="canvas">
    <ul class="list" id="audep-list"></ul>
  </div>
  <div class="selector-probe" id="selector-probe" hidden></div>
  <aside class="note-sidebar" id="note-sidebar" hidden>
    <div class="note-sidebar__header">
      <strong>Edit notes</strong>
      <button class="note-sidebar__close" id="note-close" type="button">Close</button>
    </div>
    <div class="note-sidebar__selector" id="note-selector"></div>
    <textarea
      class="note-sidebar__input"
      id="note-input"
      placeholder="Write an edit note for this element"
    ></textarea>
    <button class="note-sidebar__save" id="note-save" type="button">Save note</button>
    <div class="note-sidebar__notes" id="note-list"></div>
  </aside>
`;

const probe = document.querySelector('#selector-probe');
const sidebar = document.querySelector('#note-sidebar');
const settingsButton = document.querySelector('#settings-button');
const settingsPopover = document.querySelector('#settings-popover');
const settingsPopoverWorkerCheckbox = settingsPopover?.querySelector('[data-settings-toggle="codex-worker"]');
const settingsPopoverChinDisambiguationCheckbox = settingsPopover?.querySelector('[data-settings-toggle="chin-disambiguation"]');
const settingsPopoverClearSubSegsButton = settingsPopover?.querySelector('[data-settings-action="clear-subsegs"]');
const settingsPopoverClearLangUnitsButton = settingsPopover?.querySelector('[data-settings-action="clear-langunits"]');
const workerToast = document.querySelector('#worker-toast');
const audEpList = document.querySelector('#audep-list');
const noteSelector = document.querySelector('#note-selector');
const noteInput = document.querySelector('#note-input');
const noteList = document.querySelector('#note-list');
const saveButton = document.querySelector('#note-save');
const closeButton = document.querySelector('#note-close');
const filePicker = document.createElement('input');
filePicker.type = 'file';
filePicker.accept = 'audio/*';
filePicker.hidden = true;
document.body.appendChild(filePicker);

const state = {
  audEpItems: [],
  audSegItems: [],
  subSegItems: [],
  langUnitItems: [],
  pendingUploadIndex: 0,
  selectedAudEpIndex: -1,
  enteredAudEpIndex: -1,
  selectedAudSegIndex: -1,
  enteredAudSegIndex: -1,
  audSegDraftId: '',
  audSegCaptureShiftHeld: false,
  audSegDraftCommitPending: false,
  audSegPlaybackLock: null,
  deleteDialogIndex: -1,
  deleteDialogKind: 'audEp',
  deleteDialogAudSegId: '',
  deleteDialogChoice: 'cancel',
  notesBySelector: {},
  activeSelector: '',
  activeElement: null,
  historyOpenBySelector: {},
  langUnitRefTargetIndex: -1,
  enteredLangUnitRefIndex: -1,
  langUnitRefSource: null,
};

const keyboardGuardSelector = '.note-sidebar, .selector-probe';
const pointerGuardSelector = '.selector-probe, .note-sidebar__selector';
const subSegInputSelector = '.item__subseg-input';
const audioPlayers = new Map();
const pendingSeekByIndex = new Map();
const pendingSeekFrameByIndex = new Map();
const subSegDraftTextBySubSegId = new Map();
const subSegDraftPayloadBySubSegId = new Map();
const subSegDraftRevisionBySubSegId = new Map();
const subSegSaveTimersBySubSegId = new Map();
const langUnitBubbleEscapeState = new Map();
const langUnitBubbleTargetIndexByAudSegId = new Map();
const langUnitRefGraphViewByKey = new Map();
const langUnitRefGraphDragByPointerId = new Map();
const observedLangUnitRefGraphs = new WeakSet();
const langUnitRefResizeObserver =
  typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          entry.target.querySelector?.('.item__langunit-ref-canvas') && syncLangUnitRefGraphCanvases();
        }
      })
    : null;
let lastSubSegPlaybackShortcutAt = 0;
let subSegPlaybackShortcutActive = false;
let settingsOpen = false;
let codexWordRootInferenceEnabled = localStorage.getItem('codex-word-root-inference-enabled') === '1';
if (localStorage.getItem('chin-disambiguation-instance-targeted-enabled') !== '1') {
  localStorage.setItem('chin-disambiguation-enabled', '1');
  localStorage.setItem('chin-disambiguation-instance-targeted-enabled', '1');
}
let chinDisambiguationEnabled = localStorage.getItem('chin-disambiguation-enabled') !== '0';
let workerToastTimer = null;
if (import.meta.env.DEV) {
  createDevReloadTone();
}

function createItemId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildDerivedId(baseId, ordinal) {
  const parentId = String(baseId ?? '').trim();
  return parentId ? `${parentId}-${ordinal}` : '';
}

function buildLangUnitId(subSegId, ordinal) {
  return buildDerivedId(subSegId, ordinal);
}

function getAudEpItemByIndex(index) {
  return state.audEpItems[index] ?? null;
}

function getAudEpIdByIndex(index) {
  return String(getAudEpItemByIndex(index)?._id ?? '').trim() || String(index);
}

function getNextAudSegOrdinal(audEpId) {
  const parentId = String(audEpId ?? '').trim();
  if (!parentId) {
    return 0;
  }

  const prefix = `${parentId}-`;
  let nextOrdinal = 0;

  for (const item of state.audSegItems) {
    if (String(item?.audEpId ?? '') !== parentId) {
      continue;
    }

    const itemId = String(item?._id ?? '');
    if (!itemId.startsWith(prefix)) {
      continue;
    }

    const ordinal = Number(itemId.slice(prefix.length));
    if (Number.isInteger(ordinal) && ordinal >= nextOrdinal) {
      nextOrdinal = ordinal + 1;
    }
  }

  return nextOrdinal;
}

function getNextLangUnitOrdinal(editor, subSegId) {
  const prefix = `${String(subSegId ?? '').trim()}-`;
  let nextOrdinal = 0;

  if (!(editor instanceof HTMLElement) || !prefix.trim()) {
    return nextOrdinal;
  }

  for (const bubble of editor.querySelectorAll('.langunit-bubble')) {
    const langUnitId = String(bubble.getAttribute('data-langunit-id') ?? '').trim();
    if (!langUnitId.startsWith(prefix)) {
      continue;
    }

    const ordinal = Number(langUnitId.slice(prefix.length));
    if (Number.isInteger(ordinal) && ordinal >= nextOrdinal) {
      nextOrdinal = ordinal + 1;
    }
  }

  return nextOrdinal;
}

function getSubSegBubbleTargetKey(editor) {
  if (!(editor instanceof HTMLElement)) {
    return '';
  }

  return String(editor.dataset.subsegId || editor.dataset.subsegAudsegId || '').trim();
}

function getSubSegBubbleTargetIndex(editor) {
  const key = getSubSegBubbleTargetKey(editor);
  if (!key) {
    return -1;
  }

  return getSubSegBubbleTargetIndexByKey(key);
}

function getSubSegBubbleTargetIndexByKey(key) {
  const normalizedKey = String(key ?? '').trim();
  if (!normalizedKey) {
    return -1;
  }

  const targetIndex = langUnitBubbleTargetIndexByAudSegId.get(normalizedKey);
  return Number.isInteger(targetIndex) ? targetIndex : -1;
}

function setSubSegBubbleTargetIndex(editorOrKey, targetIndex) {
  const key = typeof editorOrKey === 'string'
    ? String(editorOrKey).trim()
    : getSubSegBubbleTargetKey(editorOrKey);
  if (!key) {
    return;
  }

  langUnitBubbleTargetIndexByAudSegId.set(key, targetIndex);
}

function clearSubSegBubbleTarget(editor) {
  const key = getSubSegBubbleTargetKey(editor);
  if (!key) {
    return;
  }

  langUnitBubbleTargetIndexByAudSegId.delete(key);
}

function clearSubSegBubbleTargetsForAudSeg(audSegId) {
  const renderedIds = new Set(
    getSubSegEntriesInTreeOrder(audSegId)
      .map(({ item }) => String(item?._id ?? '').trim())
      .filter(Boolean)
  );
  for (const subSegItem of getSubSegItemsForAudSeg(audSegId)) {
    const subSegId = String(subSegItem?._id ?? '').trim();
    if (subSegId) {
      renderedIds.add(subSegId);
    }
  }
  for (const subSegId of renderedIds) {
    langUnitBubbleTargetIndexByAudSegId.delete(subSegId);
  }
}

function createDevReloadTone() {
  const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  const storageKey = 'dev-reload-tone-pending';
  const context = new AudioContextCtor();

  const play = async () => {
    try {
      if (context.state === 'suspended') {
        await context.resume();
      }

      const now = context.currentTime;
      const playTone = (frequency, startTime, duration) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.06, startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration - 0.02);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      };

      playTone(880, now, 0.25);
      playTone(1175, now + 0.25, 0.25);
      sessionStorage.removeItem(storageKey);
    } catch {
      // ponytail: best-effort dev chime, silence is fine when autoplay is blocked.
    }
  };

  if (sessionStorage.getItem(storageKey) === '1') {
    sessionStorage.removeItem(storageKey);
  } else {
    void play();
  }

  window.addEventListener(
    'pointerdown',
    () => {
      context.resume().catch(() => {});
    },
    { once: true, passive: true }
  );
  window.addEventListener(
    'keydown',
    () => {
      context.resume().catch(() => {});
    },
    { once: true }
  );

  if (import.meta.hot) {
    import.meta.hot.on('vite:beforeFullReload', () => {
      sessionStorage.setItem(storageKey, '1');
      void play();
    });
  }

  return { play };
}

function renderAudEps(items) {
  const source = [{ __seed: true }, ...items];
  if (!items.length) {
    state.selectedAudEpIndex = -1;
    state.enteredAudEpIndex = -1;
    state.selectedAudSegIndex = -1;
    state.enteredAudSegIndex = -1;
    state.deleteDialogIndex = -1;
    state.deleteDialogKind = 'audEp';
    state.deleteDialogAudSegId = '';
  } else {
    state.enteredAudEpIndex = Math.max(-1, Math.min(state.enteredAudEpIndex, items.length - 1));
  }

  audEpList.innerHTML = source
    .map((item, index) => {
      const displayIndex = index;
      const dataIndex = Math.max(index - 1, 0);
      const mediaName = item.__seed ? '' : item.audioFileRef || item.media?.[item.media.length - 1]?.storedName || '';
      const deleteDialogOpen =
        !item.__seed &&
        state.deleteDialogKind === 'audEp' &&
        state.deleteDialogIndex === displayIndex;
      const isEntered = !item.__seed && state.enteredAudEpIndex === dataIndex;
      const audSegMarkup = isEntered ? renderAudSegList(dataIndex) : '';
      return `
        <li class="item${item.__seed ? ' item--seed' : ''}${deleteDialogOpen ? ' item--delete-confirm' : ''}${isEntered ? ' item--entered' : ''}" data-audep-index="${displayIndex}">
          ${
            item.__seed
              ? `<button class="addAudEp-button" type="button" aria-label="Add audEp" data-audep-index="${dataIndex}">+</button>`
              : item.audioFileRef || item.media?.length
              ? ''
              : `<button class="addAudEp-button" type="button" aria-label="Add audEp" data-audep-index="${dataIndex}">+</button>`
          }
          ${item.__seed ? '' : deleteDialogOpen ? `
            <div class="item__delete-dialog" role="group" aria-label="Delete audEp confirmation">
              <span class="item__delete-text">Delete this audEp?</span>
              <button class="item__delete-action" type="button" data-delete-action="cancel"${state.deleteDialogChoice === 'cancel' ? ' autofocus' : ''}>cancel</button>
              <button class="item__delete-action" type="button" data-delete-action="confirm"${state.deleteDialogChoice === 'confirm' ? ' autofocus' : ''}>confirm</button>
            </div>
          ` : `
            <span class="item__content">
              <span class="item__label">${escapeHtml(item.audioTitle ?? item.label ?? item.name ?? item.text ?? item.media?.[item.media.length - 1]?.originalName ?? '')}</span>
              ${
                mediaName
                  ? `<span class="item__time" data-audep-time="${dataIndex}">00:00</span>`
                  : ''
              }
            </span>
            ${audSegMarkup}
          `}
        </li>
      `;
    })
    .join('');
  syncAudEpSelection();
  syncAudEpPlaybackLabels();
  lockEnteredAudSegWidths();
  syncSubSegTextareaHeights();
  syncLangUnitRefsLists();
}

function getAudEpItems() {
  return [...audEpList.querySelectorAll('.item')];
}

function getSelectableAudEpItems() {
  return getAudEpItems();
}

function syncAudEpSelection() {
  const items = getAudEpItems();
  const selectableItems = getSelectableAudEpItems();
  if (!items.length) {
    state.selectedAudEpIndex = -1;
    return;
  }

  state.selectedAudEpIndex = Math.max(-1, Math.min(state.selectedAudEpIndex, selectableItems.length - 1));
  items.forEach((item) => item.classList.remove('is-targeted'));
  if (state.selectedAudEpIndex >= 0) {
    selectableItems[state.selectedAudEpIndex]?.classList.add('is-targeted');
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00';
  }

  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remaining = String(whole % 60).padStart(2, '0');
  return `${String(minutes).padStart(2, '0')}:${remaining}`;
}

function getItemMediaSource(item) {
  const storedName = item.audioFileRef || item.media?.[item.media.length - 1]?.storedName;
  return storedName ? `/api/audEps/media/${encodeURIComponent(storedName)}` : '';
}

function getSelectedAudEpMediaPlayer() {
  if (state.selectedAudEpIndex <= 0) {
    return null;
  }

  return getAudioForIndex(state.selectedAudEpIndex - 1);
}

function getAudSegItemsForAudEp(index) {
  const audEpId = getAudEpIdByIndex(index);
  return state.audSegItems
    .filter((item) => String(item?.audEpId ?? '') === audEpId || Number(item?.audEpIndex) === index)
    .slice()
    .sort((a, b) => {
      const tcsA = Number(a?.tcs ?? 0);
      const tcsB = Number(b?.tcs ?? 0);
      if (tcsA !== tcsB) {
        return tcsA - tcsB;
      }

      return String(a?._id ?? '').localeCompare(String(b?._id ?? ''));
    });
}

function getAudSegItemById(audSegId) {
  return state.audSegItems.find((item) => item?._id === audSegId) ?? null;
}

function getAudEpIndexForAudSegItem(audSegItem) {
  const audEpIndex = Number(audSegItem?.audEpIndex);
  if (Number.isInteger(audEpIndex) && audEpIndex >= 0) {
    return audEpIndex;
  }

  const audEpId = String(audSegItem?.audEpId ?? '').trim();
  return audEpId ? state.audEpItems.findIndex((item) => String(item?._id ?? '').trim() === audEpId) : -1;
}

function getAudSegPlaybackLock(index) {
  const lock = state.audSegPlaybackLock;
  return lock && lock.audEpIndex === index ? lock : null;
}

function syncAudSegSelection(items) {
  if (!items.length) {
    state.selectedAudSegIndex = -1;
    state.enteredAudSegIndex = -1;
    return;
  }

  state.selectedAudSegIndex = Math.max(-1, Math.min(state.selectedAudSegIndex, items.length - 1));
  state.enteredAudSegIndex = Math.max(-1, Math.min(state.enteredAudSegIndex, items.length - 1));
}

function getSelectedAudSegItem() {
  if (state.enteredAudEpIndex < 0 || state.selectedAudSegIndex < 0) {
    return null;
  }

  return getAudSegItemsForAudEp(state.enteredAudEpIndex)[state.selectedAudSegIndex] ?? null;
}

function renderEnteredAudSegAndFocus(item) {
  renderAudEps(state.audEpItems);
  requestAnimationFrame(() => {
    const input = audEpList.querySelector(
      `.item__segment--entered .item__subseg-input[data-subseg-audseg-id="${CSS.escape(String(item?._id ?? ''))}"]`
    );
    if (input instanceof HTMLElement) {
      syncLangUnitBubbleTarget(input, false);
      input.focus({ preventScroll: true });
    }
  });
}

function getAudSegPlaybackRange(item) {
  const tcs = Number(item?.tcs ?? 0);
  const tce = Number(item?.tce ?? 0);
  return Number.isFinite(tcs) && Number.isFinite(tce) && tce > tcs ? { tcs, tce } : null;
}

function lockSelectedAudSegPlayback() {
  const item = getSelectedAudSegItem();
  if (!item) {
    return;
  }

  const range = getAudSegPlaybackRange(item);
  if (!range) {
    return;
  }

  state.audSegPlaybackLock = {
    audEpIndex: state.enteredAudEpIndex,
    tcs: range.tcs,
    tce: range.tce,
  };
  state.enteredAudSegIndex = state.selectedAudSegIndex;
  renderEnteredAudSegAndFocus(item);
  seekAudio(state.selectedAudEpIndex - 1, range.tcs - (getAudioForIndex(state.selectedAudEpIndex - 1)?.currentTime || 0));
}

function openLangUnitRef(ref) {
  if (!(ref instanceof HTMLElement)) {
    return;
  }

  const audSegId = ref.dataset.audsegId || '';
  const langUnitId = ref.dataset.langunitId || '';
  const audSegItem = getAudSegItemById(audSegId);
  if (!audSegItem) {
    return;
  }

  const audEpIndex = getAudEpIndexForAudSegItem(audSegItem);
  if (!Number.isInteger(audEpIndex) || audEpIndex < 0) {
    return;
  }

  const items = getAudSegItemsForAudEp(audEpIndex);
  const selectedAudSegIndex = items.findIndex((item) => item?._id === audSegId);
  if (selectedAudSegIndex < 0) {
    return;
  }

  state.selectedAudEpIndex = audEpIndex + 1;
  state.enteredAudEpIndex = audEpIndex;
  state.selectedAudSegIndex = selectedAudSegIndex;
  state.enteredAudSegIndex = selectedAudSegIndex;
  const targetPath = getSubSegTargetPathForLangUnit(audSegId, langUnitId);
  if (targetPath.length) {
    for (const step of targetPath) {
      setSubSegBubbleTargetIndex(step.subSegId, getLangUnitBubbleIndexForSubSeg(audSegId, step.subSegId, step.langUnitId));
    }
  } else {
    const rootSubSegId = getRootSubSegItemForAudSeg(audSegId)?._id || '';
    if (rootSubSegId) {
      setSubSegBubbleTargetIndex(rootSubSegId, getLangUnitBubbleIndex(audSegId, langUnitId));
    }
  }
  if (getAudSegPlaybackRange(audSegItem)) {
    lockSelectedAudSegPlayback();
    return;
  }

  state.audSegPlaybackLock = null;
  renderEnteredAudSegAndFocus(audSegItem);
}

function renderAudSegList(audEpIndex) {
  const items = getAudSegItemsForAudEp(audEpIndex);
  syncAudSegSelection(items);
  const content = items.length
        ? items
        .map((item, itemIndex) => {
          const isDraft = item._id && item._id === state.audSegDraftId;
          const isTargeted = itemIndex === state.selectedAudSegIndex;
          const isEntered = itemIndex === state.enteredAudSegIndex;
          const deleteDialogOpen =
            state.deleteDialogKind === 'audSeg' && state.deleteDialogAudSegId === String(item._id ?? '');
          const isReorganized = isEntered || deleteDialogOpen;
          const label = item.ssHead ?? item.label ?? item.text ?? '';
          const tcs = formatTime(Number(item.tcs ?? 0));
          const tce = item.tce == null || item.tce === '' ? '  ' : formatTime(Number(item.tce));
          const hasLabel = Boolean(String(label).trim());
          const subSegMarkup = isEntered && !deleteDialogOpen ? renderSubSegList(item) : '';
          const langUnitRefsMarkup = isEntered && !deleteDialogOpen ? renderLangUnitRefsList(item) : '';
          return `
            <li class="item__segment${isDraft ? ' item__segment--draft' : ''}${isReorganized ? ' item__segment--entered' : ''}${deleteDialogOpen ? ' item__segment--delete-confirm' : ''}${isTargeted ? ' is-targeted' : ''}" data-audseg-id="${escapeHtml(String(item._id ?? ''))}">
              <span class="item__segment-timing">${escapeHtml(`${tcs}-${tce}`)}</span>
              ${hasLabel ? `<span class="item__segment-text">${escapeHtml(label)}</span>` : ''}
              ${deleteDialogOpen ? `
                <div class="item__delete-dialog" role="group" aria-label="Delete audSeg confirmation">
                  <span class="item__delete-text">Delete this audSeg?</span>
                  <button class="item__delete-action" type="button" data-delete-action="cancel"${state.deleteDialogChoice === 'cancel' ? ' autofocus' : ''}>cancel</button>
                  <button class="item__delete-action" type="button" data-delete-action="confirm"${state.deleteDialogChoice === 'confirm' ? ' autofocus' : ''}>confirm</button>
                </div>
              ` : `
                ${subSegMarkup}
                ${langUnitRefsMarkup}
              `}
            </li>
          `;
        })
        .join('')
    : '<li class="item__segments-empty">no audSegs yet..</li>';

  return `
    <div class="item__entered-panel">
      <ul id="audSegs" class="item__segments" aria-label="audSegs" data-audep-index="${audEpIndex}">
        ${content}
      </ul>
    </div>
  `;
}

function getSubSegItemsForAudSeg(audSegId) {
  return state.subSegItems
    .filter((item) => String(item?.audSegId ?? '') === String(audSegId ?? ''))
    .sort((a, b) => {
      const rootA = a?.isRoot !== false;
      const rootB = b?.isRoot !== false;
      if (rootA !== rootB) {
        return rootA ? -1 : 1;
      }

      const createdA = Date.parse(a?.createdAt ?? '');
      const createdB = Date.parse(b?.createdAt ?? '');
      if (!Number.isNaN(createdA) && !Number.isNaN(createdB) && createdA !== createdB) {
        return createdA - createdB;
      }

      return String(a?._id ?? '').localeCompare(String(b?._id ?? ''));
    });
}

function getSubSegItemById(subSegId) {
  return state.subSegItems.find((item) => String(item?._id ?? '') === String(subSegId ?? '')) ?? null;
}

function getRootSubSegItemForAudSeg(audSegId) {
  return getSubSegItemsForAudSeg(audSegId).find((item) => item?.isRoot !== false) ?? null;
}

function getLangUnitRecallKey(langUnitId) {
  const cycleTargetId = getLangUnitCycleTargetId(langUnitId);
  const item = getLangUnitItem(cycleTargetId) ?? getLangUnitItem(langUnitId);
  return getLangUnitCanonicalKey(item?.target, item?.text) || cycleTargetId;
}

function getSubSegLinkRecallKey(item) {
  return getLangUnitRecallKey(getSubSegLinkTargetLangUnitId(item));
}

function getCycleSubSegItemForTarget(audSegId, linkTargetLangUnitId, parentSubSegId = '', excludeSubSegId = '') {
  const targetId = String(linkTargetLangUnitId ?? '').trim();
  const parentId = String(parentSubSegId ?? '').trim();
  const excluded = String(excludeSubSegId ?? '').trim();
  return sortSubSegItems(state.subSegItems).find(
    (item) =>
      item?.isRoot === false &&
      String(item?._id ?? '') !== excluded &&
      (!parentId || getSubSegParentSubSegId(item) === parentId) &&
      String(item?.linkTargetLangUnitId ?? '') === targetId
  ) ?? null;
}

function getRecallSubSegItemForTarget(audSegId, linkTargetLangUnitId, parentSubSegId = '', excludeSubSegId = '', preferParent = false) {
  const targetKey = getLangUnitRecallKey(linkTargetLangUnitId);
  const parentId = String(parentSubSegId ?? '').trim();
  const excluded = String(excludeSubSegId ?? '').trim();
  const candidates = sortSubSegItems(state.subSegItems).filter((item) => (
    item?.isRoot === false &&
    String(item?._id ?? '') !== excluded &&
    targetKey &&
    getSubSegLinkRecallKey(item) === targetKey
  ));

  return candidates.sort((a, b) => {
    const sameParentA = parentId && getSubSegParentSubSegId(a) === parentId ? 0 : 1;
    const sameParentB = parentId && getSubSegParentSubSegId(b) === parentId ? 0 : 1;
    const hasContentA = Array.isArray(a?.content) && a.content.length ? 0 : String(a?.text ?? '').trim() ? 0 : 1;
    const hasContentB = Array.isArray(b?.content) && b.content.length ? 0 : String(b?.text ?? '').trim() ? 0 : 1;
    if (preferParent && sameParentA !== sameParentB) {
      return sameParentA - sameParentB;
    }
    if (hasContentA !== hasContentB) {
      return hasContentA - hasContentB;
    }
    if (!preferParent && sameParentA !== sameParentB) {
      return sameParentA - sameParentB;
    }

    return hasContentA - hasContentB;
  })[0] ?? null;
}

function getSubSegItemForAudSeg(audSegId) {
  return getRootSubSegItemForAudSeg(audSegId);
}

function getNextSubSegOrdinal(audSegId) {
  const prefix = `${String(audSegId ?? '').trim()}-`;
  let nextOrdinal = 0;

  for (const item of getSubSegItemsForAudSeg(audSegId)) {
    const itemId = String(item?._id ?? '');
    if (!itemId.startsWith(prefix)) {
      continue;
    }

    const ordinal = Number(itemId.slice(prefix.length));
    if (Number.isInteger(ordinal) && ordinal >= nextOrdinal) {
      nextOrdinal = ordinal + 1;
    }
  }

  return nextOrdinal;
}

function getSubSegIdForLangUnitId(langUnitId) {
  const id = String(langUnitId ?? '').trim();
  const separator = id.lastIndexOf('-');
  return separator > 0 ? id.slice(0, separator) : '';
}

function getSubSegParentSubSegId(item) {
  const explicitParentId = String(item?.parentSubSegId ?? '').trim();
  if (explicitParentId) {
    return explicitParentId;
  }

  return getSubSegIdForLangUnitId(getSubSegLinkTargetLangUnitId(item));
}

function getSubSegLinkTargetLangUnitId(item) {
  return String(item?.linkTargetLangUnitId ?? '').trim();
}

function getSubSegEditorLinkTargetLangUnitId(editor) {
  return editor instanceof HTMLElement ? String(editor.getAttribute('data-link-target-langunit-id') ?? '').trim() : '';
}

function subSegLinkMatchesLangUnitTarget(item, targetLangUnitId) {
  const linkTargetLangUnitId = getSubSegLinkTargetLangUnitId(item);
  const targetId = String(targetLangUnitId ?? '').trim();
  return Boolean(
    linkTargetLangUnitId &&
    targetId &&
    getLangUnitRecallKey(linkTargetLangUnitId) === getLangUnitRecallKey(targetId)
  );
}

function getTargetedLangUnitIdForSubSeg(audSegId, subSegId) {
  const targetIndex = getSubSegBubbleTargetIndexByKey(subSegId);
  if (targetIndex < 0) {
    return '';
  }

  return getOrderedLangUnitIdsForSubSeg(audSegId, subSegId)[targetIndex] ?? '';
}

function subSegContentHasLangUnit(audSegId, item, langUnitId) {
  const targetKey = getLangUnitRecallKey(langUnitId);
  return Boolean(targetKey && getOrderedLangUnitIds(getSubSegContentTokens(audSegId, String(item?._id ?? ''))).some((id) => getLangUnitRecallKey(id) === targetKey));
}

function getChildSubSegItemsForRenderedParent(audSegId, parentSubSegId) {
  const parentIds = getOrderedLangUnitIdsForSubSeg(audSegId, parentSubSegId);
  const parentGroups = new Set(parentIds.map((id) => getLangUnitRecallKey(id)));
  const childByTargetId = new Map();
  const getChildRank = (item) => [
    Array.isArray(item?.content) && item.content.length ? 0 : String(item?.text ?? '').trim() ? 0 : 1,
    getSubSegParentSubSegId(item) === String(parentSubSegId ?? '').trim() ? 0 : 1,
  ];
  for (const item of sortSubSegItems(state.subSegItems)) {
    if (item?.isRoot !== false) {
      continue;
    }

    const targetId = getSubSegLinkRecallKey(item);
    if (!targetId || !parentGroups.has(targetId)) {
      continue;
    }

    const existing = childByTargetId.get(targetId);
    if (!existing) {
      childByTargetId.set(targetId, item);
      continue;
    }

    const [contentRank, parentRank] = getChildRank(item);
    const [existingContentRank, existingParentRank] = getChildRank(existing);
    if (contentRank < existingContentRank || (contentRank === existingContentRank && parentRank < existingParentRank)) {
      childByTargetId.set(targetId, item);
    }
  }

  return [...childByTargetId.values()].sort((a, b) => {
    const indexA = parentIds.findIndex((id) => getLangUnitRecallKey(id) === getSubSegLinkRecallKey(a));
    const indexB = parentIds.findIndex((id) => getLangUnitRecallKey(id) === getSubSegLinkRecallKey(b));
    if (indexA !== indexB) {
      return (indexA < 0 ? Number.MAX_SAFE_INTEGER : indexA) - (indexB < 0 ? Number.MAX_SAFE_INTEGER : indexB);
    }

    return sortSubSegItems([a, b])[0] === a ? -1 : 1;
  });
}

function getSubSegTargetPathForLangUnit(audSegId, langUnitId) {
  const targetId = getLangUnitCycleTargetId(langUnitId);
  const root = getRootSubSegItemForAudSeg(audSegId);
  if (!targetId || !root) {
    return [];
  }

  const findPath = (item, path = [], seen = new Set()) => {
    const subSegId = String(item?._id ?? '').trim();
    if (!subSegId || seen.has(subSegId)) {
      return [];
    }

    const nextSeen = new Set(seen);
    nextSeen.add(subSegId);
    if (subSegContentHasLangUnit(audSegId, item, targetId)) {
      return [...path, { subSegId, langUnitId: targetId }];
    }

    for (const child of getChildSubSegItemsForRenderedParent(audSegId, subSegId)) {
      const linkTargetLangUnitId = getSubSegLinkTargetLangUnitId(child);
      const childPath = findPath(child, [...path, { subSegId, langUnitId: linkTargetLangUnitId }], nextSeen);
      if (childPath.length) {
        return childPath;
      }
    }

    return [];
  };

  return findPath(root).filter((step) => step.subSegId && step.langUnitId);
}

function getSubSegEntriesInTreeOrder(audSegId) {
  const items = getSubSegItemsForAudSeg(audSegId);
  const root = items.find((item) => item?.isRoot !== false) ?? null;
  if (!root) {
    return items.map((item) => ({ item, depth: 0 }));
  }

  const focusedPathEdges = new Set();
  const focusedEditor = getFocusedSubSegEditor();
  let focusedParentId = focusedEditor instanceof HTMLElement ? String(focusedEditor.dataset.parentSubsegId ?? '').trim() : '';
  for (let itemId = getSubSegEditorKey(focusedEditor); itemId;) {
    const parentId = focusedParentId || getSubSegParentSubSegId(getSubSegItemById(itemId)) || '';
    if (!parentId) {
      break;
    }

    focusedPathEdges.add(`${parentId}\u0000${itemId}`);
    itemId = parentId;
    focusedParentId = '';
  }

  const seen = new Set();
  const seenItemIds = new Set();
  const ordered = [];
  const pushSubtree = (item, depth = 0, renderParentId = '') => {
    const itemId = String(item?._id ?? '');
    const renderKey = `${renderParentId}\u0000${itemId}`;
    if (!itemId || seen.has(renderKey)) {
      return;
    }

    seen.add(renderKey);
    seenItemIds.add(itemId);
    ordered.push({ item, depth, parentSubSegId: renderParentId });
    const targetedLangUnitId = getTargetedLangUnitIdForSubSeg(audSegId, itemId);
    const children = getChildSubSegItemsForRenderedParent(audSegId, itemId)
      .filter((child) => {
        const childId = String(child?._id ?? '');
        return focusedPathEdges.has(`${itemId}\u0000${childId}`) || subSegLinkMatchesLangUnitTarget(child, targetedLangUnitId);
      });
    children.forEach((child) => pushSubtree(child, depth + 1, itemId));
  };

  pushSubtree(root);
  items
    .filter((item) => {
      const itemId = String(item?._id ?? '');
      if (!itemId || seenItemIds.has(itemId) || item?.isRoot !== false) {
        return false;
      }

      const parentId = getSubSegParentSubSegId(item);
      const linkTargetLangUnitId = getSubSegLinkTargetLangUnitId(item);
      return !linkTargetLangUnitId && !parentId;
    })
    .forEach((item) => pushSubtree(item));
  return ordered;
}

function ensureRootSubSegItem(audSegId) {
  const existing = getRootSubSegItemForAudSeg(audSegId);
  if (existing) {
    return existing;
  }

  const next = {
    _id: buildDerivedId(audSegId, 0),
    audSegId,
    isRoot: true,
    content: [],
    text: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.subSegItems = sortSubSegItems([next, ...state.subSegItems]);
  return next;
}

function sortSubSegItems(items) {
  return [...items].sort((a, b) => {
    const audSegA = String(a?.audSegId ?? '');
    const audSegB = String(b?.audSegId ?? '');
    if (audSegA !== audSegB) {
      return audSegA.localeCompare(audSegB);
    }

    const rootA = a?.isRoot !== false;
    const rootB = b?.isRoot !== false;
    if (rootA !== rootB) {
      return rootA ? -1 : 1;
    }

    const createdA = Date.parse(a?.createdAt ?? '');
    const createdB = Date.parse(b?.createdAt ?? '');
    if (!Number.isNaN(createdA) && !Number.isNaN(createdB) && createdA !== createdB) {
      return createdA - createdB;
    }

    return String(a?._id ?? '').localeCompare(String(b?._id ?? ''));
  });
}

function getSubSegEditorKey(editor) {
  if (!(editor instanceof HTMLElement)) {
    return '';
  }

  return String(editor.dataset.subsegId || editor.dataset.subsegAudsegId || '').trim();
}

function getOrderedLangUnitIds(tokens) {
  const ids = [];
  const seen = new Set();

  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (token?.type !== 'langUnitRef') {
      continue;
    }

    const langUnitId = String(token.langUnitId ?? '').trim();
    const groupId = getLangUnitCycleTargetId(langUnitId);
    if (!groupId || seen.has(groupId)) {
      continue;
    }

    seen.add(groupId);
    ids.push(groupId);
  }

  return ids;
}

function getOrderedLangUnitIdsForSubSeg(audSegId, subSegId) {
  const editor = audEpList.querySelector(`.item__subseg-input[data-subseg-audseg-id="${CSS.escape(String(audSegId))}"][data-subseg-id="${CSS.escape(String(subSegId))}"]`);
  return editor instanceof HTMLElement
    ? getLangUnitBubbleGroupIds(editor)
    : getOrderedLangUnitIds(getSubSegContentTokens(audSegId, subSegId));
}

function getLangUnitBubbleIndex(audSegId, langUnitId) {
  if (!audSegId || !langUnitId) {
    return -1;
  }

  const editor = audEpList.querySelector(`.item__subseg-input[data-subseg-audseg-id="${CSS.escape(String(audSegId))}"][data-subseg-is-root="1"]`);
  if (editor instanceof HTMLElement) {
    return getLangUnitBubbleGroupIds(editor).indexOf(getLangUnitCycleTargetId(langUnitId));
  }

  const subSegItem = getRootSubSegItemForAudSeg(audSegId);
  const payload = subSegDraftPayloadBySubSegId.get(String(subSegItem?._id ?? ''));
  const tokens = Array.isArray(payload?.content)
    ? payload.content
    : Array.isArray(subSegItem?.content)
      ? subSegItem.content
      : [];
  return getOrderedLangUnitIds(tokens).indexOf(getLangUnitCycleTargetId(langUnitId));
}

function getLangUnitBubbleIndexForSubSeg(audSegId, subSegId, langUnitId) {
  if (!audSegId || !subSegId || !langUnitId) {
    return -1;
  }

  return getOrderedLangUnitIdsForSubSeg(audSegId, subSegId).indexOf(getLangUnitCycleTargetId(langUnitId));
}

function getLangUnitItem(langUnitId) {
  return state.langUnitItems.find((item) => item?._id === langUnitId) ?? null;
}

function getLangUnitCycleTargetId(langUnitId, seen = new Set()) {
  const id = String(langUnitId ?? '').trim();
  if (!id || seen.has(id)) {
    return id;
  }

  seen.add(id);
  const item = getLangUnitItem(id);
  if (!item) {
    return id;
  }

  const linkTargetId = String(item.instances?.find((instance) => instance?.cycleGroupId)?.cycleGroupId ?? '').trim();
  if (!linkTargetId || linkTargetId === id) {
    return id;
  }

  return getLangUnitCycleTargetId(linkTargetId, seen) || id;
}

function getLangUnitText(langUnit) {
  return String(langUnit?.text ?? '');
}

function getSubSegTextValue(item) {
  const subSegId = String(item?._id ?? '').trim();
  const draft = subSegDraftPayloadBySubSegId.get(subSegId);
  if (typeof draft?.text === 'string') {
    return draft.text;
  }

  return String(item?.text ?? '');
}

function getEqualsLineValues(text) {
  return String(text ?? '')
    .split('\n')
    .filter((value) => value.startsWith('='))
    .map((value) => value.slice(1).trim())
    .filter(Boolean);
}

function isChineseOnlyText(text) {
  return /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+$/u.test(String(text ?? '').trim());
}

function isChineseCharacter(value) {
  return /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]$/u.test(String(value ?? ''));
}

function isMatchingPinyinGloss(pinyinText, chineseText) {
  const syllables = countPinyinSyllables(pinyinText);
  return syllables > 0 && countChineseCharacters(chineseText) === syllables;
}

function getLangUnitRenderText(langUnitId, fallbackText = '', parentSubSegId = '') {
  const langUnit = getLangUnitItem(langUnitId);
  if (String(langUnit?.target?.type ?? '') !== 'chinFuzz') {
    return String(fallbackText ?? '');
  }

  const expectedParentSubSegId = String(parentSubSegId || getSubSegIdForLangUnitId(langUnitId)).trim();
  const child = state.subSegItems.find(
    (item) =>
      item?.isRoot === false &&
      getSubSegLinkTargetLangUnitId(item) === String(langUnitId ?? '').trim() &&
      getSubSegParentSubSegId(item) === expectedParentSubSegId
  );
  const equalsValues = getEqualsLineValues(getSubSegTextValue(child)).filter(
    (value) => isChineseOnlyText(value) && isMatchingPinyinGloss(getLangUnitText(langUnit), value)
  );
  return equalsValues.length
    ? equalsValues.join(' / ')
    : String(fallbackText ?? '');
}

function getLangUnitContextText(langUnit) {
  const instanceContext = Array.isArray(langUnit?.instances)
    ? langUnit.instances.reduce((best, instance) => {
      const context = instance?.context;
      if (!context || typeof context !== 'object' || Array.isArray(context)) {
        return best;
      }

      return String(context.text ?? '').length > String(best?.text ?? '').length ? context : best;
    }, null)
    : null;
  if (instanceContext && typeof instanceContext === 'object') {
    return String(instanceContext.text ?? '');
  }

  return '';
}

function getLangUnitItemByText(text) {
  const value = String(text ?? '').trim();
  return state.langUnitItems.find((item) => String(getLangUnitText(item) ?? '').trim() === value) ?? null;
}

function getLangUnitCanonicalKey(target, text = '') {
  const normalizedTarget = normalizeLangUnitTarget(target ?? text);
  const type = normalizeLangUnitTargetType(normalizedTarget.type);
  const value = String(normalizedTarget.text || text || '').trim();
  return type && value ? `${type}\u0000${value}` : '';
}

function getLangUnitItemByCanonicalTarget(target, text = '') {
  const key = getLangUnitCanonicalKey(target, text);
  if (!key) {
    return null;
  }

  return state.langUnitItems.find((item) => getLangUnitCanonicalKey(item?.target, item?.text) === key) ?? null;
}

function getSubSegContentTokens(audSegId, subSegId = '') {
  const subSegItem = subSegId ? getSubSegItemById(subSegId) : getRootSubSegItemForAudSeg(audSegId);
  const payload = subSegDraftPayloadBySubSegId.get(String(subSegItem?._id ?? ''));
  if (Array.isArray(payload?.content)) {
    return payload.content;
  }

  return Array.isArray(subSegItem?.content) ? subSegItem.content : [];
}

function getLangUnitReferenceCount(langUnitId) {
  const id = String(langUnitId ?? '').trim();
  if (!id) {
    return 0;
  }

  const seenSubSegIds = new Set();
  let count = 0;
  for (const subSegItem of state.subSegItems) {
    const subSegId = String(subSegItem?._id ?? '').trim();
    if (!subSegId || seenSubSegIds.has(subSegId)) {
      continue;
    }

    for (const token of getSubSegContentTokens(String(subSegItem?.audSegId ?? ''), subSegId)) {
      if (token?.type === 'langUnitRef' && String(token.langUnitId ?? '') === id) {
        count += 1;
        seenSubSegIds.add(subSegId);
        break;
      }
    }
  }

  return count;
}

function sanitizeSubSegMarkup(value) {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  value = normalizeSubSegLineBreaks(value);
  if (!value.includes('<')) {
    return escapeHtml(value).replaceAll('\n', '<br>');
  }

  const template = document.createElement('template');
  template.innerHTML = value;
  const blockTags = new Set(['DIV', 'P', 'LI']);

  const serializeChildren = (nodes) => {
    let output = '';
    for (const node of nodes) {
      const chunk = serializeNode(node);
      if (!chunk) {
        continue;
      }

      if (node.nodeType === Node.ELEMENT_NODE && blockTags.has(node.tagName) && output && !output.endsWith('<br>')) {
        output += '<br>';
      }

      output += chunk;
    }

    return output;
  };

  const serializeNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(normalizeSubSegLineBreaks(node.textContent ?? '')).replaceAll('\n', '<br>');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    if (node.tagName === 'BR') {
      return '<br>';
    }

    if (node.tagName === 'SPAN' && node.classList.contains('langunit-bubble')) {
      const bubbleContent = serializeChildren(node.childNodes);
      const langUnitId = node.getAttribute('data-langunit-id');
      const langUnitRemote = node.getAttribute('data-langunit-remote');
      const langUnitSourceText = node.getAttribute('data-langunit-source-text');
      const langUnitCycleGroupId = node.getAttribute('data-langunit-cycle-group-id');
      const dataAttr = langUnitId ? ` data-langunit-id="${escapeHtml(langUnitId)}"` : '';
      const remoteAttr = langUnitRemote ? ' data-langunit-remote="1"' : '';
      const sourceTextAttr = langUnitSourceText ? ` data-langunit-source-text="${escapeHtml(langUnitSourceText)}"` : '';
      const cycleGroupAttr = langUnitCycleGroupId ? ` data-langunit-cycle-group-id="${escapeHtml(langUnitCycleGroupId)}"` : '';
      return `<span class="langunit-bubble"${dataAttr}${remoteAttr}${sourceTextAttr}${cycleGroupAttr}>${bubbleContent}</span>`;
    }

    if (node.tagName === 'SPAN' && node.classList.contains('langunit-connector')) {
      return `<span class="langunit-connector">${serializeChildren(node.childNodes)}</span>`;
    }

    if (blockTags.has(node.tagName)) {
      if (isBreakPlaceholderBlock(node)) {
        return '<br>';
      }

      const blockContent = serializeChildren(node.childNodes);
      return blockContent || '<br>';
    }

    return serializeChildren(node.childNodes);
  };

  return serializeChildren(template.content.childNodes);
}

function normalizeSubSegLineBreaks(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function isBreakPlaceholderBlock(node) {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  if (!['DIV', 'P', 'LI'].includes(node.tagName)) {
    return false;
  }

  const childNodes = [...node.childNodes].filter((child) => {
    if (child.nodeType !== Node.TEXT_NODE) {
      return true;
    }

    return Boolean(String(child.textContent ?? '').trim());
  });

  return childNodes.length === 1 && childNodes[0].nodeType === Node.ELEMENT_NODE && childNodes[0].tagName === 'BR';
}

function renderSubSegContentTokens(tokens, subSegId = '') {
  if (!Array.isArray(tokens)) {
    return '';
  }

  const segments = [];
  const seen = new Map();
  let currentBubble = null;

  const flushBubble = () => {
    if (!currentBubble) {
      return;
    }

    segments.push(currentBubble);
    currentBubble = null;
  };

  for (const token of tokens) {
    if (!token || typeof token !== 'object') {
      continue;
    }

    if (token.type === 'text') {
      flushBubble();
      segments.push({ type: 'text', text: String(token.text ?? '') });
      continue;
    }

    if (token.type !== 'langUnitRef') {
      continue;
    }

    const langUnitId = String(token.langUnitId ?? '').trim();
    if (!langUnitId) {
      continue;
    }

    const langUnit = getLangUnitItem(langUnitId);
    const occurrenceIndex = Number.isInteger(seen.get(langUnitId)) ? seen.get(langUnitId) : 0;
    seen.set(langUnitId, occurrenceIndex + 1);
    const instancesForSubSeg = Array.isArray(langUnit?.instances)
      ? langUnit.instances.filter((instance) => String(instance?.subSegId ?? '') === String(subSegId ?? ''))
      : [];
    const cycleGroupId = getLangUnitCycleTargetId(langUnitId);
    const sourceText = String(getLangUnitText(langUnit) || token.text || '');
    const text = getLangUnitRenderText(langUnitId, sourceText, subSegId);
    const remote = token.remote === true || cycleGroupId !== langUnitId;
    if (
      currentBubble &&
      currentBubble.langUnitId === langUnitId &&
      currentBubble.cycleGroupId === cycleGroupId
    ) {
      currentBubble.text += text;
      currentBubble.sourceText += sourceText;
      continue;
    }

    flushBubble();
    currentBubble = {
      type: 'bubble',
      langUnitId,
      text,
      sourceText,
      remote,
      cycleGroupId,
    };
  }

  flushBubble();

  const lastGroupBubbleIndex = new Map();
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.type !== 'bubble' || !segment.cycleGroupId) {
      continue;
    }

    const previousIndex = lastGroupBubbleIndex.get(segment.cycleGroupId);
    if (Number.isInteger(previousIndex) && previousIndex >= 0) {
      for (let innerIndex = previousIndex + 1; innerIndex < index; innerIndex += 1) {
        if (segments[innerIndex].type === 'text') {
          segments[innerIndex].connector = true;
        }
      }
    }

    lastGroupBubbleIndex.set(segment.cycleGroupId, index);
  }

  return segments
    .map((segment) => {
      if (segment.type === 'text') {
        const textHtml = escapeHtml(normalizeSubSegLineBreaks(segment.text)).replaceAll('\n', '<br>');
        return segment.connector ? `<span class="langunit-connector">${textHtml}</span>` : textHtml;
      }

      if (segment.type === 'bubble') {
        const count = Math.max(1, getLangUnitReferenceCount(segment.langUnitId));
        const remoteAttr = segment.remote ? ' data-langunit-remote="1"' : '';
        const countAttr = segment.remote || count <= 1 ? '' : ` data-langunit-count="${count}"`;
        const sourceTextAttr = segment.sourceText && segment.sourceText !== segment.text
          ? ` data-langunit-source-text="${escapeHtml(segment.sourceText)}"`
          : '';
        const cycleGroupAttr = segment.cycleGroupId
          ? ` data-langunit-cycle-group-id="${escapeHtml(segment.cycleGroupId)}"`
          : '';
        return `<span class="langunit-bubble" data-langunit-id="${escapeHtml(segment.langUnitId)}"${remoteAttr}${countAttr}${sourceTextAttr}${cycleGroupAttr}>${escapeHtml(segment.text)}</span>`;
      }

      return '';
    })
    .join('');
}

function renderSubSegList(audSegItem) {
  const audSegId = audSegItem?._id || '';
  ensureRootSubSegItem(audSegId);
  const subSegEntries = getSubSegEntriesInTreeOrder(audSegId);
  const valueBySubSegId = new Map(
    [...subSegDraftTextBySubSegId.entries()].filter(([key]) => subSegEntries.some(({ item }) => String(item?._id ?? '') === key))
  );
  const renderEditor = ({ item: subSegItem, depth = 0, parentSubSegId: renderParentSubSegId = '' }) => {
    const subSegId = String(subSegItem?._id ?? '');
    const linkTargetLangUnitId = getSubSegLinkTargetLangUnitId(subSegItem);
    const parentSubSegId = String(renderParentSubSegId || getSubSegParentSubSegId(subSegItem)).trim();
    const value = valueBySubSegId.get(subSegId);
    const renderedContent = subSegItem?.content ? renderSubSegContentTokens(subSegItem.content, subSegId) : '';
    const hasLangUnitRefs = Array.isArray(subSegItem?.content) && subSegItem.content.some((token) => token?.type === 'langUnitRef');
    const content = value != null || hasLangUnitRefs
      ? normalizeSubSegEditorMarkup(value ?? renderedContent)
      : escapeHtml(normalizeSubSegLineBreaks(subSegItem?.text ?? '')).replaceAll('\n', '<br>') || renderedContent;
    return `
      <li class="item__subseg${subSegItem?.isRoot === false ? ' item__subseg--cycle' : ' item__subseg--seed'}" style="--subseg-depth: ${Math.max(0, Number(depth) || 0)};" data-subseg-id="${escapeHtml(subSegId)}" data-subseg-audseg-id="${escapeHtml(audSegId)}" data-subseg-is-root="${subSegItem?.isRoot === false ? '0' : '1'}">
        <div
          class="item__subseg-input${subSegItem?.isRoot === false && !content ? ' item__subseg-input--placeholder' : ''}"
          aria-label="subSeg input"
          role="textbox"
          contenteditable="true"
          spellcheck="false"
          data-subseg-id="${escapeHtml(subSegId)}"
          data-subseg-audseg-id="${escapeHtml(audSegId)}"
          data-subseg-is-root="${subSegItem?.isRoot === false ? '0' : '1'}"
          ${linkTargetLangUnitId ? ` data-link-target-langunit-id="${escapeHtml(linkTargetLangUnitId)}"` : ''}
          ${parentSubSegId ? ` data-parent-subseg-id="${escapeHtml(parentSubSegId)}"` : ''}
          ${subSegItem?.isRoot === false ? ' data-placeholder="no subSeg yet.."' : ''}
        >${subSegItem?.isRoot === false && !content ? '' : content}</div>
      </li>
    `;
  };

  const items = [];
  items.push(...subSegEntries.map((entry) => renderEditor(entry)));

  return `
    <ul class="item__subsegs" aria-label="subSegs">
      ${items.join('')}
    </ul>
  `;
}

function renderLangUnitRefsList(audSegItem) {
  const audSegId = audSegItem?._id || '';
  const target = getLangUnitRefListTarget(audSegId);
  const { langUnitId } = target;
  const links = getLangUnitRefRows(audSegId, target);

  if (!langUnitId || !links.length) {
    clampLangUnitRefState(0);
    return '<ul class="item__langunit-refs" hidden></ul>';
  }

  clampLangUnitRefState(links.length);
  const langUnit = getLangUnitItem(langUnitId);
  const context = getLangUnitContextText(langUnit) || String(getLangUnitText(langUnit) ?? '').trim();
  const items = links
    .map(
      (ref) => `
        <li class="item__langunit-ref${ref.index === state.langUnitRefTargetIndex ? ' is-targeted' : ''}${ref.index === state.enteredLangUnitRefIndex ? ' is-entered' : ''}" tabindex="-1" data-ref-index="${ref.index}" data-ref-key="${escapeHtml(ref.key)}" data-subseg-id="${escapeHtml(String(ref?.subSegId ?? ''))}" data-audseg-id="${escapeHtml(String(ref?.audSegId ?? ''))}" data-langunit-id="${escapeHtml(langUnitId)}">
      <span class="item__langunit-ref-badge">${escapeHtml(String(ref?.badge ?? ''))}</span>
      ${ref.index === state.enteredLangUnitRefIndex ? `
        <span class="item__langunit-ref-context">${escapeHtml(String(ref?.text || context)).replaceAll('\n', '<br>')}</span>
        <span class="item__langunit-ref-graph" tabindex="0" data-ref-key="${escapeHtml(ref.key)}">
          <canvas class="item__langunit-ref-canvas" data-ref-key="${escapeHtml(ref.key)}"></canvas>
        </span>
      ` : ''}
        </li>
      `
    )
    .join('');

  return `
    <ul class="item__langunit-refs">
      ${items}
    </ul>
  `;
}

function getLangUnitRefRows(audSegId, target = getLangUnitRefListTarget(audSegId)) {
  const langUnitId = String(target?.langUnitId ?? '').trim();
  const links = [];
  const seen = new Set();
  if (!langUnitId) {
    return links;
  }

  for (const subSegItem of sortSubSegItems(state.subSegItems)) {
    const itemSubSegId = String(subSegItem?._id ?? '').trim();
    const itemAudSegId = String(subSegItem?.audSegId ?? '').trim();
    if (!itemSubSegId || !itemAudSegId) {
      continue;
    }

    const tokens = getSubSegContentTokens(itemAudSegId, itemSubSegId);
    if (!tokens.some((token) => token?.type === 'langUnitRef' && String(token.langUnitId ?? '') === langUnitId)) {
      continue;
    }

    const ref = {
      audSegId: itemAudSegId,
      subSegId: itemSubSegId,
      langUnitId,
      text: String(subSegItem?.text ?? '').trim(),
      badge: getLangUnitRefBadgeText(subSegItem),
    };
    const refKey = getLangUnitRefKey(ref);
    if (isSameVisibleLangUnitRefTarget(ref, target) || seen.has(refKey)) {
      continue;
    }

    seen.add(refKey);
    links.push({ ...ref, key: refKey, index: links.length });
  }

  return links;
}

function getLangUnitRefKey(ref) {
  return [
    String(ref?.audSegId ?? '').trim(),
    String(ref?.subSegId ?? '').trim(),
    String(ref?.langUnitId ?? '').trim(),
  ].map(encodeURIComponent).join('|');
}

function clampLangUnitRefState(rowCount) {
  if (rowCount <= 0) {
    state.langUnitRefTargetIndex = -1;
    state.enteredLangUnitRefIndex = -1;
    return;
  }

  if (state.langUnitRefTargetIndex >= rowCount) {
    state.langUnitRefTargetIndex = rowCount - 1;
  }
  if (state.enteredLangUnitRefIndex >= rowCount) {
    state.enteredLangUnitRefIndex = -1;
  }
}

function getLangUnitRefBadgeText(subSegItem) {
  const audSegItem = getAudSegItemById(String(subSegItem?.audSegId ?? ''));
  const audEpIndex = getAudEpIndexForAudSegItem(audSegItem);
  const audSegIndex = getAudSegItemsForAudEp(audEpIndex).findIndex((item) => item?._id === audSegItem?._id);
  const subSegKind = subSegItem?.isRoot === false ? 'child' : 'root';
  return `A${audEpIndex + 1}:S${audSegIndex + 1}:${subSegKind}`;
}

function isSameVisibleLangUnitRefTarget(ref, target) {
  const refAudSegId = String(ref?.audSegId ?? '').trim();
  const refSubSegId = String(ref?.subSegId ?? '').trim();
  const targetAudSegId = String(target?.audSegId ?? '').trim();
  const targetSubSegId = String(target?.subSegId ?? '').trim();
  return Boolean(refAudSegId && refSubSegId && refAudSegId === targetAudSegId && refSubSegId === targetSubSegId);
}

function getLangUnitRefListTarget(audSegId) {
  let target = { audSegId, subSegId: '', parentSubSegId: '', langUnitId: '' };
  for (const { item, parentSubSegId = '' } of getSubSegEntriesInTreeOrder(audSegId)) {
    const subSegId = String(item?._id ?? '');
    const langUnitId = getTargetedLangUnitIdForSubSeg(audSegId, subSegId);
    if (langUnitId) {
      target = { audSegId, subSegId, parentSubSegId, langUnitId };
    }
  }

  return target;
}

function buildLangUnitRefGraph(ref) {
  const targetAudSegId = String(ref?.audSegId ?? ref?.audsegId ?? '').trim();
  const targetSubSegId = String(ref?.subSegId ?? ref?.subsegId ?? '').trim();
  const targetLangUnitId = String(ref?.langUnitId ?? ref?.langunitId ?? '').trim();
  const targetAudSeg = getAudSegItemById(targetAudSegId);
  const targetAudEpId = String(targetAudSeg?.audEpId ?? '').trim();
  const nodes = [];
  const edges = [];
  const nodeById = new Map();
  const pathIds = new Set(['origin']);
  let focusNodeId = '';
  let nextY = 0;

  const addNode = (node) => {
    if (nodeById.has(node.id)) {
      return nodeById.get(node.id);
    }
    nodeById.set(node.id, node);
    nodes.push(node);
    return node;
  };
  const addEdge = (from, to) => {
    if (nodeById.has(from) && nodeById.has(to)) {
      edges.push({ from, to, opacity: 0.15 });
    }
  };
  const allocateY = () => {
    const y = nextY;
    nextY += 58;
    return y;
  };
  const timeSpan = (audSeg) => {
    const tcs = formatTime(Number(audSeg?.tcs ?? 0));
    const tce = audSeg?.tce == null || audSeg?.tce === '' ? '  ' : formatTime(Number(audSeg.tce));
    return `${tcs}-${tce}`;
  };
  const audEpTitle = (audEp, index) => String(audEp?.audioTitle ?? audEp?.label ?? audEp?.name ?? audEp?.text ?? audEp?.media?.[audEp.media.length - 1]?.originalName ?? `episode ${index + 1}`);
  const addLangUnitInstances = (audSegId, subSegId, subNodeId, y, x) => {
    let ordinal = 0;
    for (const token of getSubSegContentTokens(audSegId, subSegId)) {
      if (token?.type !== 'langUnitRef') {
        continue;
      }

      const langUnitId = String(token.langUnitId ?? '').trim();
      const langUnit = getLangUnitItem(langUnitId);
      const instanceNodeId = `instance:${audSegId}:${subSegId}:${langUnitId}:${ordinal}`;
      const isFocus = audSegId === targetAudSegId && subSegId === targetSubSegId && langUnitId === targetLangUnitId && !focusNodeId;
      const sameLangUnit = langUnitId === targetLangUnitId;
      addNode({
        id: instanceNodeId,
        kind: 'instance',
        langUnitId,
        label: getLangUnitText(langUnit) || langUnitId,
        x,
        y: y + ordinal * 30,
        opacity: isFocus ? 1 : sameLangUnit ? 0.5 : 0.15,
        target: isFocus,
      });
      addEdge(subNodeId, instanceNodeId);
      if (isFocus) {
        focusNodeId = instanceNodeId;
        pathIds.add(instanceNodeId);
        addDownstreamLangUnitRefGraph(instanceNodeId, audSegId, langUnitId, x + 180, y + 58, pathIds, addNode, addEdge);
      }
      ordinal += 1;
    }
    return ordinal;
  };

  addNode({ id: 'origin', kind: 'origin', label: '', x: 0, y: 0, opacity: 1, target: false });

  state.audEpItems.forEach((audEp, epIndex) => {
    const audEpId = String(audEp?._id ?? '').trim();
    if (!audEpId) {
      return;
    }

    const epNodeId = `audEp:${audEpId}`;
    const epY = allocateY();
    addNode({ id: epNodeId, kind: 'audEp', label: audEpTitle(audEp, epIndex), x: 160, y: epY, opacity: 0.15, target: audEpId === targetAudEpId });
    addEdge('origin', epNodeId);
    if (audEpId === targetAudEpId) {
      pathIds.add(epNodeId);
    }

    getAudSegItemsForAudEp(epIndex).forEach((audSeg, segIndex) => {
      const audSegId = String(audSeg?._id ?? '').trim();
      if (!audSegId) {
        return;
      }

      const segY = allocateY();
      const segNodeId = `audSeg:${audSegId}`;
      addNode({ id: segNodeId, kind: 'audSeg', label: timeSpan(audSeg), x: 320, y: segY, opacity: 0.15, target: audSegId === targetAudSegId });
      addEdge(epNodeId, segNodeId);
      if (audSegId === targetAudSegId) {
        pathIds.add(segNodeId);
      }

      getSubSegItemsForAudSeg(audSegId).forEach((subSeg, subIndex) => {
        const subSegId = String(subSeg?._id ?? '').trim();
        if (!subSegId) {
          return;
        }

        const subY = allocateY();
        const subNodeId = `subSeg:${subSegId}`;
        const label = String(subSeg?.text ?? '').trim() || (subSeg?.isRoot === false ? 'child' : 'root');
        addNode({ id: subNodeId, kind: 'subSeg', label, parts: getSubSegGraphParts(audSegId, subSegId, label), x: 500, y: subY, opacity: 0.15, target: subSegId === targetSubSegId });
        addEdge(segNodeId, subNodeId);
        if (subSegId === targetSubSegId) {
          pathIds.add(subNodeId);
        }

        const instanceCount = addLangUnitInstances(audSegId, subSegId, subNodeId, subY, 700);
        nextY += Math.max(0, instanceCount - 1) * 30;
      });
    });
  });

  for (const node of nodes) {
    if (pathIds.has(node.id)) {
      node.opacity = 1;
    }
  }
  for (const edge of edges) {
    edge.opacity = pathIds.has(edge.from) && pathIds.has(edge.to) ? 1 : nodeById.get(edge.to)?.opacity ?? 0.15;
  }
  if (focusNodeId) {
    for (const node of nodes) {
      if (node.kind === 'instance' && node.id !== focusNodeId && node.langUnitId === targetLangUnitId) {
        edges.push({ from: focusNodeId, to: node.id, opacity: 0.5, dashed: true });
      }
    }
  }

  return { nodes, edges, focusNodeId };
}

function addDownstreamLangUnitRefGraph(fromNodeId, audSegId, langUnitId, x, y, pathIds, addNode, addEdge, seen = new Set()) {
  const targetId = getLangUnitCycleTargetId(langUnitId);
  const seenKey = `${audSegId}\u0000${targetId}`;
  if (!targetId || seen.has(seenKey)) {
    return y;
  }

  seen.add(seenKey);
  let cursorY = y;
  const children = sortSubSegItems(state.subSegItems).filter(
    (item) =>
      item?.isRoot === false &&
      getLangUnitCycleTargetId(getSubSegLinkTargetLangUnitId(item)) === targetId
  );

  for (const child of children) {
    const childSubSegId = String(child?._id ?? '').trim();
    if (!childSubSegId) {
      continue;
    }
    const childAudSegId = String(child?.audSegId ?? '').trim();

    const subNodeId = `downSubSeg:${fromNodeId}:${childSubSegId}`;
    const label = String(child?.text ?? '').trim() || 'child';
    addNode({
      id: subNodeId,
      kind: 'subSeg',
      label,
      parts: getSubSegGraphParts(childAudSegId, childSubSegId, label),
      x,
      y: cursorY,
      opacity: 1,
      target: false,
    });
    pathIds.add(subNodeId);
    addEdge(fromNodeId, subNodeId);

    let ordinal = 0;
    for (const token of getSubSegContentTokens(childAudSegId, childSubSegId)) {
      if (token?.type !== 'langUnitRef') {
        continue;
      }

      const childLangUnitId = String(token.langUnitId ?? '').trim();
      const langUnit = getLangUnitItem(childLangUnitId);
      const instanceNodeId = `downInstance:${subNodeId}:${childLangUnitId}:${ordinal}`;
      addNode({
        id: instanceNodeId,
        kind: 'instance',
        langUnitId: childLangUnitId,
        label: getLangUnitText(langUnit) || childLangUnitId,
        x: x + 180,
        y: cursorY + ordinal * 30,
        opacity: 1,
        target: false,
      });
      pathIds.add(instanceNodeId);
      addEdge(subNodeId, instanceNodeId);
      cursorY = Math.max(cursorY, addDownstreamLangUnitRefGraph(instanceNodeId, childAudSegId, childLangUnitId, x + 360, cursorY + 58, pathIds, addNode, addEdge, seen));
      ordinal += 1;
    }

    cursorY += Math.max(90, ordinal * 30 + 58);
  }

  return cursorY;
}

function getSubSegGraphParts(audSegId, subSegId, fallback = '') {
  const parts = [];
  for (const token of getSubSegContentTokens(audSegId, subSegId)) {
    if (token?.type === 'text') {
      parts.push({ type: 'text', text: String(token.text ?? '') });
    } else if (token?.type === 'langUnitRef') {
      const langUnitId = String(token.langUnitId ?? '').trim();
      parts.push({ type: 'langUnit', text: getLangUnitText(getLangUnitItem(langUnitId)) || langUnitId });
    }
  }
  return parts.length ? parts : [{ type: 'text', text: fallback }];
}

function getLangUnitRefGraphView(refKey, graph, canvas) {
  const existing = langUnitRefGraphViewByKey.get(refKey);
  if (existing) {
    return existing;
  }

  const focus = graph.nodes.find((node) => node.id === graph.focusNodeId) ?? graph.nodes[0];
  const view = {
    scale: 1.35,
    x: (canvas.clientWidth || 320) / 2 - (focus?.x ?? 0) * 1.35,
    y: (canvas.clientHeight || 220) / 2 - (focus?.y ?? 0) * 1.35,
  };
  langUnitRefGraphViewByKey.set(refKey, view);
  return view;
}

function drawLangUnitRefGraphCanvas(canvas) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  const row = canvas.closest('.item__langunit-ref');
  const ref = row instanceof HTMLElement ? row.dataset : {};
  const refKey = String(ref.refKey ?? '').trim();
  const graph = buildLangUnitRefGraph(ref);
  const view = getLangUnitRefGraphView(refKey, graph, canvas);
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, canvas.clientWidth || 320);
  const height = Math.max(1, canvas.clientHeight || 220);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const sx = (x) => x * view.scale + view.x;
  const sy = (y) => y * view.scale + view.y;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  ctx.lineWidth = 1.5;
  for (const edge of graph.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) {
      continue;
    }
    ctx.globalAlpha = edge.opacity;
    ctx.strokeStyle = '#495057';
    ctx.setLineDash(edge.dashed ? [4, 4] : []);
    ctx.beginPath();
    ctx.moveTo(sx(from.x), sy(from.y));
    ctx.lineTo(sx(to.x), sy(to.y));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const node of graph.nodes) {
    const x = sx(node.x);
    const y = sy(node.y);
    ctx.globalAlpha = node.opacity;
    if (node.kind === 'origin') {
      ctx.fillStyle = '#0b63ce';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (node.kind === 'subSeg') {
      drawSubSegGraphNode(ctx, node, x, y);
      continue;
    }

    const label = String(node.label ?? '');
    const fontSize = node.kind === 'instance' ? 10 : 9;
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    const widthPx = Math.max(18, ctx.measureText(label).width + 8);
    const heightPx = fontSize + 8;
    ctx.fillStyle = node.kind === 'instance' ? '#fff7d6' : '#f1f3f5';
    ctx.strokeStyle = node.target ? '#0b63ce' : '#222';
    ctx.lineWidth = node.target ? 2 : 1;
    roundRectPath(ctx, x - widthPx / 2, y - heightPx / 2, widthPx, heightPx, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111';
    drawWrappedCanvasText(ctx, label, x, y, widthPx - 8, heightPx - 4, fontSize);
  }
  ctx.globalAlpha = 1;
}

function measureSubSegGraphNode(ctx, node) {
  const fontSize = 9;
  const gap = 2;
  const padX = 5;
  const parts = Array.isArray(node.parts) && node.parts.length ? node.parts : [{ type: 'text', text: node.label }];
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  const contentWidth = parts.reduce((sum, part, index) => {
    const text = String(part.text ?? '');
    const width = part.type === 'langUnit' ? ctx.measureText(text).width + 8 : ctx.measureText(text).width;
    return sum + width + (index ? gap : 0);
  }, 0);
  return { width: Math.max(18, contentWidth + padX * 2), height: fontSize + 10, fontSize, gap, padX };
}

function drawSubSegGraphNode(ctx, node, x, y) {
  const box = measureSubSegGraphNode(ctx, node);
  const parts = Array.isArray(node.parts) && node.parts.length ? node.parts : [{ type: 'text', text: node.label }];
  const left = x - box.width / 2;
  const top = y - box.height / 2;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = node.target ? '#0b63ce' : '#222';
  ctx.lineWidth = node.target ? 2 : 1;
  roundRectPath(ctx, left, top, box.width, box.height, 2);
  ctx.fill();
  ctx.stroke();

  ctx.font = `${box.fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let cursorX = left + box.padX;
  for (const part of parts) {
    const text = String(part.text ?? '');
    if (part.type === 'langUnit') {
      const bubbleWidth = ctx.measureText(text).width + 8;
      const bubbleHeight = box.fontSize + 6;
      roundRectPath(ctx, cursorX, y - bubbleHeight / 2, bubbleWidth, bubbleHeight, 5);
      ctx.fillStyle = '#eef3ff';
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.fillText(text, cursorX + 4, y);
      cursorX += bubbleWidth + box.gap;
    } else {
      ctx.fillStyle = '#111';
      ctx.fillText(text, cursorX, y);
      cursorX += ctx.measureText(text).width + box.gap;
    }
  }
  ctx.textAlign = 'center';
}

function drawWrappedCanvasText(ctx, text, x, y, maxWidth, maxHeight, fontSize) {
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  const lineHeight = fontSize + 2;
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  const pushBrokenWord = (word) => {
    let chunk = '';
    for (const char of word) {
      if (ctx.measureText(chunk + char).width > maxWidth && chunk) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    if (chunk) {
      lines.push(chunk);
    }
  };

  for (const word of words.length ? words : ['']) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) {
      lines.push(line);
      line = '';
    }
    if (ctx.measureText(word).width > maxWidth) {
      pushBrokenWord(word);
    } else {
      line = word;
    }
  }
  if (line) {
    lines.push(line);
  }

  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length) {
    visible[visible.length - 1] = `${visible[visible.length - 1].slice(0, Math.max(1, visible[visible.length - 1].length - 3))}...`;
  }

  const startY = y - ((visible.length - 1) * lineHeight) / 2;
  visible.forEach((lineText, index) => ctx.fillText(lineText, x, startY + index * lineHeight));
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function syncLangUnitRefGraphCanvases() {
  audEpList.querySelectorAll('.item__langunit-ref-canvas').forEach((canvas) => {
    const graph = canvas.closest('.item__langunit-ref-graph');
    if (graph instanceof HTMLElement && langUnitRefResizeObserver && !observedLangUnitRefGraphs.has(graph)) {
      observedLangUnitRefGraphs.add(graph);
      langUnitRefResizeObserver.observe(graph);
    }
    requestAnimationFrame(() => drawLangUnitRefGraphCanvas(canvas));
  });
}

const LANG_UNIT_CONTEXT_BOUNDARIES = new Set(['\r', '\n', '\u2028', '\u2029', '.', '。', '．', '｡']);

function isLangUnitContextBoundary(char) {
  return LANG_UNIT_CONTEXT_BOUNDARIES.has(char);
}

function getLangUnitBubbleContext(text, start, end) {
  let contextStart = 0;
  for (let index = start - 1; index >= 0; index -= 1) {
    if (isLangUnitContextBoundary(text[index])) {
      contextStart = index + 1;
      break;
    }
  }

  let contextEnd = text.length;
  for (let index = end; index < text.length; index += 1) {
    if (isLangUnitContextBoundary(text[index])) {
      contextEnd = index;
      break;
    }
  }

  return text.slice(contextStart, contextEnd);
}

function getLangUnitContextType(text) {
  const value = String(text ?? '').trim();
  if (!value) {
    return 'engWord';
  }

  const hasChineseCharacters = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(value);
  const letterTokens = value.split(/[^A-Za-z1-5]+/).filter(Boolean);
  const hasSpaces = /\s/.test(value);
  const onlyEnglishishChars = /^[A-Za-z0-9\s\p{P}\p{S}]+$/u.test(value);
  const allTokensArePinyin = letterTokens.length > 0 && letterTokens.every((token) => countPinyinSyllables(token) > 0);

  if (hasChineseCharacters) {
    if (!/[A-Za-z]/.test(value) || allTokensArePinyin) {
      return 'chinPhrase';
    }

    return 'engPhrase';
  }

  if (onlyEnglishishChars && allTokensArePinyin) {
    const pinyinSyllableCount = letterTokens.reduce((count, token) => count + countPinyinSyllables(token), 0);
    return pinyinSyllableCount >= 2 ? 'chinPhrase' : 'chinFuzzWord';
  }

  if (hasSpaces) {
    return 'engPhrase';
  }

  return 'engWord';
}

function countPinyinSyllables(text) {
  const value = String(text ?? '').toLowerCase().replace(/[1-5]/g, '');
  if (!value) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (index < value.length) {
    let matched = '';
    for (let end = value.length; end > index; end -= 1) {
      const chunk = value.slice(index, end);
      if (PINYIN_SYLLABLES.has(chunk)) {
        matched = chunk;
        break;
      }
    }

    if (!matched) {
      return 0;
    }

    count += 1;
    index += matched.length;
  }

  return count;
}

const PINYIN_INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's'];
const PINYIN_FINALS = [
  'a', 'ai', 'an', 'ang', 'ao', 'e', 'ei', 'en', 'eng', 'er',
  'o', 'ong', 'ou', 'i', 'ia', 'ian', 'iang', 'iao', 'ie', 'in', 'ing', 'iong',
  'u', 'ua', 'uai', 'uan', 'uang', 'ui', 'un', 'uo', 'v', 've', 'van', 'vn',
];
const PINYIN_SYLLABLES = new Set([
  'zhi', 'chi', 'shi', 'ri', 'zi', 'ci', 'si', 'yi', 'wu', 'yu', 'yue', 'yuan', 'yun', 'yin', 'ying',
  'ng', 'hm', 'hng',
  ...PINYIN_INITIALS.flatMap((initial) => PINYIN_FINALS.map((final) => `${initial}${final}`)),
  ...PINYIN_FINALS,
]);

function createLangUnitContext(text) {
  const value = String(text ?? '');
  return {
    text: value,
    type: getLangUnitContextType(value),
  };
}

function countChineseCharacters(value) {
  return String(value ?? '').match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
}

function isPunctuationOrSymbolOnly(value) {
  const text = String(value ?? '').trim();
  return Boolean(text) && /^[\p{P}\p{S}\s]+$/u.test(text) && !/[A-Za-z0-9\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(text);
}

function normalizeLangUnitTargetType(type) {
  const value = String(type ?? '').trim();
  if (value === 'engPart') {
    return 'engWordPart';
  }

  return value === 'chinChar' ||
    value === 'chinWord' ||
    value === 'chinPhrase' ||
    value === 'chinFuzz' ||
    value === 'chinFuzzPart' ||
    value === 'engWordPart' ||
    value === 'engWord' ||
    value === 'engPhrase' ||
    value === 'no-op'
    ? value
    : '';
}

function isEnglishWordPartSelection(text, start, end) {
  const value = String(text ?? '');
  const left = start > 0 ? value[start - 1] : '';
  const right = Number.isInteger(end) && end < value.length ? value[end] : '';
  return /[A-Za-z0-9]/.test(left) || /[A-Za-z0-9]/.test(right);
}

function getLangUnitTargetType(text, contextType = '', selection = {}) {
  const value = String(text ?? '').trim();
  const normalizedContextType = String(contextType ?? '').trim();
  const selectionText = String(selection.text ?? '');
  const selectionStart = Number.isInteger(selection.start) ? selection.start : null;
  const selectionEnd = Number.isInteger(selection.end) ? selection.end : null;
  if (!value || isPunctuationOrSymbolOnly(value)) {
    return 'no-op';
  }

  const chineseCharCount = countChineseCharacters(value);
  const hasChineseCharacters = chineseCharCount > 0;
  const hasLatinCharacters = /[A-Za-z]/.test(value);
  const letterTokens = value.split(/[^A-Za-z1-5]+/).filter(Boolean);
  const hasSpaces = /\s/.test(value);
  const onlyEnglishishChars = /^[A-Za-z0-9\s\p{P}\p{S}]+$/u.test(value);
  const allTokensArePinyin = letterTokens.length > 0 && letterTokens.every((token) => countPinyinSyllables(token) > 0);
  const pinyinSyllableCount = letterTokens.reduce((count, token) => count + countPinyinSyllables(token), 0);

  if (hasChineseCharacters && !hasLatinCharacters) {
    if (chineseCharCount === 1) {
      return 'chinChar';
    }

    return chineseCharCount === 2 ? 'chinWord' : 'chinPhrase';
  }

  if (hasChineseCharacters) {
    if (normalizedContextType === 'chinFuzzWord') {
      return 'chinFuzzPart';
    }

    if (normalizedContextType === 'engPhrase') {
      return 'chinPhrase';
    }

    return 'chinFuzz';
  }

  if (normalizedContextType === 'engPhrase' && onlyEnglishishChars) {
    if (isEnglishWordPartSelection(selectionText || value, selectionStart, selectionEnd)) {
      return 'engWordPart';
    }

    return hasSpaces ? 'engPhrase' : 'engWord';
  }

  if (onlyEnglishishChars && allTokensArePinyin) {
    if (normalizedContextType === 'chinFuzzWord') {
      return 'chinFuzzPart';
    }

    if (normalizedContextType === 'engWord') {
      return pinyinSyllableCount >= 2 ? 'chinFuzz' : 'engWordPart';
    }

    if (normalizedContextType === 'engPhrase') {
      return pinyinSyllableCount >= 2 ? 'chinFuzz' : 'engWord';
    }

    return pinyinSyllableCount >= 2 ? 'chinFuzz' : 'chinFuzz';
  }

  if (hasSpaces) {
    return 'engPhrase';
  }

  if (normalizedContextType === 'engWord') {
    return 'engWordPart';
  }

  if (normalizedContextType === 'chinFuzzWord') {
    return 'engWord';
  }

  return 'engWord';
}

function createLangUnitTarget(text, contextType = '', selection = {}) {
  const value = String(text ?? '');
  return {
    text: value,
    type: getLangUnitTargetType(value, contextType, selection),
  };
}

function normalizeLangUnitTarget(target, contextType = '', selection = {}) {
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const type = normalizeLangUnitTargetType(target.type);
    if (type) {
      return {
        text: String(target.text ?? ''),
        type,
      };
    }

    return createLangUnitTarget(target.text ?? '', contextType, selection);
  }

  return createLangUnitTarget(target ?? '', contextType, selection);
}

function extractSubSegEditorPayload(editor) {
  if (!(editor instanceof HTMLElement)) {
    return { content: [], langUnits: [] };
  }

  const content = [];
  const langUnitsById = new Map();
  const langUnitIdRemap = new Map();
  const pendingInstances = [];
  const audSegId = editor.dataset.subsegAudsegId || '';
  const subSegId = getSubSegEditorKey(editor);
  const isRoot = editor.dataset.subsegIsRoot !== '0';
  const linkTargetLangUnitId = getSubSegEditorLinkTargetLangUnitId(editor);
  const parentSubSegId = String(editor.getAttribute('data-parent-subseg-id') ?? '').trim();
  const cycleTargetActive = getSubSegBubbleTargetIndex(editor) >= 0;
  const nextDerivedLangUnitOrdinal = { value: getNextLangUnitOrdinal(editor, subSegId) };
  let plainText = '';
  const appendContentText = (text) => {
    if (!text) {
      return;
    }

    for (const chunk of String(text).split(/(\n)/)) {
      if (!chunk) {
        continue;
      }

      const last = content[content.length - 1];
      if (chunk !== '\n' && last?.type === 'text') {
        last.text += chunk;
        continue;
      }

      content.push({ type: 'text', text: chunk });
    }
  };

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeSubSegLineBreaks(node.textContent);
      plainText += text;
      appendContentText(text);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    if (node.tagName === 'BR') {
      plainText += '\n';
      appendContentText('\n');
      return;
    }

    if (isBreakPlaceholderBlock(node)) {
      plainText += '\n';
      appendContentText('\n');
      return;
    }

    if (node.tagName === 'SPAN' && node.classList.contains('langunit-bubble')) {
      const bubbleText = String(node.getAttribute('data-langunit-source-text') ?? node.textContent ?? '').trim();
      const rawLangUnitId = String(node.getAttribute('data-langunit-id') ?? '').trim();
      let langUnitId = rawLangUnitId;
      if (langUnitId) {
        const prefix = `${subSegId}-`;
        if (!langUnitId.startsWith(prefix) && !getLangUnitItem(langUnitId)) {
          if (langUnitIdRemap.has(langUnitId)) {
            langUnitId = langUnitIdRemap.get(langUnitId);
          } else {
            langUnitId = buildLangUnitId(subSegId, nextDerivedLangUnitOrdinal.value) || createItemId();
            nextDerivedLangUnitOrdinal.value += 1;
            langUnitIdRemap.set(rawLangUnitId, langUnitId);
          }
          node.setAttribute('data-langunit-id', langUnitId);
        }
      } else {
        langUnitId = buildLangUnitId(subSegId, nextDerivedLangUnitOrdinal.value) || createItemId();
        nextDerivedLangUnitOrdinal.value += 1;
        node.setAttribute('data-langunit-id', langUnitId);
      }

      const start = plainText.length;
      plainText += bubbleText;
      const existing = langUnitsById.get(langUnitId);
      const cycleGroupId = String(node.getAttribute('data-langunit-cycle-group-id') ?? '').trim();
      if (!existing) {
        langUnitsById.set(langUnitId, {
          _id: langUnitId,
          text: bubbleText,
          instances: [],
        });
      }
      const instance = {
        ...(audSegId ? { audSegId } : {}),
        ...(subSegId ? { subSegId } : {}),
        langUnitId,
        remote: cycleTargetActive && Boolean(existing),
        ...(cycleGroupId ? { cycleGroupId } : {}),
        start,
        end: plainText.length,
        text: bubbleText,
      };
      langUnitsById.get(langUnitId).instances.push(instance);
      pendingInstances.push(instance);
      content.push({ type: 'langUnitRef', langUnitId, remote: cycleTargetActive && Boolean(existing) });
      return;
    }

    for (const child of node.childNodes) {
      walk(child);
    }

    if (node.tagName === 'DIV' || node.tagName === 'P' || node.tagName === 'LI') {
      if (isBreakPlaceholderBlock(node)) {
        return;
      }
      plainText += '\n';
      appendContentText('\n');
    }
  };

  for (const child of editor.childNodes) {
    walk(child);
  }

  for (const instance of pendingInstances) {
    instance.context = createLangUnitContext(getLangUnitBubbleContext(plainText, instance.start, instance.end));
    instance.target = createLangUnitTarget(instance.text ?? '', instance.context.type, {
      text: plainText,
      start: instance.start,
      end: instance.end,
    });
    const langUnit = langUnitsById.get(instance.langUnitId);
    if (langUnit && !langUnit.target) {
      langUnit.target = instance.target;
    }
    delete instance.langUnitId;
  }

  const langUnits = [...langUnitsById.values()].map((langUnit) => {
    const instances = Array.isArray(langUnit.instances) ? langUnit.instances : [];
    const primaryInstance = instances[0] ?? null;
    return {
      ...langUnit,
      target: normalizeLangUnitTarget(primaryInstance?.target ?? langUnit.text ?? '', primaryInstance?.context?.type ?? '', {
        text: langUnit.text,
        start: primaryInstance?.start,
        end: primaryInstance?.end,
      }),
      instances,
    };
  });

  return {
    subSegId,
    audSegId,
    isRoot,
    ...(linkTargetLangUnitId ? { linkTargetLangUnitId } : {}),
    ...(parentSubSegId ? { parentSubSegId } : {}),
    content,
    langUnits,
    text: getSubSegEditorText(editor),
  };
}

function autosizeSubSegInput(input) {
  if (!(input instanceof HTMLElement)) {
    return;
  }

  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
}

function syncSubSegTextareaHeights() {
  audEpList.querySelectorAll('.item__subseg-input').forEach((input) => {
    autosizeSubSegInput(input);
  });
}

function lockEnteredAudSegWidths() {
  audEpList.querySelectorAll('.item__segment--entered').forEach((segment) => {
    if (!(segment instanceof HTMLElement)) {
      return;
    }

    const width = Math.ceil(segment.getBoundingClientRect().width);
    if (!Number.isFinite(width) || width <= 0) {
      return;
    }

    segment.style.width = `${width}px`;
    segment.style.maxWidth = `${width}px`;

    const input = segment.querySelector('.item__subseg-input');
    if (input instanceof HTMLElement) {
      input.style.maxWidth = '100%';
    }
  });
}

function getSubSegEditorText(editor) {
  if (!(editor instanceof HTMLElement)) {
    return '';
  }

  return normalizeSubSegLineBreaks(editor.innerText).replace(/\u00a0/g, ' ');
}

function getSubSegEditorMarkup(editor) {
  if (!(editor instanceof HTMLElement)) {
    return '';
  }

  return sanitizeSubSegMarkup(editor.innerHTML);
}

function normalizeSubSegEditorMarkup(value) {
  return sanitizeSubSegMarkup(String(value ?? ''));
}

function getLangUnitBubbles(editor) {
  if (!(editor instanceof HTMLElement)) {
    return [];
  }

  return [...editor.querySelectorAll('.langunit-bubble')];
}

function getLangUnitBubbleGroupIds(editor) {
  const ids = [];
  const seen = new Set();

  for (const bubble of getLangUnitBubbles(editor)) {
    const langUnitId = String(bubble?.dataset?.langunitId ?? '').trim();
    const groupId = String(bubble?.dataset?.langunitCycleGroupId ?? '').trim() || langUnitId;
    if (!groupId || seen.has(groupId)) {
      continue;
    }

    seen.add(groupId);
    ids.push(groupId);
  }

  return ids;
}

function setTargetedLangUnitBubblesAwaiting(editor, awaiting) {
  if (!(editor instanceof HTMLElement)) {
    return;
  }

  getLangUnitBubbles(editor)
    .filter((bubble) => bubble.classList.contains('is-targeted'))
    .forEach((bubble) => bubble.classList.toggle('is-awaiting', awaiting));
}

function setCaretToEnd(editor) {
  if (!(editor instanceof HTMLElement)) {
    return;
  }

  const selection = document.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getSubSegCaretTextOffset(editor) {
  const selection = document.getSelection();
  if (!selection || !selection.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode)) {
    return null;
  }

  const range = document.createRange();
  range.selectNodeContents(editor);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return normalizeSubSegLineBreaks(range.toString()).length;
}

function getSubSegTextRange(editor, start, end) {
  if (!(editor instanceof HTMLElement) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    return null;
  }

  const range = document.createRange();
  let offset = 0;
  let started = false;

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = normalizeSubSegLineBreaks(node.textContent ?? '').length;
      if (!started && start <= offset + length) {
        range.setStart(node, Math.max(0, start - offset));
        started = true;
      }
      if (started && end <= offset + length) {
        range.setEnd(node, Math.max(0, end - offset));
        return true;
      }
      offset += length;
      return false;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    if (node.tagName === 'BR') {
      offset += 1;
      return false;
    }

    for (const child of node.childNodes) {
      if (walk(child)) {
        return true;
      }
    }
    return false;
  };

  return walk(editor) && started ? range : null;
}

function getSubSegTextBeforeRange(editor, range) {
  if (!(editor instanceof HTMLElement) || !(range instanceof Range) || !editor.contains(range.startContainer)) {
    return '';
  }

  let text = '';
  let done = false;

  const walk = (node) => {
    if (done) {
      return;
    }

    if (node === range.startContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += normalizeSubSegLineBreaks(String(node.textContent ?? '').slice(0, range.startOffset));
      }
      done = true;
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      text += normalizeSubSegLineBreaks(node.textContent ?? '');
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    if (node.tagName === 'BR') {
      text += '\n';
      return;
    }

    for (const child of node.childNodes) {
      walk(child);
    }
  };

  walk(editor);
  return text;
}

function setSubSegCaretByTextOffset(editor, textOffset) {
  if (!(editor instanceof HTMLElement) || !Number.isInteger(textOffset)) {
    return false;
  }

  const selection = document.getSelection();
  if (!selection) {
    return false;
  }

  const range = document.createRange();
  let offset = 0;

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = normalizeSubSegLineBreaks(node.textContent ?? '').length;
      if (textOffset <= offset + length) {
        range.setStart(node, Math.max(0, textOffset - offset));
        range.collapse(true);
        return true;
      }
      offset += length;
      return false;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    if (node.tagName === 'BR') {
      if (textOffset <= offset + 1) {
        range.setStartAfter(node);
        range.collapse(true);
        return true;
      }
      offset += 1;
      return false;
    }

    for (const child of node.childNodes) {
      if (walk(child)) {
        return true;
      }
    }
    return false;
  };

  if (!walk(editor)) {
    return false;
  }

  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function syncLangUnitBubbleTarget(editor, restoreCaret = false) {
  if (!(editor instanceof HTMLElement)) {
    return;
  }

  const targetKey = getSubSegBubbleTargetKey(editor);
  const bubbles = getLangUnitBubbles(editor);
  const groupIds = getLangUnitBubbleGroupIds(editor);
  const targetIndex = getSubSegBubbleTargetIndex(editor);
  const targetLangUnitId = groupIds[targetIndex] ?? '';

  bubbles.forEach((bubble) => bubble.classList.remove('is-targeted', 'is-awaiting'));
  if (!bubbles.length) {
    if (targetKey) {
      langUnitBubbleTargetIndexByAudSegId.set(targetKey, -1);
      langUnitBubbleEscapeState.delete(targetKey);
    }
    if (restoreCaret) {
      setCaretToEnd(editor);
    }
    return;
  }

  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= groupIds.length) {
    if (restoreCaret) {
      setCaretToEnd(editor);
    }
    syncLangUnitRefsLists();
    return;
  }

  if (!targetLangUnitId) {
    if (restoreCaret) {
      setCaretToEnd(editor);
    }
    syncLangUnitRefsLists();
    return;
  }

  bubbles
    .filter((bubble) => getLangUnitCycleTargetId(bubble?.dataset?.langunitId) === targetLangUnitId)
    .forEach((bubble) => bubble.classList.add('is-targeted'));
  syncLangUnitRefsLists();
}

async function deleteSubSeg(subSegId) {
  if (!subSegId) {
    return false;
  }

  const response = await fetch('/api/subSegs/items', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subSegId }),
  });

  return response.ok;
}

function syncCycleSubSegRow(editor, createIfMissing = false) {
  if (!(editor instanceof HTMLElement)) {
    return false;
  }

  const audSegId = editor.dataset.subsegAudsegId || '';
  const subSegId = getSubSegEditorKey(editor);
  const targetIndex = getSubSegBubbleTargetIndex(editor);
  if (targetIndex >= 0) {
    const linkTargetLangUnitId = getOrderedLangUnitIdsForSubSeg(audSegId, subSegId)[targetIndex] ?? '';
    if (!linkTargetLangUnitId) {
      return false;
    }

    const current = getCycleSubSegItemForTarget(audSegId, linkTargetLangUnitId, subSegId, subSegId);
    if (current) {
      const recalled = getRecallSubSegItemForTarget(audSegId, linkTargetLangUnitId, subSegId, current._id);
      const currentHasContent = Array.isArray(current?.content) && current.content.length || String(current?.text ?? '').trim();
      const recalledHasContent = Array.isArray(recalled?.content) && recalled.content.length || String(recalled?.text ?? '').trim();
      if (createIfMissing && !currentHasContent && recalledHasContent) {
        const next = {
          ...current,
          content: Array.isArray(recalled.content) ? recalled.content : [],
          text: String(recalled.text ?? ''),
          updatedAt: new Date().toISOString(),
        };
        state.subSegItems = sortSubSegItems([next, ...state.subSegItems.filter((item) => String(item?._id ?? '') !== String(next._id ?? ''))]);
        void fetch('/api/subSegs/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subSegId: String(next._id ?? ''), ...next }),
        });
        return true;
      }
      return false;
    }

    if (!createIfMissing) {
      return false;
    }

    const recalled = getRecallSubSegItemForTarget(audSegId, linkTargetLangUnitId, subSegId, subSegId);
    const localProjection = getRecallSubSegItemForTarget(audSegId, linkTargetLangUnitId, subSegId, subSegId, true);
    const next = {
      _id: localProjection && getSubSegParentSubSegId(localProjection) === subSegId
        ? localProjection._id
        : buildDerivedId(audSegId, getNextSubSegOrdinal(audSegId)) || createItemId(),
      audSegId,
      isRoot: false,
      ...(linkTargetLangUnitId ? { linkTargetLangUnitId } : {}),
      parentSubSegId: subSegId,
      content: Array.isArray(recalled?.content) ? recalled.content : [],
      text: String(recalled?.text ?? ''),
      createdAt: localProjection?.createdAt || recalled?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.subSegItems = sortSubSegItems([next, ...state.subSegItems.filter((item) => String(item?._id ?? '') !== String(next._id ?? ''))]);
    void fetch('/api/subSegs/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subSegId: String(next._id ?? ''), ...next }),
    });
    return true;
  }

  return false;
}

async function focusCycleSubSegInput(editor) {
  if (!(editor instanceof HTMLElement)) {
    return false;
  }

  const audSegId = editor.dataset.subsegAudsegId || '';
  if (getSubSegBubbleTargetIndex(editor) < 0) {
    return false;
  }

  const subSegId = getSubSegEditorKey(editor);
  if (subSegDraftPayloadBySubSegId.has(subSegId)) {
    const timer = subSegSaveTimersBySubSegId.get(subSegId);
    if (timer) {
      clearTimeout(timer);
      subSegSaveTimersBySubSegId.delete(subSegId);
    }
    setTargetedLangUnitBubblesAwaiting(editor, true);
    try {
      await saveSubSeg(subSegId);
    } finally {
      setTargetedLangUnitBubblesAwaiting(editor, false);
    }
  }

  const liveEditor = getLiveSubSegEditor(subSegId);
  if (liveEditor instanceof HTMLElement) {
    editor = liveEditor;
  }

  const targetIndex = getSubSegBubbleTargetIndex(editor);
  const linkTargetLangUnitId = getOrderedLangUnitIdsForSubSeg(audSegId, subSegId)[targetIndex] ?? '';
  if (!linkTargetLangUnitId) {
    return false;
  }

  const changed = syncCycleSubSegRow(editor, true);
  const cycleEditorSelector = `.item__subseg-input[data-subseg-audseg-id="${CSS.escape(String(audSegId))}"][data-parent-subseg-id="${CSS.escape(String(subSegId))}"][data-link-target-langunit-id="${CSS.escape(String(linkTargetLangUnitId))}"]`;
  if (changed || !audEpList.querySelector(cycleEditorSelector)) {
    renderAudEps(state.audEpItems);
  }

  requestAnimationFrame(() => {
    const cycleEditor = [...audEpList.querySelectorAll(cycleEditorSelector)]
      .find((input) => input instanceof HTMLElement && String(input.dataset.subsegId ?? '') !== subSegId);
    if (cycleEditor instanceof HTMLElement) {
      cycleEditor.focus({ preventScroll: true });
      setCaretToEnd(cycleEditor);
    }
  });

  return true;
}

function cycleLangUnitBubbleTarget(editor, step) {
  if (!(editor instanceof HTMLElement) || !step) {
    return false;
  }

  const audSegId = editor.dataset.subsegAudsegId || '';
  const subSegId = getSubSegEditorKey(editor);
  const parentSubSegId = String(editor.dataset.parentSubsegId ?? '').trim();
  const caretOffset = getSubSegCaretTextOffset(editor);
  const groups = getLangUnitBubbleGroupIds(editor);
  if (!groups.length) {
    return false;
  }

  const currentIndex = getSubSegBubbleTargetIndex(editor);
  const currentLangUnitId = groups[currentIndex] ?? '';
  const slots = groups.length + 1;
  const nextIndex = ((currentIndex + 1 + step + slots) % slots) - 1;
  const nextLangUnitId = groups[nextIndex] ?? '';
  const hadVisibleChild = Boolean(currentLangUnitId && getCycleSubSegItemForTarget(audSegId, currentLangUnitId, subSegId));
  const hasNextChild = Boolean(nextLangUnitId && getCycleSubSegItemForTarget(audSegId, nextLangUnitId, subSegId));

  setSubSegBubbleTargetIndex(editor, nextIndex);
  syncLangUnitBubbleTarget(editor, false);
  const changed = syncCycleSubSegRow(editor, true);
  if (changed || hadVisibleChild || hasNextChild) {
    renderAudEps(state.audEpItems);
    requestAnimationFrame(() => {
      const parentSelector = parentSubSegId ? `[data-parent-subseg-id="${CSS.escape(parentSubSegId)}"]` : '';
      const liveEditor = audEpList.querySelector(`.item__subseg-input[data-subseg-audseg-id="${CSS.escape(String(audSegId))}"][data-subseg-id="${CSS.escape(String(subSegId))}"]${parentSelector}`);
      if (liveEditor instanceof HTMLElement) {
        syncLangUnitBubbleTarget(liveEditor, false);
        liveEditor.focus({ preventScroll: true });
        if (!setSubSegCaretByTextOffset(liveEditor, caretOffset)) {
          setCaretToEnd(liveEditor);
        }
      }
    });
  }
  return true;
}

function unwrapLangUnitBubbleTarget(editor) {
  if (!(editor instanceof HTMLElement)) {
    return false;
  }

  const audSegId = editor.dataset.subsegAudsegId || '';
  const groups = getLangUnitBubbleGroupIds(editor);
  const targetIndex = getSubSegBubbleTargetIndex(editor);
  const targetLangUnitId = groups[targetIndex] ?? '';
  if (targetIndex < 0 || !targetLangUnitId) {
    return false;
  }

  const bubbles = getLangUnitBubbles(editor).filter(
    (bubble) => getLangUnitCycleTargetId(bubble?.dataset?.langunitId) === targetLangUnitId
  );
  if (!bubbles.length) {
    return false;
  }

  let lastTextNode = null;
  for (const bubble of bubbles) {
    const textNode = document.createTextNode(bubble.textContent ?? '');
    bubble.replaceWith(textNode);
    lastTextNode = textNode;
  }

  setSubSegBubbleTargetIndex(editor, -1);
  syncLangUnitBubbleTarget(editor, true);
  syncSubSegEditorDraft(editor);
  if (lastTextNode) {
    setCaretAfterNode(lastTextNode);
  }
  return true;
}

function resetLangUnitBubbleTarget(editor, restoreCaret = false) {
  if (!(editor instanceof HTMLElement)) {
    return false;
  }

  if (getSubSegBubbleTargetIndex(editor) < 0) {
    return false;
  }

  setSubSegBubbleTargetIndex(editor, -1);
  syncLangUnitBubbleTarget(editor, restoreCaret);
  const changed = syncCycleSubSegRow(editor);
  if (changed) {
    renderAudEps(state.audEpItems);
  }
  return true;
}

function focusRootSubSegInput(audSegId, linkTargetLangUnitId = '') {
  requestAnimationFrame(() => {
    const rootSelector = `.item__subseg-input[data-subseg-audseg-id="${CSS.escape(String(audSegId))}"][data-subseg-is-root="1"]`;
    const rootEditor = audEpList.querySelector(rootSelector);
    if (rootEditor instanceof HTMLElement) {
      clearSubSegBubbleTargetsForAudSeg(audSegId);
      syncLangUnitBubbleTarget(rootEditor, false);
      const changed = syncCycleSubSegRow(rootEditor);
  if (changed) {
    renderAudEps(state.audEpItems);
  }
  requestAnimationFrame(() => {
        const liveRootEditor = audEpList.querySelector(rootSelector);
        if (liveRootEditor instanceof HTMLElement) {
          liveRootEditor.focus({ preventScroll: true });
          setCaretToEnd(liveRootEditor);
        }
      });
    }
  });
}

function focusParentSubSegInput(editor) {
  const subSegId = getSubSegEditorKey(editor);
  const subSegItem = getSubSegItemById(subSegId);
  const audSegId = editor?.dataset?.subsegAudsegId || String(subSegItem?.audSegId ?? '');
  const linkTargetLangUnitId = getSubSegLinkTargetLangUnitId(subSegItem);
  const parentSubSegId = String(editor?.dataset?.parentSubsegId ?? '').trim() || getSubSegParentSubSegId(subSegItem);
  if (!parentSubSegId) {
    return false;
  }

  syncSubSegEditorDraft(editor);
  clearSubSegBubbleTarget(editor);
  const parentTargetIndex = getLangUnitBubbleIndexForSubSeg(audSegId, parentSubSegId, linkTargetLangUnitId);
  if (parentTargetIndex >= 0) {
    setSubSegBubbleTargetIndex(parentSubSegId, parentTargetIndex);
  }

  renderAudEps(state.audEpItems);
  requestAnimationFrame(() => {
    const parentEditor = audEpList.querySelector(`.item__subseg-input[data-subseg-audseg-id="${CSS.escape(String(audSegId))}"][data-subseg-id="${CSS.escape(parentSubSegId)}"]`);
    if (parentEditor instanceof HTMLElement) {
      syncLangUnitBubbleTarget(parentEditor, false);
      parentEditor.focus({ preventScroll: true });
      setCaretToEnd(parentEditor);
    }
  });
  return true;
}

function refreshLangUnitBubbleGroupStyles(editor) {
  if (!(editor instanceof HTMLElement)) {
    return;
  }

  const seen = new Set();
  for (const bubble of getLangUnitBubbles(editor)) {
    const langUnitId = String(bubble.dataset.langunitId ?? '').trim();
    const groupId = String(bubble.dataset.langunitCycleGroupId ?? '').trim() || langUnitId;
    if (!groupId) {
      bubble.removeAttribute('data-langunit-remote');
      bubble.removeAttribute('data-langunit-count');
      continue;
    }

    const count = Math.max(1, getLangUnitReferenceCount(groupId));
    if (langUnitId !== groupId || seen.has(groupId)) {
      bubble.setAttribute('data-langunit-remote', '1');
      bubble.removeAttribute('data-langunit-count');
    } else {
      seen.add(groupId);
      bubble.removeAttribute('data-langunit-remote');
      if (count > 1) {
        bubble.setAttribute('data-langunit-count', String(count));
      } else {
        bubble.removeAttribute('data-langunit-count');
      }
    }
  }
}

function refreshLangUnitConnectors(editor) {
  if (!(editor instanceof HTMLElement)) {
    return;
  }

  for (const connector of [...editor.querySelectorAll('.langunit-connector')]) {
    connector.replaceWith(...connector.childNodes);
  }

  const nodes = [...editor.childNodes];
  let buffer = [];
  let activeGroupId = '';

  const flushBuffer = () => {
    buffer = [];
  };

  for (const node of nodes) {
    if (!(node instanceof HTMLElement) || !node.classList.contains('langunit-bubble')) {
      if (activeGroupId) {
        buffer.push(node);
      }
      continue;
    }

    const groupId = String(node.dataset.langunitCycleGroupId ?? '').trim() || String(node.dataset.langunitId ?? '').trim();
    if (!groupId) {
      activeGroupId = '';
      flushBuffer();
      continue;
    }

    if (activeGroupId === groupId && buffer.length) {
      const connector = document.createElement('span');
      connector.className = 'langunit-connector';
      node.parentNode?.insertBefore(connector, node);
      for (const bufferedNode of buffer) {
        connector.append(bufferedNode);
      }
      flushBuffer();
    } else {
      flushBuffer();
    }

    activeGroupId = groupId;
  }
}

function refreshLinkedParentLangUnitText(editor) {
  if (!(editor instanceof HTMLElement) || editor.dataset.subsegIsRoot !== '0') {
    return;
  }

  const langUnitId = getSubSegEditorLinkTargetLangUnitId(editor);
  const langUnit = getLangUnitItem(langUnitId);
  if (!langUnitId || String(langUnit?.target?.type ?? '') !== 'chinFuzz') {
    return;
  }

  const sourceText = getLangUnitText(langUnit);
  const parentSubSegId = getSubSegParentSubSegId(getSubSegItemById(getSubSegEditorKey(editor)));
  const nextText = getLangUnitRenderText(langUnitId, sourceText, parentSubSegId);
  const audSegId = editor.dataset.subsegAudsegId || '';
  const parentEditor = audEpList.querySelector(`.item__subseg-input[data-subseg-audseg-id="${CSS.escape(String(audSegId))}"][data-subseg-id="${CSS.escape(parentSubSegId)}"]`);
  if (!(parentEditor instanceof HTMLElement)) {
    return;
  }

  parentEditor
    .querySelectorAll(`.langunit-bubble[data-langunit-id="${CSS.escape(langUnitId)}"]`)
    .forEach((bubble) => {
      if (nextText !== sourceText) {
        bubble.setAttribute('data-langunit-source-text', sourceText);
      } else {
        bubble.removeAttribute('data-langunit-source-text');
      }
      bubble.textContent = nextText;
    });
}

function syncSubSegEditorDraft(editor) {
  if (!(editor instanceof HTMLElement)) {
    return;
  }

  const subSegId = getSubSegEditorKey(editor);
  if (!subSegId) {
    return;
  }

  const audSegId = editor.dataset.subsegAudsegId || '';
  refreshLangUnitBubbleGroupStyles(editor);
  refreshLangUnitConnectors(editor);
  const markup = getSubSegEditorMarkup(editor);
  const payload = extractSubSegEditorPayload(editor);
  subSegDraftTextBySubSegId.set(subSegId, markup);
  subSegDraftPayloadBySubSegId.set(subSegId, payload);
  subSegDraftRevisionBySubSegId.set(subSegId, (subSegDraftRevisionBySubSegId.get(subSegId) ?? 0) + 1);
  autosizeSubSegInput(editor);
  scheduleSubSegSave(subSegId);
  refreshLinkedParentLangUnitText(editor);
  syncLangUnitBubbleTarget(editor, false);
}

function syncLangUnitRefsLists() {
  audEpList.querySelectorAll('.item__subseg-input').forEach((editor) => {
    if (!(editor instanceof HTMLElement)) {
      return;
    }

    const audSegId = editor.dataset.subsegAudsegId || '';
    const container = editor.closest('.item__segment--entered')?.querySelector('.item__langunit-refs');
    if (!(container instanceof HTMLElement)) {
      return;
    }

    container.outerHTML = renderLangUnitRefsList({ _id: audSegId });
  });
  syncLangUnitRefGraphCanvases();
}

function focusTargetedLangUnitRefRow() {
  const rows = [...audEpList.querySelectorAll('.item__langunit-ref')];
  const row = rows[state.langUnitRefTargetIndex];
  if (row instanceof HTMLElement) {
    row.focus({ preventScroll: true });
  }
}

function focusLangUnitRefSource() {
  const source = state.langUnitRefSource;
  state.langUnitRefTargetIndex = -1;
  state.enteredLangUnitRefIndex = -1;
  state.langUnitRefSource = null;
  renderAudEps(state.audEpItems);
  if (!source) {
    return;
  }

  requestAnimationFrame(() => {
    const editor = audEpList.querySelector(`.item__subseg-input[data-subseg-audseg-id="${CSS.escape(source.audSegId)}"][data-subseg-id="${CSS.escape(source.subSegId)}"]`);
    if (editor instanceof HTMLElement) {
      editor.focus({ preventScroll: true });
      syncLangUnitBubbleTarget(editor, false);
    }
  });
}

function enterLangUnitRefTraversal(editor) {
  if (!(editor instanceof HTMLElement)) {
    return false;
  }

  const audSegId = String(editor.dataset.subsegAudsegId ?? '').trim();
  const subSegId = getSubSegEditorKey(editor);
  const rows = getLangUnitRefRows(audSegId);
  if (!rows.length || !getLangUnitRefListTarget(audSegId).langUnitId) {
    return false;
  }

  state.langUnitRefSource = { audSegId, subSegId };
  state.langUnitRefTargetIndex = 0;
  state.enteredLangUnitRefIndex = -1;
  renderAudEps(state.audEpItems);
  requestAnimationFrame(focusTargetedLangUnitRefRow);
  return true;
}

function cycleLangUnitRefTarget(step) {
  const rows = [...audEpList.querySelectorAll('.item__langunit-ref')];
  if (!rows.length || state.enteredLangUnitRefIndex >= 0) {
    return false;
  }

  state.langUnitRefTargetIndex = state.langUnitRefTargetIndex < 0
    ? 0
    : (state.langUnitRefTargetIndex + step + rows.length) % rows.length;
  renderAudEps(state.audEpItems);
  requestAnimationFrame(focusTargetedLangUnitRefRow);
  return true;
}

function handleLangUnitRefKeyboard(event) {
  if (!state.langUnitRefSource) {
    return false;
  }

  if (isCtrlModifierActive(event) && !event.metaKey && !event.altKey && !event.shiftKey && event.key === 'Backspace') {
    event.preventDefault();
    if (state.enteredLangUnitRefIndex >= 0) {
      state.enteredLangUnitRefIndex = -1;
      renderAudEps(state.audEpItems);
      requestAnimationFrame(focusTargetedLangUnitRefRow);
    } else {
      focusLangUnitRefSource();
    }
    return true;
  }

  if (isCtrlModifierActive(event) && !event.metaKey && !event.altKey && !event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    if (state.enteredLangUnitRefIndex >= 0) {
      return true;
    }
    return cycleLangUnitRefTarget(event.key === 'ArrowDown' ? 1 : -1);
  }

  if (event.key === 'Enter' && state.langUnitRefTargetIndex >= 0 && state.enteredLangUnitRefIndex < 0) {
    event.preventDefault();
    state.enteredLangUnitRefIndex = state.langUnitRefTargetIndex;
    renderAudEps(state.audEpItems);
    requestAnimationFrame(() => {
      focusTargetedLangUnitRefRow();
      syncLangUnitRefGraphCanvases();
    });
    return true;
  }

  return false;
}

function setCaretAfterNode(node) {
  const selection = document.getSelection();
  if (!selection || !node.parentNode) {
    return;
  }

  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getLangUnitBubbleBoundary(editor) {
  const selection = document.getSelection();
  if (!selection || !selection.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode)) {
    return null;
  }

  const anchorNode = selection.anchorNode;
  const bubble = anchorNode.nodeType === Node.ELEMENT_NODE
    ? anchorNode.closest('.langunit-bubble')
    : anchorNode.parentElement?.closest('.langunit-bubble');

  if (!(bubble instanceof HTMLElement) || !editor.contains(bubble)) {
    return null;
  }

  if (anchorNode.nodeType === Node.TEXT_NODE) {
    const text = anchorNode.textContent ?? '';
    if (selection.anchorOffset === 0) {
      return { bubble, edge: 'start' };
    }

    if (selection.anchorOffset === text.length) {
      return { bubble, edge: 'end' };
    }
  }

  if (anchorNode.nodeType === Node.ELEMENT_NODE) {
    if (selection.anchorOffset === 0) {
      return { bubble, edge: 'start' };
    }

    if (selection.anchorOffset === anchorNode.childNodes.length) {
      return { bubble, edge: 'end' };
    }
  }

  return null;
}

function mergeAdjacentLangUnitBubbleRuns(editor, bubble) {
  if (!(editor instanceof HTMLElement) || !(bubble instanceof HTMLElement)) {
    return bubble;
  }

  const langUnitId = String(bubble.dataset.langunitId ?? '').trim();
  if (!langUnitId) {
    return bubble;
  }

  let mergedBubble = bubble;
  let prev = mergedBubble.previousSibling;
  while (
    prev instanceof HTMLElement &&
    prev.classList.contains('langunit-bubble') &&
    String(prev.dataset.langunitId ?? '').trim() === langUnitId &&
    String(prev.dataset.langunitCycleGroupId ?? '').trim() === String(bubble.dataset.langunitCycleGroupId ?? '').trim()
  ) {
    prev.textContent = `${prev.textContent ?? ''}${mergedBubble.textContent ?? ''}`;
    mergedBubble.remove();
    mergedBubble = prev;
    prev = mergedBubble.previousSibling;
  }

  let next = mergedBubble.nextSibling;
  while (
    next instanceof HTMLElement &&
    next.classList.contains('langunit-bubble') &&
    String(next.dataset.langunitId ?? '').trim() === langUnitId &&
    String(next.dataset.langunitCycleGroupId ?? '').trim() === String(bubble.dataset.langunitCycleGroupId ?? '').trim()
  ) {
    mergedBubble.textContent = `${mergedBubble.textContent ?? ''}${next.textContent ?? ''}`;
    next.remove();
    next = mergedBubble.nextSibling;
  }

  return mergedBubble;
}

function selectionTouchesLangUnitBubble(editor) {
  const selection = document.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) {
    return false;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return false;
  }

  const bubbles = editor.querySelectorAll('.langunit-bubble');
  return bubbles.length > 0 && Array.from(bubbles).some((bubble) => {
    try {
      return range.intersectsNode(bubble);
    } catch {
      return false;
    }
  });
}

function getSubSegSelectionTarget(editor, range) {
  const selectedText = normalizeSubSegLineBreaks(range.toString());
  const fullRange = document.createRange();
  fullRange.selectNodeContents(editor);
  const beforeRange = fullRange.cloneRange();
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const fullText = normalizeSubSegLineBreaks(fullRange.toString());
  const start = normalizeSubSegLineBreaks(beforeRange.toString()).length;
  const end = start + selectedText.length;
  const context = createLangUnitContext(getLangUnitBubbleContext(fullText, start, end));
  return createLangUnitTarget(selectedText, context.type, { text: fullText, start, end });
}

function wrapSelectedSubSegText(editor) {
  const selection = document.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) {
    return false;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return false;
  }

  const bubble = document.createElement('span');
  bubble.className = 'langunit-bubble';
  const text = range.toString();
  const targetIndex = getSubSegBubbleTargetIndex(editor);
  const targetLangUnitId = getLangUnitBubbleGroupIds(editor)[targetIndex] ?? '';
  const target = getSubSegSelectionTarget(editor, range);
  const langUnit = targetLangUnitId ? null : getLangUnitItemByCanonicalTarget(target, text);
  const subSegId = getSubSegEditorKey(editor);
  const langUnitId = langUnit?._id || buildLangUnitId(subSegId, getNextLangUnitOrdinal(editor, subSegId)) || createItemId();
  bubble.dataset.langunitId = langUnitId;
  if (targetLangUnitId) {
    bubble.dataset.langunitCycleGroupId = targetLangUnitId;
  }
  bubble.dataset.langunitCount = String(Math.max(1, getLangUnitReferenceCount(langUnitId) + 1));
  bubble.append(range.extractContents());
  range.insertNode(bubble);

  const mergedBubble = mergeAdjacentLangUnitBubbleRuns(editor, bubble);
  refreshLangUnitBubbleGroupStyles(editor);

  const caret = document.createRange();
  caret.setStartAfter(mergedBubble);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  syncSubSegEditorDraft(editor);
  return true;
}

function getLinkedSubSegLineStartAutoLangUnitRange(editor) {
  if (!(editor instanceof HTMLElement) || editor.dataset.subsegIsRoot !== '0') {
    return null;
  }

  const linkTargetLangUnitId = getSubSegEditorLinkTargetLangUnitId(editor);
  const parentLangUnit = getLangUnitItem(linkTargetLangUnitId) ?? getLangUnitItem(getLangUnitCycleTargetId(linkTargetLangUnitId));
  const parentTargetType = String(parentLangUnit?.target?.type ?? '').trim();
  const parentTargetText = String(parentLangUnit?.target?.text || getLangUnitText(parentLangUnit) || '');
  if (!['chinWord', 'chinPhrase'].includes(parentTargetType) || !parentTargetText) {
    return null;
  }

  const selection = document.getSelection();
  if (!selection || !selection.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode)) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer)) {
    return null;
  }

  const beforeText = getSubSegTextBeforeRange(editor, range);
  const char = beforeText.slice(-1);
  if (!isChineseCharacter(char) || !parentTargetText.includes(char)) {
    return null;
  }

  if (!/(^|\n)[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]$/u.test(beforeText)) {
    return null;
  }

  const autoRange = getSubSegTextRange(editor, beforeText.length - 1, beforeText.length);
  if (!autoRange) {
    return null;
  }

  return { range: autoRange, text: char };
}

function autoLangUnitifyLinkedSubSegLineStart(editor) {
  const match = getLinkedSubSegLineStartAutoLangUnitRange(editor);
  if (!match) {
    return false;
  }

  const { range, text } = match;
  const target = getSubSegSelectionTarget(editor, range);
  const langUnit = getLangUnitItemByCanonicalTarget(target, text);
  const subSegId = getSubSegEditorKey(editor);
  const langUnitId = langUnit?._id || buildLangUnitId(subSegId, getNextLangUnitOrdinal(editor, subSegId)) || createItemId();
  const bubble = document.createElement('span');
  bubble.className = 'langunit-bubble';
  bubble.dataset.langunitId = langUnitId;
  bubble.dataset.langunitCount = String(Math.max(1, getLangUnitReferenceCount(langUnitId) + 1));
  bubble.append(range.extractContents());
  range.insertNode(bubble);

  const mergedBubble = mergeAdjacentLangUnitBubbleRuns(editor, bubble);
  const spaceNode = document.createTextNode(' ');
  mergedBubble.parentNode?.insertBefore(spaceNode, mergedBubble.nextSibling);
  refreshLangUnitBubbleGroupStyles(editor);
  setCaretAfterNode(spaceNode);
  syncSubSegEditorDraft(editor);
  return true;
}

function insertSubSegLineBreak(editor) {
  const selection = document.getSelection();
  if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) {
    return false;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return false;
  }

  range.deleteContents();
  const br = document.createElement('br');
  range.insertNode(br);
  setCaretAfterNode(br);
  syncSubSegEditorDraft(editor);
  return true;
}

function handleLangUnitBubbleSpace(editor) {
  const targetKey = getSubSegBubbleTargetKey(editor);
  const pending = langUnitBubbleEscapeState.get(targetKey);
  const now = Date.now();
  const boundary = getLangUnitBubbleBoundary(editor);
  const targetIndex = getSubSegBubbleTargetIndex(editor);

  if (pending && now - pending.at < 250) {
    langUnitBubbleEscapeState.delete(targetKey);
    if (targetIndex >= 0) {
      setSubSegBubbleTargetIndex(editor, -1);
      syncLangUnitBubbleTarget(editor, true);
    }
    return true;
  }

  if (!boundary) {
    if (targetIndex >= 0) {
      langUnitBubbleEscapeState.set(targetKey, { edge: 'end', at: now });
      return true;
    }

    return false;
  }

  const spaceNode = document.createTextNode(' ');
  if (boundary.edge === 'start') {
    boundary.bubble.parentNode?.insertBefore(spaceNode, boundary.bubble);
  } else {
    boundary.bubble.parentNode?.insertBefore(spaceNode, boundary.bubble.nextSibling);
  }

  setCaretAfterNode(spaceNode);
  langUnitBubbleEscapeState.set(targetKey, { edge: boundary.edge, at: now });
  syncSubSegEditorDraft(editor);
  return true;
}

function scheduleSubSegSave(subSegId) {
  if (!subSegId) {
    return;
  }

  const existing = subSegSaveTimersBySubSegId.get(subSegId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    subSegSaveTimersBySubSegId.delete(subSegId);
    void saveSubSeg(subSegId);
  }, 500);

  subSegSaveTimersBySubSegId.set(subSegId, timer);
}

function flushSubSegSave(subSegId) {
  const editor = getLiveSubSegEditor(subSegId);
  const payload = editor instanceof HTMLElement
    ? extractSubSegEditorPayload(editor)
    : subSegDraftPayloadBySubSegId.get(subSegId);
  if (!payload) {
    return;
  }

  const existing = subSegSaveTimersBySubSegId.get(subSegId);
  if (existing) {
    clearTimeout(existing);
    subSegSaveTimersBySubSegId.delete(subSegId);
  }

  const body = JSON.stringify({ subSegId, ...payload });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/subSegs/items', new Blob([body], { type: 'application/json' }));
    return;
  }

  void saveSubSeg(subSegId);
}

function mergeLangUnitItems(items) {
  const next = new Map(state.langUnitItems.map((item) => [item?._id, item]));

  for (const item of items) {
    if (!item?._id) {
      continue;
    }

    next.set(item._id, item);
  }

  state.langUnitItems = [...next.values()];
}

function getLiveSubSegEditor(subSegId) {
  const id = String(subSegId ?? '');
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches('.item__subseg-input') && String(active.dataset.subsegId ?? '') === id) {
    return active;
  }

  return audEpList.querySelector(`.item__subseg-input[data-subseg-id="${CSS.escape(id)}"]`);
}

function syncEditorLangUnitIdsFromContent(editor, content) {
  if (!(editor instanceof HTMLElement) || !Array.isArray(content)) {
    return;
  }

  const ids = content
    .filter((token) => token?.type === 'langUnitRef' && String(token.langUnitId ?? '').trim())
    .map((token) => String(token.langUnitId).trim());
  getLangUnitBubbles(editor).forEach((bubble, index) => {
    if (ids[index]) {
      bubble.dataset.langunitId = ids[index];
    }
  });
}

async function saveSubSeg(subSegId) {
  const payload = subSegDraftPayloadBySubSegId.get(subSegId);
  if (!payload) {
    return null;
  }

  const saveRevision = subSegDraftRevisionBySubSegId.get(subSegId) ?? 0;
  const knownLangUnitIds = new Set(state.langUnitItems.map((item) => item?._id).filter(Boolean));
  const liveEditor = getLiveSubSegEditor(subSegId);
  const nextPayload = liveEditor instanceof HTMLElement ? extractSubSegEditorPayload(liveEditor) : payload;
  const existingSubSeg = getSubSegItemById(subSegId);
  if (
    nextPayload?.isRoot === false &&
    !String(nextPayload.linkTargetLangUnitId ?? '').trim() &&
    String(existingSubSeg?.linkTargetLangUnitId ?? '').trim()
  ) {
    nextPayload.linkTargetLangUnitId = String(existingSubSeg.linkTargetLangUnitId).trim();
  }

  const response = await fetch('/api/subSegs/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subSegId, disambiguateChinContexts: chinDisambiguationEnabled, ...nextPayload }),
  });

  if (!response.ok) {
    return null;
  }

  const result = await response.json();
  if ((subSegDraftRevisionBySubSegId.get(subSegId) ?? 0) !== saveRevision) {
    if (subSegDraftPayloadBySubSegId.has(subSegId) && !subSegSaveTimersBySubSegId.has(subSegId)) {
      scheduleSubSegSave(subSegId);
    }
    return result;
  }

  const saved = result?.subSeg ?? result;
  subSegDraftTextBySubSegId.delete(subSegId);
  subSegDraftPayloadBySubSegId.delete(subSegId);
  subSegDraftRevisionBySubSegId.delete(subSegId);
  if (Array.isArray(result?.langUnits)) {
    mergeLangUnitItems(result.langUnits);
  } else if (nextPayload.langUnits?.length) {
    mergeLangUnitItems(nextPayload.langUnits);
  }
  const inferredLangUnits = Array.isArray(result?.langUnits) ? result.langUnits : (nextPayload.langUnits ?? []);
  for (const langUnit of inferredLangUnits) {
    if (langUnit?._id && !knownLangUnitIds.has(langUnit._id)) {
      void inferLangUnitRoot(langUnit);
    }
  }
  state.subSegItems = Array.isArray(result?.subSegs)
    ? sortSubSegItems(result.subSegs)
    : sortSubSegItems(
      saved
        ? [saved, ...state.subSegItems.filter((item) => String(item?._id ?? '') !== String(saved._id ?? ''))]
        : state.subSegItems.filter((item) => String(item?._id ?? '') !== String(subSegId))
    );
  if (getFocusedSubSegEditor()) {
    if (liveEditor instanceof HTMLElement && liveEditor.isConnected) {
      syncEditorLangUnitIdsFromContent(liveEditor, saved?.content);
      refreshLangUnitBubbleGroupStyles(liveEditor);
      refreshLangUnitConnectors(liveEditor);
    }
  } else {
    renderAudEps(state.audEpItems);
  }
  syncLangUnitRefsLists();
  return result;
}

function createAudSegDraft() {
  if (state.enteredAudEpIndex < 0 || state.audSegDraftId) {
    return;
  }

  const audio = getSelectedAudEpMediaPlayer();
  const audEpId = getAudEpIdByIndex(state.enteredAudEpIndex);
  const audSegOrdinal = getNextAudSegOrdinal(audEpId);
  const draft = {
    _id: buildDerivedId(audEpId, audSegOrdinal) || `draft-${Date.now()}`,
    audEpId,
    audEpIndex: state.enteredAudEpIndex,
    audSegOrdinal,
    tcs: audio ? audio.currentTime || 0 : 0,
    tce: '',
    ssHead: '',
    tentative: true,
  };

  state.audSegDraftId = draft._id;
  state.selectedAudSegIndex = getAudSegItemsForAudEp(state.enteredAudEpIndex).length;
  state.audSegItems = [...state.audSegItems, draft];
  renderAudEps(state.audEpItems);
}

async function commitAudSegDraft() {
  const draft = state.audSegItems.find((item) => item?._id === state.audSegDraftId);
  if (!draft || state.audSegDraftCommitPending) {
    return;
  }

  state.audSegDraftCommitPending = true;
  const audio = getSelectedAudEpMediaPlayer();
  const payload = {
    audEpId: draft.audEpId,
    audEpIndex: draft.audEpIndex,
    audSegOrdinal: draft.audSegOrdinal,
    tcs: draft.tcs,
    tce: audio ? audio.currentTime || 0 : 0,
    ssHead: draft.ssHead || '',
  };

  try {
    const response = await fetch('/api/audSegs/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('audSeg save failed');
    }

    const saved = await response.json();
    const draftStillVisible = state.audSegItems.some((item) => item?._id === draft._id);
    state.audSegItems = draftStillVisible
      ? state.audSegItems.map((item) => (item?._id === draft._id ? saved : item))
      : [...state.audSegItems, saved];
  } catch {
    state.audSegItems = state.audSegItems.filter((item) => item?._id !== draft._id);
  } finally {
    state.audSegDraftId = '';
    state.audSegCaptureShiftHeld = false;
    state.audSegDraftCommitPending = false;
    state.selectedAudSegIndex = -1;
    state.enteredAudSegIndex = -1;
    renderAudEps(state.audEpItems);
  }
}

function cancelAudSegDraft() {
  if (!state.audSegDraftId || state.audSegDraftCommitPending) {
    return;
  }

  state.audSegItems = state.audSegItems.filter((item) => item?._id !== state.audSegDraftId);
  state.audSegDraftId = '';
  state.audSegCaptureShiftHeld = false;
  state.selectedAudSegIndex = -1;
  state.enteredAudSegIndex = -1;
  renderAudEps(state.audEpItems);
}

function getAudioForIndex(index) {
  if (audioPlayers.has(index)) {
    return audioPlayers.get(index);
  }

  const item = state.audEpItems[index];
  if (!item) {
    return null;
  }

  const src = getItemMediaSource(item);
  if (!src) {
    return null;
  }

  const audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('loadedmetadata', () => handleAudioReady(index));
  audio.addEventListener('loadeddata', () => handleAudioReady(index));
  audio.addEventListener('canplay', () => handleAudioReady(index));
  audio.addEventListener('durationchange', () => handleAudioReady(index));
  audio.addEventListener('progress', () => handleAudioReady(index));
  audio.addEventListener('timeupdate', () => syncAudEpPlaybackLabel(index));
  audio.addEventListener('play', () => handleAudioPlay(index));
  audio.addEventListener('pause', () => handleAudioStop(index));
  audio.addEventListener('ended', () => handleAudioStop(index));
  audio.src = src;
  audioPlayers.set(index, audio);
  audio.load();

  return audio;
}

function handleAudioReady(index) {
  const audio = audioPlayers.get(index);
  if (!audio) {
    return;
  }

  const pendingSeek = pendingSeekByIndex.get(index);
  if (Number.isFinite(pendingSeek)) {
    const existingFrame = pendingSeekFrameByIndex.get(index);
    if (existingFrame) {
      cancelAnimationFrame(existingFrame);
    }

    const frame = requestAnimationFrame(() => {
      if (!audioPlayers.has(index)) {
        return;
      }

      applyPendingAudioSeek(index, audio, pendingSeek);
      syncAudEpPlaybackLabel(index);
      pendingSeekFrameByIndex.delete(index);
    });
    pendingSeekFrameByIndex.set(index, frame);
    return;
  }

  syncAudEpPlaybackLabel(index);
}

function syncAudEpPlaybackLabel(index) {
  const audio = audioPlayers.get(index);
  const label = audEpList.querySelector(`[data-audep-time="${index}"]`);
  if (!audio || !label) {
    return;
  }

  label.textContent = formatTime(audio.currentTime);
}

function syncAudEpPlaybackLabels() {
  for (const index of audioPlayers.keys()) {
    syncAudEpPlaybackLabel(index);
  }
}

function handleAudioPlay(index) {
  pauseOtherAudio(index);
  syncAudEpPlaybackLoop(index);
}

function handleAudioStop(index) {
  const audio = audioPlayers.get(index);
  stopAudioLoop(audio);
  syncAudEpPlaybackLabel(index);
}

function syncAudEpPlaybackLoop(index) {
  const audio = audioPlayers.get(index);
  if (!audio) {
    return;
  }

  const lock = getAudSegPlaybackLock(index);
  if (lock && audio.currentTime >= lock.tce) {
    applyAudioSeek(index, audio, lock.tcs);
  }
  syncAudEpPlaybackLabel(index);
  if (!audio.paused && !audio.ended) {
    audio._raf = requestAnimationFrame(() => syncAudEpPlaybackLoop(index));
  }
}

function pauseOtherAudio(activeIndex) {
  for (const [index, audio] of audioPlayers.entries()) {
    if (index === activeIndex || audio.paused) {
      continue;
    }

    stopAudioLoop(audio);
    audio.pause();
  }
}

function applyAudioSeek(index, audio, nextTime) {
  const lock = getAudSegPlaybackLock(index);
  if (lock) {
    nextTime = Math.max(lock.tcs, Math.min(nextTime, lock.tce));
  }
  audio.currentTime = nextTime;
  return nextTime;
}

function applyPendingAudioSeek(index, audio, nextTime) {
  const targetTime = applyAudioSeek(index, audio, nextTime);
  if (Math.abs((audio.currentTime || 0) - targetTime) > 0.25) {
    pendingSeekByIndex.set(index, targetTime);
    return;
  }

  pendingSeekByIndex.delete(index);
}

function seekAudio(index, deltaSeconds) {
  const audio = getAudioForIndex(index);
  if (!audio) {
    return;
  }

  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number.POSITIVE_INFINITY;
  const pendingSeek = pendingSeekByIndex.get(index);
  const baseTime = Number.isFinite(pendingSeek) ? pendingSeek : audio.currentTime || 0;
  const nextTime = Math.max(0, Math.min(baseTime + deltaSeconds, duration));
  if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
    pendingSeekByIndex.set(index, nextTime);
  } else {
    applyPendingAudioSeek(index, audio, nextTime);
  }
  syncAudEpPlaybackLabel(index);
}

function seekSelectedAudEpPlayback(deltaSeconds) {
  const index = getSelectedAudEpDataIndex();
  if (index < 0) {
    return;
  }

  if (state.audSegPlaybackLock?.audEpIndex === index) {
    state.audSegPlaybackLock = null;
    state.enteredAudSegIndex = -1;
  }
  seekAudio(index, deltaSeconds);
}

function enterSelectedAudEp() {
  if (state.selectedAudEpIndex <= 0) {
    return;
  }

  state.enteredAudEpIndex = state.selectedAudEpIndex - 1;
  state.selectedAudSegIndex = -1;
  state.enteredAudSegIndex = -1;
  renderAudEps(state.audEpItems);
}

function closeEnteredAudEp() {
  if (state.enteredAudEpIndex < 0) {
    return;
  }

  state.enteredAudEpIndex = -1;
  state.selectedAudSegIndex = -1;
  state.enteredAudSegIndex = -1;
  state.audSegPlaybackLock = null;
  renderAudEps(state.audEpItems);
}

function closeEnteredAudSeg() {
  if (state.enteredAudSegIndex < 0) {
    return;
  }

  const audSegId = String(getAudSegItemsForAudEp(state.enteredAudEpIndex)[state.enteredAudSegIndex]?._id ?? '');
  if (audSegId) {
    for (const subSegItem of getSubSegItemsForAudSeg(audSegId)) {
      flushSubSegSave(String(subSegItem?._id ?? ''));
    }
    clearSubSegBubbleTargetsForAudSeg(audSegId);
  }

  state.enteredAudSegIndex = -1;
  state.audSegPlaybackLock = null;
  renderAudEps(state.audEpItems);
}

function stopAudioLoop(audio) {
  if (audio?._raf) {
    cancelAnimationFrame(audio._raf);
    audio._raf = null;
  }
}

function resetAudioPlayers() {
  for (const audio of audioPlayers.values()) {
    stopAudioLoop(audio);
    if (audio._objectUrl) {
      URL.revokeObjectURL(audio._objectUrl);
      audio._objectUrl = '';
    }
    audio.pause();
  }

  audioPlayers.clear();
  pendingSeekByIndex.clear();
  for (const frame of pendingSeekFrameByIndex.values()) {
    cancelAnimationFrame(frame);
  }
  pendingSeekFrameByIndex.clear();
}

async function toggleAudEpPlaybackByIndex(audEpIndex) {
  if (!Number.isInteger(audEpIndex) || audEpIndex < 0) {
    return;
  }

  const audio = getAudioForIndex(audEpIndex);
  if (!audio) {
    return;
  }

  if (audio.paused) {
    pauseOtherAudio(audEpIndex);
    try {
      await audio.play();
    } catch {
      showWorkerToast('audio play blocked', 1200);
    }
  } else {
    audio.pause();
  }
}

async function toggleSelectedAudEpPlayback() {
  await toggleAudEpPlaybackByIndex(getSelectedAudEpDataIndex());
}

async function toggleSubSegAudEpPlayback(editor) {
  const audSegId = editor instanceof HTMLElement ? String(editor.dataset.subsegAudsegId ?? '').trim() : '';
  const audEpIndex = getAudEpIndexForAudSegItem(getAudSegItemById(audSegId));
  await toggleAudEpPlaybackByIndex(audEpIndex);
}

function cycleAudEpSelection(step) {
  const items = getSelectableAudEpItems();
  if (items.length < 2) {
    return;
  }

  const selectableCount = items.length - 1;
  const range = selectableCount + 1;
  const currentPosition = state.selectedAudEpIndex <= 0 ? 0 : state.selectedAudEpIndex;
  const nextPosition = (currentPosition + step + range) % range;
  state.selectedAudEpIndex = nextPosition === 0 ? -1 : nextPosition;
  state.selectedAudSegIndex = -1;

  getAudEpItems().forEach((item) => item.classList.remove('is-targeted'));
  if (state.selectedAudEpIndex >= 0) {
    items[state.selectedAudEpIndex]?.classList.add('is-targeted');
    items[state.selectedAudEpIndex]?.scrollIntoView({ block: 'nearest' });
  }
}

function clearAudEpSelection() {
  state.selectedAudEpIndex = -1;
  state.selectedAudSegIndex = -1;
  state.deleteDialogIndex = -1;
  state.deleteDialogChoice = 'cancel';
  renderAudEps(state.audEpItems);
}

async function loadAudEps() {
  resetAudioPlayers();
  const response = await fetch('/api/audEps/items');
  state.audEpItems = await response.json();
  renderAudEps(state.audEpItems);
  state.audEpItems.forEach((item, index) => {
    if (getItemMediaSource(item)) {
      void getAudioForIndex(index);
    }
  });
}

async function loadAudSegs() {
  const response = await fetch('/api/audSegs/items');
  state.audSegItems = await response.json();
  renderAudEps(state.audEpItems);
}

async function loadLangUnits() {
  const response = await fetch('/api/langUnits/items');
  state.langUnitItems = await response.json();
  if (state.enteredAudEpIndex >= 0) {
    renderAudEps(state.audEpItems);
  }
}

async function loadSubSegs() {
  const response = await fetch('/api/subSegs/items');
  state.subSegItems = await response.json();
  if (state.enteredAudEpIndex >= 0) {
    renderAudEps(state.audEpItems);
  }
}

async function reloadAudData() {
  await loadAudEps();
  await loadAudSegs();
  await loadLangUnits();
  await loadSubSegs();
}

function getSelectedAudEpDataIndex() {
  return state.selectedAudEpIndex > 0 ? state.selectedAudEpIndex - 1 : -1;
}

function renderDeleteDialog() {
  if (state.deleteDialogKind === 'audEp' && state.deleteDialogIndex < 0) {
    return;
  }

  if (state.deleteDialogKind === 'audSeg' && !state.deleteDialogAudSegId) {
    return;
  }

  renderAudEps(state.audEpItems);
  const dialogButton =
    state.deleteDialogKind === 'audSeg'
      ? audEpList.querySelector(
          `.item__segment[data-audseg-id="${CSS.escape(state.deleteDialogAudSegId)}"] [data-delete-action="${state.deleteDialogChoice}"]`
        )
      : audEpList.querySelector(
          `.item[data-audep-index="${state.deleteDialogIndex}"] [data-delete-action="${state.deleteDialogChoice}"]`
        );
  dialogButton?.focus();
}

function openDeleteDialog() {
  const selectedAudSegItem = getSelectedAudSegItem();
  if (selectedAudSegItem?._id) {
    state.deleteDialogKind = 'audSeg';
    state.deleteDialogIndex = -1;
    state.deleteDialogAudSegId = selectedAudSegItem._id;
    state.deleteDialogChoice = 'cancel';
    renderDeleteDialog();
    return;
  }

  if (state.selectedAudEpIndex <= 0) {
    return;
  }

  state.deleteDialogKind = 'audEp';
  state.deleteDialogIndex = state.selectedAudEpIndex;
  state.deleteDialogAudSegId = '';
  state.deleteDialogChoice = 'cancel';
  renderDeleteDialog();
}

function closeDeleteDialog() {
  const dialogKind = state.deleteDialogKind;
  if (dialogKind === 'audEp' && state.deleteDialogIndex < 0) {
    return;
  }

  if (dialogKind === 'audSeg' && !state.deleteDialogAudSegId) {
    return;
  }

  state.deleteDialogKind = 'audEp';
  state.deleteDialogIndex = -1;
  state.deleteDialogAudSegId = '';
  state.deleteDialogChoice = 'cancel';
  if (dialogKind !== 'audSeg') {
    state.selectedAudSegIndex = -1;
  }
  renderAudEps(state.audEpItems);
}

function cycleDeleteDialogChoice(step = 1) {
  if (state.deleteDialogKind !== 'audSeg' && state.deleteDialogIndex < 0) {
    return;
  }

  if (state.deleteDialogKind === 'audSeg' && !state.deleteDialogAudSegId) {
    return;
  }

  state.deleteDialogChoice = step < 0 ? 'cancel' : 'confirm';
  renderDeleteDialog();
}

async function confirmDeleteSelectedAudEp() {
  const itemIndex = getSelectedAudEpDataIndex();
  if (itemIndex < 0) {
    return;
  }

  const response = await fetch(`/api/audEps/items/${itemIndex}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    return;
  }

  state.deleteDialogIndex = -1;
  state.deleteDialogKind = 'audEp';
  state.deleteDialogAudSegId = '';
  state.deleteDialogChoice = 'cancel';
  await reloadAudData();
}

async function confirmDeleteSelectedAudSeg() {
  const audSegId = state.deleteDialogAudSegId;
  if (!audSegId) {
    return;
  }

  const response = await fetch(`/api/audSegs/items/${encodeURIComponent(audSegId)}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    return;
  }

  state.deleteDialogIndex = -1;
  state.deleteDialogKind = 'audEp';
  state.deleteDialogAudSegId = '';
  state.deleteDialogChoice = 'cancel';
  state.selectedAudSegIndex = -1;
  state.enteredAudSegIndex = -1;
  await reloadAudData();
}

function buildSelectorChain(element) {
  return buildSelectorTrail(element)
    .map((part) => part.selector)
    .join(' > ');
}

function buildSelectorTrail(element) {
  const labels = [];
  let current = element;

  while (current && current !== document.documentElement) {
    if (current.nodeType !== Node.ELEMENT_NODE) {
      current = current.parentElement;
      continue;
    }

    if (current.id === 'app') {
      labels.unshift('#app');
      break;
    }

    let part = current.tagName.toLowerCase();
    if (current.id) {
      part += `#${current.id}`;
    }

    const stableClasses = [...current.classList].filter(
      (className) => className !== 'is-targeted' && className !== 'has-edit-notes'
    );
    if (stableClasses.length) {
      part += `.${stableClasses.join('.')}`;
    }

    if (current.parentElement) {
      const siblings = [...current.parentElement.children].filter(
        (node) => node.tagName === current.tagName
      );
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }

    labels.unshift(part);
    current = current.parentElement;
  }

  const trail = [
    { label: 'html', selector: 'html' },
    { label: 'body', selector: 'html > body' },
  ];
  const selectorParts = ['html', 'body'];

  labels.forEach((label) => {
    selectorParts.push(label);
    trail.push({
      label,
      selector: selectorParts.join(' > '),
    });
  });

  return trail;
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getSelectorParts(selector) {
  return selector.split(' > ');
}

function renderSelectorChain(selector) {
  const parts = state.activeElement
    ? buildSelectorTrail(state.activeElement)
    : getSelectorParts(selector).map((part, index, allParts) => ({
        label: part,
        selector: allParts.slice(0, index + 1).join(' > '),
      }));

  noteSelector.innerHTML = parts
    .map((part) => {
      return `
        <button class="selector-chain__link" type="button" data-selector-target="${escapeHtml(part.selector)}">
          ${escapeHtml(part.label)}
        </button>
      `;
    })
    .join('<span class="selector-chain__sep" aria-hidden="true">&gt;</span>');
}

function renderNotes(selector) {
  const notes = state.notesBySelector[selector]?.notes ?? [];
  const activeNotes = notes.filter((note) => !note.applied);
  const appliedNotes = notes.filter((note) => note.applied);
  const historyNotes = appliedNotes.filter((note) => {
    const lifecycle = note.functionalityStatus?.state;
    return lifecycle === 'active' || lifecycle === 'partially active';
  });
  renderSelectorChain(selector);
  noteList.innerHTML = [
    activeNotes.length
      ? activeNotes.map((note) => `<div class="note-item">${escapeHtml(note.text)}</div>`).join('')
      : historyNotes.length
        ? '<div class="note-item note-item--empty">No active notes.</div>'
        : '<div class="note-item note-item--empty">No notes yet.</div>',
    historyNotes.length
      ? `
        <details class="note-history" ${state.historyOpenBySelector[selector] ? 'open' : ''}>
          <summary class="note-history__summary">History</summary>
          <div class="note-history__body">
            ${historyNotes
              .map((note) => `<div class="note-item note-item--applied">${escapeHtml(note.text)}</div>`)
              .join('')}
          </div>
        </details>
      `
      : '',
  ].join('');
}

function syncNoteDecorations() {
  document.querySelectorAll('.has-edit-notes').forEach((element) => {
    element.classList.remove('has-edit-notes');
    element.removeAttribute('title');
  });

  Object.entries(state.notesBySelector).forEach(([selector, entry]) => {
    const count = entry.notes.length;
    if (!count) {
      return;
    }

    document.querySelectorAll(selector).forEach((element) => {
      element.classList.add('has-edit-notes');
      element.title = `${count} edit note${count === 1 ? '' : 's'}`;
    });
  });
}

function syncSettingsPopover() {
  if (!settingsButton || !settingsPopover) {
    return;
  }

  settingsButton.setAttribute('aria-expanded', String(settingsOpen));
  settingsPopover.hidden = !settingsOpen;
  if (settingsPopoverWorkerCheckbox instanceof HTMLInputElement) {
    settingsPopoverWorkerCheckbox.checked = codexWordRootInferenceEnabled;
  }
  if (settingsPopoverChinDisambiguationCheckbox instanceof HTMLInputElement) {
    settingsPopoverChinDisambiguationCheckbox.checked = chinDisambiguationEnabled;
  }
}

function toggleSettingsPopover(forceOpen) {
  settingsOpen = typeof forceOpen === 'boolean' ? forceOpen : !settingsOpen;
  syncSettingsPopover();
}

function showWorkerToast(message, durationMs = 1800) {
  if (!workerToast) {
    return;
  }

  workerToast.textContent = message;
  workerToast.hidden = false;
  clearTimeout(workerToastTimer);
  workerToastTimer = setTimeout(() => {
    if (workerToast) {
      workerToast.hidden = true;
    }
  }, durationMs);
}

async function refreshCodexWorkerStatus({ startup = false } = {}) {
  if (startup) {
    showWorkerToast('codex worker starting...', 3000);
  } else if (!codexWordRootInferenceEnabled) {
    return;
  }

  showWorkerToast('codex worker ping send...', 1200);
  const response = await fetch('/api/codex-worker/status');
  if (!response.ok) {
    return;
  }

  showWorkerToast('codex worker ping seen', 1200);
  const status = await response.json();
  if (status?.primeComplete) {
    showWorkerToast(startup ? 'codex worker ready' : 'codex worker ready', 3000);
  }
}

function setCodexWordRootInferenceEnabled(enabled) {
  codexWordRootInferenceEnabled = Boolean(enabled);
  localStorage.setItem('codex-word-root-inference-enabled', codexWordRootInferenceEnabled ? '1' : '0');
  syncSettingsPopover();
  showWorkerToast(codexWordRootInferenceEnabled ? 'codex worker enabled' : 'codex worker disabled', 2500);
  if (codexWordRootInferenceEnabled) {
    void refreshCodexWorkerStatus();
  }
}

function setChinDisambiguationEnabled(enabled) {
  chinDisambiguationEnabled = Boolean(enabled);
  localStorage.setItem('chin-disambiguation-enabled', chinDisambiguationEnabled ? '1' : '0');
  syncSettingsPopover();
  showWorkerToast(chinDisambiguationEnabled ? 'chin disambiguation enabled' : 'chin disambiguation disabled', 2500);
}

async function clearAllSubSegs() {
  if (!window.confirm('Clear all subSegs?')) {
    return;
  }

  const response = await fetch('/api/subSegs/items', { method: 'DELETE' });
  if (!response.ok) {
    return;
  }

  clearSubSegDraftState();
  await loadSubSegs();
  showWorkerToast('subSegs cleared', 1800);
}

function clearSubSegDraftState() {
  for (const timer of subSegSaveTimersBySubSegId.values()) {
    clearTimeout(timer);
  }

  subSegSaveTimersBySubSegId.clear();
  subSegDraftTextBySubSegId.clear();
  subSegDraftPayloadBySubSegId.clear();
  subSegDraftRevisionBySubSegId.clear();
}

async function clearAllLangUnits() {
  if (!window.confirm('Clear all langUnits?')) {
    return;
  }

  const response = await fetch('/api/langUnits/items', { method: 'DELETE' });
  if (!response.ok) {
    return;
  }

  await loadLangUnits();
  await loadSubSegs();
  showWorkerToast('langUnits cleared', 1800);
}

async function inferLangUnitRoot(langUnit) {
  if (!codexWordRootInferenceEnabled || !(langUnit?._id)) {
    return;
  }

  if (!/^[A-Za-z]+$/.test(String(getLangUnitText(langUnit) ?? '').trim())) {
    return;
  }

  showWorkerToast('codex worker ping send...', 1200);
  const response = await fetch(`/api/langUnits/items/${encodeURIComponent(langUnit._id)}/root`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: getLangUnitContextText(langUnit),
      target: String(getLangUnitText(langUnit) ?? ''),
      substring: String(getLangUnitText(langUnit) ?? ''),
    }),
  });

  if (!response.ok) {
    return;
  }

  showWorkerToast('codex worker ping seen', 1200);
  const result = await response.json();
  const updated = result?.langUnit ?? result;
  if (updated?._id) {
    mergeLangUnitItems([updated]);
  }
  showWorkerToast(`payload complete: ${String(result?.res ?? updated?.root ?? '')}`);
}

function openSidebar(selector, element) {
  state.activeSelector = selector;
  state.activeElement = element;
  sidebar.hidden = false;
  sidebar.classList.add('is-open');
  if (!(selector in state.historyOpenBySelector)) {
    state.historyOpenBySelector[selector] = false;
  }
  renderNotes(selector);
}

function closeSidebar() {
  sidebar.classList.remove('is-open');
  sidebar.hidden = true;
  noteInput.value = '';
  state.activeSelector = '';
  state.activeElement = null;
}

function showProbe(text, x, y) {
  probe.textContent = text;
  probe.style.left = `${x + 12}px`;
  probe.style.top = `${y + 12}px`;
  probe.hidden = false;
}

function hideProbe() {
  probe.hidden = true;
}

function isFocusedSubSegInput() {
  const active = document.activeElement;
  return active instanceof Element && active.closest(subSegInputSelector);
}

function getFocusedSubSegEditor() {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.closest(subSegInputSelector) instanceof HTMLElement
    ? active.closest(subSegInputSelector)
    : null;
}

function isSpaceKey(event) {
  return (
    event.key === ' ' ||
    event.key === 'Space' ||
    event.key === 'Spacebar' ||
    event.code === 'Space' ||
    event.keyCode === 32 ||
    event.which === 32
  );
}

function isCtrlModifierActive(event) {
  return Boolean(event.ctrlKey || event.getModifierState?.('Control'));
}

function isCtrlSpacePlaybackToggle(event) {
  if (!isCtrlModifierActive(event) || event.metaKey || event.altKey || event.shiftKey) {
    return false;
  }

  return isSpaceKey(event) || event.key === 'Process' || (event.keyCode === 229 && event.code === 'Space');
}

function isCtrlPlaybackToggle(event) {
  if (!isCtrlModifierActive(event) || event.metaKey || event.altKey || event.shiftKey) {
    return false;
  }

  const key = String(event.key ?? '').toLowerCase();
  return isCtrlSpacePlaybackToggle(event) || key === 'p' || event.code === 'KeyP';
}

function handleSubSegPlaybackShortcut(event) {
  if ((event.type === 'keydown' && event.repeat) || !isCtrlPlaybackToggle(event)) {
    return false;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(keyboardGuardSelector)) {
    return false;
  }

  const editor = target?.closest(subSegInputSelector) ?? getFocusedSubSegEditor();
  if (!(editor instanceof HTMLElement)) {
    return false;
  }

  if (event.type === 'keyup' && subSegPlaybackShortcutActive) {
    subSegPlaybackShortcutActive = false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  const now = Date.now();
  if (now - lastSubSegPlaybackShortcutAt < 250) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  lastSubSegPlaybackShortcutAt = now;
  subSegPlaybackShortcutActive = event.type === 'keydown';
  event.preventDefault();
  event.stopImmediatePropagation();
  void toggleSubSegAudEpPlayback(editor);
  return true;
}

document.addEventListener('mousemove', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!event.ctrlKey || !target || target.closest(pointerGuardSelector)) {
    hideProbe();
    return;
  }

  showProbe(buildSelectorChain(target), event.clientX, event.clientY);
});

document.addEventListener('keydown', handleSubSegPlaybackShortcut, true);
document.addEventListener('keyup', handleSubSegPlaybackShortcut, true);

document.addEventListener('keydown', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(keyboardGuardSelector)) {
    return;
  }

  if (handleLangUnitRefKeyboard(event)) {
    return;
  }

  if (isFocusedSubSegInput()) {
    const editor = getFocusedSubSegEditor();
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (enterLangUnitRefTraversal(editor)) {
        event.preventDefault();
        return;
      }
    }

    if (isCtrlPlaybackToggle(event)) {
      event.preventDefault();
      void toggleSubSegAudEpPlayback(editor);
      return;
    }

    if (isCtrlModifierActive(event) && !event.metaKey && !event.altKey && !event.shiftKey && event.key === 'Backspace') {
      event.preventDefault();
      const shouldReturnToRoot = editor?.dataset.subsegIsRoot === '0';
      if (shouldReturnToRoot) {
        focusParentSubSegInput(editor);
        return;
      }
      if (editor && resetLangUnitBubbleTarget(editor, true)) {
        showWorkerToast('target cleared', 1200);
        return;
      }
      closeEnteredAudSeg();
      return;
    }

    if (isCtrlModifierActive(event) && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (editor && cycleLangUnitBubbleTarget(editor, event.key === 'ArrowRight' ? 1 : -1)) {
          event.preventDefault();
          return;
        }
      }
    }

    if (event.key === 'Enter') {
      if (editor && getSubSegBubbleTargetIndex(editor) >= 0) {
        event.preventDefault();
        void focusCycleSubSegInput(editor);
        return;
      }
      if (editor && selectionTouchesLangUnitBubble(editor)) {
        event.preventDefault();
        showWorkerToast('not allowed', 1200);
        return;
      }
      if (editor && wrapSelectedSubSegText(editor)) {
        event.preventDefault();
        return;
      }
      if (editor && insertSubSegLineBreak(editor)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      return;
    }

    if (isSpaceKey(event) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (editor && autoLangUnitifyLinkedSubSegLineStart(editor)) {
        event.preventDefault();
        return;
      }
      if (editor && handleLangUnitBubbleSpace(editor)) {
        event.preventDefault();
        return;
      }
    }

    return;
  }

  if (state.deleteDialogKind === 'audSeg' || state.deleteDialogIndex >= 0) {
    if (state.deleteDialogKind === 'audSeg') {
      if (event.key === 'Tab') {
        event.preventDefault();
        cycleDeleteDialogChoice(event.shiftKey ? -1 : 1);
        return;
      }

      if (isCtrlModifierActive(event) && !event.metaKey && !event.altKey && !event.shiftKey) {
        if (event.key === 'Backspace') {
          event.preventDefault();
          closeDeleteDialog();
          return;
        }

        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          cycleDeleteDialogChoice(event.key === 'ArrowRight' ? 1 : -1);
        }
        return;
      }

      if (event.key === 'Enter' || isSpaceKey(event)) {
        event.preventDefault();
        if (state.deleteDialogChoice === 'confirm') {
          confirmDeleteSelectedAudSeg();
        } else {
          closeDeleteDialog();
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closeDeleteDialog();
      }

      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      cycleDeleteDialogChoice(event.shiftKey ? -1 : 1);
      return;
    }

    if (isCtrlModifierActive(event) && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (event.key === 'Backspace') {
        event.preventDefault();
        clearAudEpSelection();
        return;
      }

      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        cycleDeleteDialogChoice(event.key === 'ArrowRight' ? 1 : -1);
      }
      return;
    }

    if (event.key === 'Enter' || isSpaceKey(event)) {
      event.preventDefault();
      if (state.deleteDialogChoice === 'confirm') {
        confirmDeleteSelectedAudEp();
      } else {
        closeDeleteDialog();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeDeleteDialog();
    }

    return;
  }

  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    if (
      state.enteredAudEpIndex >= 0 &&
      state.enteredAudSegIndex < 0 &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      event.preventDefault();
      const items = getAudSegItemsForAudEp(state.enteredAudEpIndex);
      if (!items.length) {
        return;
      }

      state.selectedAudSegIndex =
        state.selectedAudSegIndex < 0
          ? 0
          : (state.selectedAudSegIndex + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      renderAudEps(state.audEpItems);
      return;
    }

    if (
      state.enteredAudEpIndex >= 0 &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      const items = getAudSegItemsForAudEp(state.enteredAudEpIndex);
      if (!items.length) {
        return;
      }

      state.selectedAudSegIndex =
        state.selectedAudSegIndex < 0
          ? 0
          : Math.max(
              0,
              Math.min(
                items.length - 1,
                state.selectedAudSegIndex + (event.key === 'ArrowDown' ? 3 : -3)
              )
            );
      renderAudEps(state.audEpItems);
      return;
    }

    if (event.key === 'Delete' && getSelectedAudSegItem()) {
      event.preventDefault();
      openDeleteDialog();
      return;
    }

    if (event.key === 'Delete' && state.selectedAudEpIndex > 0) {
      event.preventDefault();
      openDeleteDialog();
      return;
    }

    if (event.key === 'Backspace' && state.enteredAudSegIndex >= 0) {
      event.preventDefault();
      closeEnteredAudSeg();
      return;
    }

    if (event.key === 'Backspace' && state.enteredAudEpIndex >= 0) {
      event.preventDefault();
      closeEnteredAudEp();
      return;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      clearAudEpSelection();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      cycleAudEpSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      cycleAudEpSelection(-1);
    }
    return;
  }

  if (event.key === 'Enter') {
    if (state.enteredAudEpIndex >= 0 && state.selectedAudSegIndex >= 0) {
      event.preventDefault();
      lockSelectedAudSegPlayback();
      return;
    }
    event.preventDefault();
    enterSelectedAudEp();
    return;
  }

  if (state.enteredAudEpIndex >= 0 && event.key === 'Shift' && !event.repeat) {
    event.preventDefault();
    state.audSegCaptureShiftHeld = true;
    createAudSegDraft();
    return;
  }

  if (state.enteredAudEpIndex >= 0 && state.audSegDraftId && event.key === 'Escape') {
    event.preventDefault();
    cancelAudSegDraft();
    return;
  }

  if (
    state.enteredAudEpIndex >= 0 &&
    state.audSegDraftId &&
    isSpaceKey(event) &&
    (event.shiftKey || state.audSegCaptureShiftHeld)
  ) {
    event.preventDefault();
    void commitAudSegDraft();
    return;
  }

  if (state.enteredAudEpIndex >= 0 && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seekSelectedAudEpPlayback(event.key === 'ArrowRight' ? 5 : -5);
      return;
    }
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && state.selectedAudEpIndex > 0) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seekSelectedAudEpPlayback(event.key === 'ArrowRight' ? 5 : -5);
      return;
    }
  }

  if (isSpaceKey(event)) {
    event.preventDefault();
    toggleSelectedAudEpPlayback();
  }
});

document.addEventListener('keyup', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(keyboardGuardSelector)) {
    return;
  }

  if (event.key === 'Shift') {
    if (state.enteredAudEpIndex >= 0 && state.audSegDraftId && !state.audSegDraftCommitPending) {
      cancelAudSegDraft();
    }
    state.audSegCaptureShiftHeld = false;
  }
});

audEpList.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('.item__langunit-ref-graph')) {
    event.stopPropagation();
    return;
  }

  const langUnitRef = event.target instanceof Element ? event.target.closest('.item__langunit-ref') : null;
  if (langUnitRef instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    openLangUnitRef(langUnitRef);
    return;
  }

  const deleteButton = event.target instanceof Element ? event.target.closest('[data-delete-action]') : null;
  if (deleteButton) {
    const action = deleteButton.dataset.deleteAction;
    if (state.deleteDialogKind === 'audSeg') {
      if (action === 'confirm') {
        confirmDeleteSelectedAudSeg();
      } else {
        closeDeleteDialog();
      }
    } else {
      if (action === 'confirm') {
        confirmDeleteSelectedAudEp();
      } else {
        closeDeleteDialog();
      }
    }
    return;
  }

  const button = event.target instanceof Element ? event.target.closest('.addAudEp-button') : null;
  if (!button) {
    return;
  }

  state.pendingUploadIndex = Number(button.dataset.audepIndex || 0);
  filePicker.value = '';
  filePicker.click();
});

audEpList.addEventListener('pointerdown', (event) => {
  const canvas = event.target instanceof Element ? event.target.closest('.item__langunit-ref-canvas') : null;
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  event.preventDefault();
  canvas.closest('.item__langunit-ref-graph')?.focus?.({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  langUnitRefGraphDragByPointerId.set(event.pointerId, {
    canvas,
    x: event.clientX,
    y: event.clientY,
  });
});

audEpList.addEventListener('pointermove', (event) => {
  const drag = langUnitRefGraphDragByPointerId.get(event.pointerId);
  if (!drag) {
    return;
  }

  const refKey = String(drag.canvas.dataset.refKey ?? '').trim();
  const view = langUnitRefGraphViewByKey.get(refKey);
  if (!view) {
    return;
  }

  view.x += event.clientX - drag.x;
  view.y += event.clientY - drag.y;
  drag.x = event.clientX;
  drag.y = event.clientY;
  drawLangUnitRefGraphCanvas(drag.canvas);
});

audEpList.addEventListener('pointerup', (event) => {
  langUnitRefGraphDragByPointerId.delete(event.pointerId);
});

audEpList.addEventListener('pointercancel', (event) => {
  langUnitRefGraphDragByPointerId.delete(event.pointerId);
});

audEpList.addEventListener('wheel', (event) => {
  if (!event.ctrlKey) {
    return;
  }

  const canvas = event.target instanceof Element ? event.target.closest('.item__langunit-ref-canvas') : null;
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  const refKey = String(canvas.dataset.refKey ?? '').trim();
  const view = langUnitRefGraphViewByKey.get(refKey);
  if (!view) {
    return;
  }

  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const nextScale = Math.max(0.35, Math.min(4, view.scale * (event.deltaY < 0 ? 1.1 : 0.9)));
  const graphX = (px - view.x) / view.scale;
  const graphY = (py - view.y) / view.scale;
  view.scale = nextScale;
  view.x = px - graphX * nextScale;
  view.y = py - graphY * nextScale;
  drawLangUnitRefGraphCanvas(canvas);
}, { passive: false });

audEpList.addEventListener('input', (event) => {
  const input = event.target instanceof Element ? event.target.closest('.item__subseg-input') : null;
  if (!(input instanceof HTMLElement)) {
    return;
  }

  syncSubSegEditorDraft(input);
});

window.addEventListener('pagehide', () => {
  for (const subSegId of subSegSaveTimersBySubSegId.keys()) {
    flushSubSegSave(subSegId);
  }
});

filePicker.addEventListener('change', async () => {
  const file = filePicker.files?.[0];
  if (!file) {
    return;
  }

  const response = await fetch('/api/audEps/upload', {
    method: 'POST',
    headers: {
      'X-Filename': encodeURIComponent(file.name),
      'X-Item-Index': String(state.pendingUploadIndex),
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });

  if (!response.ok) {
    return;
  }

  await reloadAudData();
});

document.addEventListener(
  'click',
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!event.ctrlKey || !target || target.closest(pointerGuardSelector)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (state.activeElement) {
      state.activeElement.classList.remove('is-targeted');
    }

    closeDeleteDialog();
    const selector = buildSelectorChain(target);
    target.classList.add('is-targeted');
    openSidebar(selector, target);
  },
  true
);

settingsButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleSettingsPopover();
});

settingsPopoverWorkerCheckbox?.addEventListener('change', () => {
  setCodexWordRootInferenceEnabled(settingsPopoverWorkerCheckbox.checked);
});

settingsPopoverChinDisambiguationCheckbox?.addEventListener('change', () => {
  setChinDisambiguationEnabled(settingsPopoverChinDisambiguationCheckbox.checked);
});

settingsPopoverClearSubSegsButton?.addEventListener('click', () => {
  void clearAllSubSegs();
});

settingsPopoverClearLangUnitsButton?.addEventListener('click', () => {
  void clearAllLangUnits();
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.settings-shell')) {
    return;
  }

  toggleSettingsPopover(false);
});

saveButton.addEventListener('click', async () => {
  const text = noteInput.value;
  if (!text.trim() || !state.activeSelector) {
    return;
  }

  const response = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selector: state.activeSelector, text }),
  });

  const updated = await response.json();
  state.notesBySelector[state.activeSelector] = updated;
  noteInput.value = '';
  renderNotes(state.activeSelector);
  syncNoteDecorations();
});

closeButton.addEventListener('click', closeSidebar);

noteList.addEventListener(
  'toggle',
  (event) => {
    const details = event.target instanceof HTMLDetailsElement ? event.target : null;
    if (!details || !state.activeSelector) {
      return;
    }

    state.historyOpenBySelector[state.activeSelector] = details.open;
  },
  true
);

noteSelector.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-selector-target]') : null;
  if (!target) {
    return;
  }

  const selector = target.dataset.selectorTarget;
  const element = document.querySelector(selector);
  if (!element) {
    return;
  }

  if (state.activeElement) {
    state.activeElement.classList.remove('is-targeted');
  }

  closeDeleteDialog();
  element.classList.add('is-targeted');
  openSidebar(selector, element);
});

fetch('/api/notes')
  .then((response) => response.json())
  .then((notes) => {
    state.notesBySelector = notes;
    syncNoteDecorations();
    if (state.activeSelector) {
      renderNotes(state.activeSelector);
    }
  })
  .catch(() => {
    state.notesBySelector = {};
  });

syncSettingsPopover();
void refreshCodexWorkerStatus({ startup: true });
reloadAudData();
