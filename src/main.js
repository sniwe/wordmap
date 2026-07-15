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
  audSegPlaybackLock: null,
  deleteDialogIndex: -1,
  deleteDialogKind: 'audEp',
  deleteDialogAudSegId: '',
  deleteDialogChoice: 'cancel',
  notesBySelector: {},
  activeSelector: '',
  activeElement: null,
  historyOpenBySelector: {},
};

const keyboardGuardSelector = '.note-sidebar, .selector-probe';
const pointerGuardSelector = '.selector-probe, .note-sidebar__selector';
const subSegInputSelector = '.item__subseg-input';
const audioPlayers = new Map();
const pendingSeekByIndex = new Map();
const pendingSeekFrameByIndex = new Map();
const subSegDraftTextBySubSegId = new Map();
const subSegDraftPayloadBySubSegId = new Map();
const subSegSaveTimersBySubSegId = new Map();
const langUnitBubbleEscapeState = new Map();
const langUnitBubbleTargetIndexByAudSegId = new Map();
let settingsOpen = false;
let codexWordRootInferenceEnabled = localStorage.getItem('codex-word-root-inference-enabled') === '1';
let chinDisambiguationEnabled = localStorage.getItem('chin-disambiguation-enabled') === '1';
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
  for (const subSegItem of getSubSegItemsForAudSeg(audSegId)) {
    const subSegId = String(subSegItem?._id ?? '').trim();
    if (subSegId) {
      langUnitBubbleTargetIndexByAudSegId.delete(subSegId);
    }
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

function lockSelectedAudSegPlayback() {
  const item = getSelectedAudSegItem();
  if (!item) {
    return;
  }

  const tcs = Number(item.tcs ?? 0);
  const tce = Number(item.tce ?? 0);
  if (!Number.isFinite(tcs) || !Number.isFinite(tce) || tce <= tcs) {
    return;
  }

  state.audSegPlaybackLock = {
    audEpIndex: state.enteredAudEpIndex,
    tcs,
    tce,
  };
  state.enteredAudSegIndex = state.selectedAudSegIndex;
  renderAudEps(state.audEpItems);
  requestAnimationFrame(() => {
    const input = audEpList.querySelector(
      `.item__segment--entered .item__subseg-input[data-subseg-audseg-id="${CSS.escape(String(item._id ?? ''))}"]`
    );
    if (input instanceof HTMLElement) {
      syncLangUnitBubbleTarget(input, false);
      input.focus({ preventScroll: true });
    }
  });
  seekAudio(state.selectedAudEpIndex - 1, tcs - (getAudioForIndex(state.selectedAudEpIndex - 1)?.currentTime || 0));
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

  const audEpIndex = Number(audSegItem.audEpIndex);
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
  const rootSubSegId = getRootSubSegItemForAudSeg(audSegId)?._id || '';
  if (rootSubSegId) {
    setSubSegBubbleTargetIndex(rootSubSegId, getLangUnitBubbleIndex(audSegId, langUnitId));
  }
  lockSelectedAudSegPlayback();
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

function getCycleSubSegItemForTarget(audSegId, linkTargetLangUnitId, excludeSubSegId = '') {
  const targetId = String(linkTargetLangUnitId ?? '').trim();
  const excluded = String(excludeSubSegId ?? '').trim();
  return getSubSegItemsForAudSeg(audSegId).find(
    (item) =>
      item?.isRoot === false &&
      String(item?._id ?? '') !== excluded &&
      String(item?.linkTargetLangUnitId ?? '') === targetId
  ) ?? null;
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

function getSubSegLinkTargetLangUnitId(item) {
  return String(item?.linkTargetLangUnitId ?? '').trim();
}

function getSubSegItemsInTreeOrder(audSegId) {
  const items = getSubSegItemsForAudSeg(audSegId);
  const root = items.find((item) => item?.isRoot !== false) ?? null;
  if (!root) {
    return items;
  }

  const itemById = new Map(items.map((item) => [String(item?._id ?? ''), item]));
  const childrenByParentId = new Map();
  for (const item of items) {
    const itemId = String(item?._id ?? '');
    if (!itemId || item?.isRoot !== false) {
      continue;
    }

    const parentId = getSubSegIdForLangUnitId(getSubSegLinkTargetLangUnitId(item));
    if (!parentId || !itemById.has(parentId)) {
      continue;
    }

    childrenByParentId.set(parentId, [...(childrenByParentId.get(parentId) ?? []), item]);
  }

  const seen = new Set();
  const ordered = [];
  const pushSubtree = (item) => {
    const itemId = String(item?._id ?? '');
    if (!itemId || seen.has(itemId)) {
      return;
    }

    seen.add(itemId);
    ordered.push(item);
    const childOrder = getOrderedLangUnitIds(getSubSegContentTokens(audSegId, itemId));
    const children = childrenByParentId.get(itemId) ?? [];
    children.sort((a, b) => {
      const indexA = childOrder.indexOf(getSubSegLinkTargetLangUnitId(a));
      const indexB = childOrder.indexOf(getSubSegLinkTargetLangUnitId(b));
      if (indexA !== indexB) {
        return (indexA < 0 ? Number.MAX_SAFE_INTEGER : indexA) - (indexB < 0 ? Number.MAX_SAFE_INTEGER : indexB);
      }

      return sortSubSegItems([a, b])[0] === a ? -1 : 1;
    });
    children.forEach(pushSubtree);
  };

  pushSubtree(root);
  items.filter((item) => !seen.has(String(item?._id ?? ''))).forEach(pushSubtree);
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
      const langUnitCycleGroupId = node.getAttribute('data-langunit-cycle-group-id');
      const dataAttr = langUnitId ? ` data-langunit-id="${escapeHtml(langUnitId)}"` : '';
      const remoteAttr = langUnitRemote ? ' data-langunit-remote="1"' : '';
      const cycleGroupAttr = langUnitCycleGroupId ? ` data-langunit-cycle-group-id="${escapeHtml(langUnitCycleGroupId)}"` : '';
      return `<span class="langunit-bubble"${dataAttr}${remoteAttr}${cycleGroupAttr}>${bubbleContent}</span>`;
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
    const text = String(getLangUnitText(langUnit) || token.text || '');
    const remote = token.remote === true || cycleGroupId !== langUnitId;
    if (
      currentBubble &&
      currentBubble.langUnitId === langUnitId &&
      currentBubble.cycleGroupId === cycleGroupId
    ) {
      currentBubble.text += text;
      continue;
    }

    flushBubble();
    currentBubble = {
      type: 'bubble',
      langUnitId,
      text,
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
        const cycleGroupAttr = segment.cycleGroupId
          ? ` data-langunit-cycle-group-id="${escapeHtml(segment.cycleGroupId)}"`
          : '';
        return `<span class="langunit-bubble" data-langunit-id="${escapeHtml(segment.langUnitId)}"${remoteAttr}${countAttr}${cycleGroupAttr}>${escapeHtml(segment.text)}</span>`;
      }

      return '';
    })
    .join('');
}

function renderSubSegList(audSegItem) {
  const audSegId = audSegItem?._id || '';
  ensureRootSubSegItem(audSegId);
  const subSegItems = getSubSegItemsInTreeOrder(audSegId);
  const valueBySubSegId = new Map(
    [...subSegDraftTextBySubSegId.entries()].filter(([key]) => subSegItems.some((item) => String(item?._id ?? '') === key))
  );
  const renderEditor = (subSegItem, placeholderText = '') => {
    const subSegId = String(subSegItem?._id ?? '');
    const linkTargetLangUnitId = getSubSegLinkTargetLangUnitId(subSegItem);
    const value = valueBySubSegId.get(subSegId);
    const renderedContent = subSegItem?.content ? renderSubSegContentTokens(subSegItem.content, subSegId) : '';
    const hasLangUnitRefs = Array.isArray(subSegItem?.content) && subSegItem.content.some((token) => token?.type === 'langUnitRef');
    const content = normalizeSubSegEditorMarkup(
      value ?? (hasLangUnitRefs ? renderedContent : sanitizeSubSegMarkup(subSegItem?.text ?? '') || renderedContent)
    );
    return `
      <li class="item__subseg${subSegItem?.isRoot === false ? ' item__subseg--cycle' : ' item__subseg--seed'}" data-subseg-id="${escapeHtml(subSegId)}" data-subseg-audseg-id="${escapeHtml(audSegId)}" data-subseg-is-root="${subSegItem?.isRoot === false ? '0' : '1'}">
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
          ${subSegItem?.isRoot === false ? ' data-placeholder="no subSeg yet.."' : ''}
        >${subSegItem?.isRoot === false && !content ? '' : content}</div>
      </li>
    `;
  };

  const items = [];
  items.push(...subSegItems.map((item) => renderEditor(item)));

  return `
    <ul class="item__subsegs" aria-label="subSegs">
      ${items.join('')}
    </ul>
  `;
}

function renderLangUnitRefsList(audSegItem) {
  const audSegId = audSegItem?._id || '';
  const subSegItem = getRootSubSegItemForAudSeg(audSegId);
  const targetIndex = getSubSegBubbleTargetIndexByKey(String(subSegItem?._id ?? ''));
  const payload = subSegDraftPayloadBySubSegId.get(String(subSegItem?._id ?? ''));
  const tokens = Array.isArray(payload?.content) ? payload.content : Array.isArray(subSegItem?.content) ? subSegItem.content : [];
  const langUnitId = getOrderedLangUnitIds(tokens)[targetIndex] ?? '';

  const langUnit = getLangUnitItem(langUnitId);
  const subSegId = subSegItem?._id || '';
  const links = [];
  const seen = new Set();
  for (const subSegItem of state.subSegItems) {
    const itemSubSegId = String(subSegItem?._id ?? '').trim();
    const itemAudSegId = String(subSegItem?.audSegId ?? '').trim();
    if (!itemSubSegId || !itemAudSegId) {
      continue;
    }

    const tokens = getSubSegContentTokens(itemAudSegId, itemSubSegId);
    if (!tokens.some((token) => token?.type === 'langUnitRef' && String(token.langUnitId ?? '') === langUnitId)) {
      continue;
    }

    if (itemSubSegId === subSegId || seen.has(itemSubSegId)) {
      continue;
    }

    seen.add(itemSubSegId);
    links.push({ audSegId: itemAudSegId, subSegId: itemSubSegId });
  }

  if (!langUnitId) {
    return '<ul class="item__langunit-refs" hidden></ul>';
  }

  const context = getLangUnitContextText(langUnit) || String(getLangUnitText(langUnit) ?? '').trim();
  const items = links
    .map(
      (ref) => `
        <li class="item__langunit-ref" data-subseg-id="${escapeHtml(String(ref?.subSegId ?? ''))}" data-audseg-id="${escapeHtml(String(ref?.audSegId ?? ''))}" data-langunit-id="${escapeHtml(langUnitId)}">
      <span class="item__langunit-ref-context">${escapeHtml(getRootSubSegItemForAudSeg(String(ref?.audSegId ?? ''))?.text ?? context).replaceAll('\n', '<br>')}</span>
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
  const linkTargetLangUnitId = String(editor.dataset.linkTargetLangUnitId ?? '').trim();
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
      const bubbleText = String(node.textContent ?? '').trim();
      const rawLangUnitId = String(node.getAttribute('data-langunit-id') ?? '').trim();
      let langUnitId = rawLangUnitId;
      if (langUnitId) {
        const prefix = `${subSegId}-`;
        if (!langUnitId.startsWith(prefix)) {
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

function syncLangUnitBubbleTarget(editor, restoreCaret = false) {
  if (!(editor instanceof HTMLElement)) {
    return;
  }

  const targetKey = getSubSegBubbleTargetKey(editor);
  const bubbles = getLangUnitBubbles(editor);
  const groupIds = getLangUnitBubbleGroupIds(editor);
  const targetIndex = getSubSegBubbleTargetIndex(editor);
  const targetLangUnitId = groupIds[targetIndex] ?? '';

  bubbles.forEach((bubble) => bubble.classList.remove('is-targeted'));
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
    const linkTargetLangUnitId = getOrderedLangUnitIds(getSubSegContentTokens(audSegId, subSegId))[targetIndex] ?? '';
    if (!linkTargetLangUnitId) {
      return false;
    }

    const current = getCycleSubSegItemForTarget(audSegId, linkTargetLangUnitId, subSegId);
    if (current) {
      return false;
    }

    if (!createIfMissing) {
      return false;
    }

    const next = {
      _id: buildDerivedId(audSegId, getNextSubSegOrdinal(audSegId)) || createItemId(),
      audSegId,
      isRoot: false,
      ...(linkTargetLangUnitId ? { linkTargetLangUnitId } : {}),
      content: [],
      text: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.subSegItems = sortSubSegItems([next, ...state.subSegItems]);
    void fetch('/api/subSegs/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subSegId: String(next._id ?? ''), ...next }),
    });
    return true;
  }

  return false;
}

function focusCycleSubSegInput(editor) {
  if (!(editor instanceof HTMLElement)) {
    return false;
  }

  const audSegId = editor.dataset.subsegAudsegId || '';
  if (getSubSegBubbleTargetIndex(editor) < 0) {
    return false;
  }

  const subSegId = getSubSegEditorKey(editor);
  const targetIndex = getSubSegBubbleTargetIndex(editor);
  const linkTargetLangUnitId = getOrderedLangUnitIds(getSubSegContentTokens(audSegId, subSegId))[targetIndex] ?? '';
  if (!linkTargetLangUnitId) {
    return false;
  }

  const changed = syncCycleSubSegRow(editor, true);
  if (changed) {
    renderAudEps(state.audEpItems);
  }

  requestAnimationFrame(() => {
    const cycleEditor = [...audEpList.querySelectorAll(`.item__subseg-input[data-subseg-audseg-id="${CSS.escape(String(audSegId))}"][data-link-target-langunit-id="${CSS.escape(String(linkTargetLangUnitId))}"]`)]
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

  const subSegId = getSubSegEditorKey(editor);
  const groups = getLangUnitBubbleGroupIds(editor);
  if (!groups.length) {
    return false;
  }

  const currentIndex = getSubSegBubbleTargetIndex(editor);
  const slots = groups.length + 1;
  const nextIndex = ((currentIndex + 1 + step + slots) % slots) - 1;

  setSubSegBubbleTargetIndex(editor, nextIndex);
  syncLangUnitBubbleTarget(editor, nextIndex === -1);
  const shouldRenderCycleRow = currentIndex < 0 && nextIndex >= 0;
  const changed = syncCycleSubSegRow(editor, true);
  if (changed || shouldRenderCycleRow) {
    renderAudEps(state.audEpItems);
    requestAnimationFrame(() => {
      const liveEditor = audEpList.querySelector(`.item__subseg-input[data-subseg-id="${CSS.escape(String(subSegId))}"]`);
      if (liveEditor instanceof HTMLElement) {
        syncLangUnitBubbleTarget(liveEditor, false);
        liveEditor.focus({ preventScroll: true });
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
  const parentSubSegId = getSubSegIdForLangUnitId(getSubSegLinkTargetLangUnitId(subSegItem));
  if (!parentSubSegId) {
    focusRootSubSegInput(audSegId);
    return;
  }

  clearSubSegBubbleTarget(editor);
  requestAnimationFrame(() => {
    const parentEditor = audEpList.querySelector(`.item__subseg-input[data-subseg-id="${CSS.escape(parentSubSegId)}"]`);
    if (parentEditor instanceof HTMLElement) {
      parentEditor.focus({ preventScroll: true });
      setCaretToEnd(parentEditor);
    }
  });
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
  autosizeSubSegInput(editor);
  scheduleSubSegSave(subSegId);
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
  const langUnit = targetLangUnitId ? null : getLangUnitItemByText(text);
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
  const editor = audEpList.querySelector(`.item__subseg-input[data-subseg-id="${CSS.escape(String(subSegId))}"]`);
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

async function saveSubSeg(subSegId) {
  const payload = subSegDraftPayloadBySubSegId.get(subSegId);
  if (!payload) {
    return;
  }

  const knownLangUnitIds = new Set(state.langUnitItems.map((item) => item?._id).filter(Boolean));
  const liveEditor = audEpList.querySelector(`.item__subseg-input[data-subseg-id="${CSS.escape(String(subSegId))}"]`);
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
    return;
  }

  const result = await response.json();
  const saved = result?.subSeg ?? result;
  subSegDraftTextBySubSegId.delete(subSegId);
  subSegDraftPayloadBySubSegId.delete(subSegId);
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
  state.subSegItems = sortSubSegItems(
    saved
      ? [saved, ...state.subSegItems.filter((item) => String(item?._id ?? '') !== String(saved._id ?? ''))]
      : state.subSegItems.filter((item) => String(item?._id ?? '') !== String(subSegId))
  );
  if (liveEditor instanceof HTMLElement && document.activeElement === liveEditor) {
    refreshLangUnitBubbleGroupStyles(liveEditor);
    refreshLangUnitConnectors(liveEditor);
  } else {
    renderAudEps(state.audEpItems);
  }
  syncLangUnitRefsLists();
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
  if (!draft) {
    return;
  }

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
    state.audSegItems = state.audSegItems.map((item) => (item?._id === draft._id ? saved : item));
  } catch {
    state.audSegItems = state.audSegItems.filter((item) => item?._id !== draft._id);
  } finally {
    state.audSegDraftId = '';
    state.selectedAudSegIndex = -1;
    state.enteredAudSegIndex = -1;
    renderAudEps(state.audEpItems);
  }
}

function cancelAudSegDraft() {
  if (!state.audSegDraftId) {
    return;
  }

  state.audSegItems = state.audSegItems.filter((item) => item?._id !== state.audSegDraftId);
  state.audSegDraftId = '';
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
  audio.addEventListener('loadeddata', () => handleAudioReady(index));
  audio.addEventListener('canplay', () => handleAudioReady(index));
  audio.addEventListener('timeupdate', () => syncAudEpPlaybackLabel(index));
  audio.addEventListener('play', () => handleAudioPlay(index));
  audio.addEventListener('pause', () => handleAudioStop(index));
  audio.addEventListener('ended', () => handleAudioStop(index));
  audioPlayers.set(index, audio);

  audio._readyPromise = (async () => {
    try {
      const response = await fetch(src);
      if (!response.ok) {
        throw new Error('audio fetch failed');
      }

      const objectUrl = URL.createObjectURL(await response.blob());
      if (audioPlayers.get(index) !== audio) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      audio._objectUrl = objectUrl;
      audio.src = objectUrl;
      audio.load();
    } catch {
      if (audioPlayers.get(index) === audio) {
        audio.src = src;
        audio.load();
      }
    }
  })();

  return audio;
}

function handleAudioReady(index) {
  const audio = audioPlayers.get(index);
  if (!audio) {
    return;
  }

  const pendingSeek = pendingSeekByIndex.get(index);
  if (Number.isFinite(pendingSeek)) {
    pendingSeekByIndex.delete(index);
    const existingFrame = pendingSeekFrameByIndex.get(index);
    if (existingFrame) {
      cancelAnimationFrame(existingFrame);
    }

    const frame = requestAnimationFrame(() => {
      if (!audioPlayers.has(index)) {
        return;
      }

      applyAudioSeek(index, audio, pendingSeek);
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
}

function seekAudio(index, deltaSeconds) {
  const audio = getAudioForIndex(index);
  if (!audio) {
    return;
  }

  const duration = Number.isFinite(audio.duration) ? audio.duration : Number.POSITIVE_INFINITY;
  const nextTime = Math.max(0, Math.min((audio.currentTime || 0) + deltaSeconds, duration));
  if (audio.networkState !== HTMLMediaElement.NETWORK_IDLE || audio.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
    pendingSeekByIndex.set(index, nextTime);
    audio.load();
  } else {
    applyAudioSeek(index, audio, nextTime);
  }
  syncAudEpPlaybackLabel(index);
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

  const audSegId = String(state.audSegItems[state.enteredAudSegIndex]?._id ?? '');
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

async function toggleSelectedAudEpPlayback() {
  if (state.selectedAudEpIndex < 0) {
    return;
  }

  const audio = state.selectedAudEpIndex === 0 ? null : getAudioForIndex(state.selectedAudEpIndex - 1);
  if (!audio) {
    return;
  }

  if (audio.paused) {
    pauseOtherAudio(state.selectedAudEpIndex - 1);
    await audio.play();
  } else {
    audio.pause();
  }
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

document.addEventListener('mousemove', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!event.ctrlKey || !target || target.closest(pointerGuardSelector)) {
    hideProbe();
    return;
  }

  showProbe(buildSelectorChain(target), event.clientX, event.clientY);
});

document.addEventListener('keydown', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(keyboardGuardSelector)) {
    return;
  }

  if (isFocusedSubSegInput()) {
    const editor = getFocusedSubSegEditor();
    const audSegId = editor?.dataset.subsegAudsegId || '';
    if (isCtrlPlaybackToggle(event)) {
      event.preventDefault();
      toggleSelectedAudEpPlayback();
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
      if (editor && focusCycleSubSegInput(editor)) {
        event.preventDefault();
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
    createAudSegDraft();
    return;
  }

  if (state.enteredAudEpIndex >= 0 && state.audSegDraftId && event.key === 'Escape') {
    event.preventDefault();
    cancelAudSegDraft();
    return;
  }

  if (state.enteredAudEpIndex >= 0 && state.audSegDraftId && isSpaceKey(event) && event.shiftKey) {
    event.preventDefault();
    void commitAudSegDraft();
    return;
  }

  if (state.enteredAudEpIndex >= 0 && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seekAudio(state.selectedAudEpIndex - 1, event.key === 'ArrowRight' ? 5 : -5);
      return;
    }
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && state.selectedAudEpIndex > 0) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seekAudio(state.selectedAudEpIndex - 1, event.key === 'ArrowRight' ? 5 : -5);
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

  if (event.key === 'Shift' && state.enteredAudEpIndex >= 0 && state.audSegDraftId) {
    cancelAudSegDraft();
  }
});

audEpList.addEventListener('click', (event) => {
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
