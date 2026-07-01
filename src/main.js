import './styles.css';

const app = document.querySelector('#app');

app.innerHTML = `
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
  pendingUploadIndex: 0,
  selectedAudEpIndex: -1,
  enteredAudEpIndex: -1,
  selectedAudSegIndex: -1,
  enteredAudSegIndex: -1,
  audSegDraftId: '',
  audSegPlaybackLock: null,
  deleteDialogIndex: -1,
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
const subSegDraftTextByAudSegId = new Map();
const subSegSaveTimers = new Map();

function renderAudEps(items) {
  const source = [{ __seed: true }, ...items];
  if (!items.length) {
    state.selectedAudEpIndex = -1;
    state.enteredAudEpIndex = -1;
    state.selectedAudSegIndex = -1;
    state.enteredAudSegIndex = -1;
  } else {
    state.enteredAudEpIndex = Math.max(-1, Math.min(state.enteredAudEpIndex, items.length - 1));
  }

  audEpList.innerHTML = source
    .map((item, index) => {
      const displayIndex = index;
      const dataIndex = Math.max(index - 1, 0);
      const mediaName = item.__seed ? '' : item.audioFileRef || item.media?.[item.media.length - 1]?.storedName || '';
      const deleteDialogOpen = !item.__seed && state.deleteDialogIndex === displayIndex;
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
  requestAnimationFrame(syncSubSegTextareaHeights);
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
  return state.audSegItems
    .filter((item) => Number(item?.audEpIndex) === index)
    .slice()
    .sort((a, b) => Number(a?.tcs ?? 0) - Number(b?.tcs ?? 0));
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
    if (input instanceof HTMLTextAreaElement) {
      input.focus({ preventScroll: true });
    }
  });
  seekAudio(state.selectedAudEpIndex - 1, tcs - (getAudioForIndex(state.selectedAudEpIndex - 1)?.currentTime || 0));
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
          const label = item.ssHead ?? item.label ?? item.text ?? '';
          const tcs = formatTime(Number(item.tcs ?? 0));
          const tce = item.tce == null || item.tce === '' ? '  ' : formatTime(Number(item.tce));
          const hasLabel = Boolean(String(label).trim());
          const subSegMarkup = isEntered ? renderSubSegList(item) : '';
          return `
            <li class="item__segment${isDraft ? ' item__segment--draft' : ''}${isEntered ? ' item__segment--entered' : ''}${isTargeted ? ' is-targeted' : ''}">
              <span class="item__segment-timing">${escapeHtml(`${tcs}-${tce}`)}</span>
              ${hasLabel ? `<span class="item__segment-text">${escapeHtml(label)}</span>` : ''}
              ${subSegMarkup}
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

function getSubSegItemForAudSeg(audSegId) {
  return state.subSegItems.find((item) => item?.audSegId === audSegId) ?? null;
}

function renderSubSegList(audSegItem) {
  const audSegId = audSegItem?._id || '';
  const subSegItem = getSubSegItemForAudSeg(audSegId);
  const value = subSegDraftTextByAudSegId.get(audSegId) ?? subSegItem?.text ?? '';
  return `
    <ul class="item__subsegs" aria-label="subSegs">
      <li class="item__subseg item__subseg--seed">
        <textarea
          class="item__subseg-input"
          aria-label="subSeg input"
          placeholder=""
          rows="1"
          data-subseg-audseg-id="${escapeHtml(audSegId)}"
        >${escapeHtml(value)}</textarea>
      </li>
    </ul>
  `;
}

function autosizeSubSegInput(input) {
  if (!(input instanceof HTMLTextAreaElement)) {
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

function scheduleSubSegSave(audSegId, text) {
  if (!audSegId) {
    return;
  }

  const existing = subSegSaveTimers.get(audSegId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    subSegSaveTimers.delete(audSegId);
    void saveSubSeg(audSegId, text);
  }, 500);

  subSegSaveTimers.set(audSegId, timer);
}

function flushSubSegSave(audSegId) {
  const text = subSegDraftTextByAudSegId.get(audSegId);
  if (typeof text !== 'string') {
    return;
  }

  const existing = subSegSaveTimers.get(audSegId);
  if (existing) {
    clearTimeout(existing);
    subSegSaveTimers.delete(audSegId);
  }

  const body = JSON.stringify({ audSegId, text });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/subSegs/items', new Blob([body], { type: 'application/json' }));
    return;
  }

  void saveSubSeg(audSegId, text);
}

async function saveSubSeg(audSegId, text) {
  const payload = {
    audSegId,
    text,
  };

  const response = await fetch('/api/subSegs/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return;
  }

  const saved = await response.json();
  subSegDraftTextByAudSegId.delete(audSegId);
  state.subSegItems = saved
    ? [saved, ...state.subSegItems.filter((item) => item?.audSegId !== audSegId)]
    : state.subSegItems.filter((item) => item?.audSegId !== audSegId);
}

function createAudSegDraft() {
  if (state.enteredAudEpIndex < 0 || state.audSegDraftId) {
    return;
  }

  const audio = getSelectedAudEpMediaPlayer();
  const draft = {
    _id: `draft-${Date.now()}`,
    audEpIndex: state.enteredAudEpIndex,
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
    audEpIndex: draft.audEpIndex,
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
  await loadSubSegs();
}

function getSelectedAudEpDataIndex() {
  return state.selectedAudEpIndex > 0 ? state.selectedAudEpIndex - 1 : -1;
}

function renderDeleteDialog() {
  if (state.deleteDialogIndex < 0) {
    return;
  }

  renderAudEps(state.audEpItems);
  const dialogButton = audEpList.querySelector(
    `.item[data-audep-index="${state.deleteDialogIndex}"] [data-delete-action="${state.deleteDialogChoice}"]`
  );
  dialogButton?.focus();
}

function openDeleteDialog() {
  if (state.selectedAudEpIndex <= 0) {
    return;
  }

  state.deleteDialogIndex = state.selectedAudEpIndex;
  state.deleteDialogChoice = 'cancel';
  renderDeleteDialog();
}

function closeDeleteDialog() {
  if (state.deleteDialogIndex < 0) {
    return;
  }

  state.deleteDialogIndex = -1;
  state.deleteDialogChoice = 'cancel';
  state.selectedAudSegIndex = -1;
  renderAudEps(state.audEpItems);
}

function cycleDeleteDialogChoice() {
  if (state.deleteDialogIndex < 0) {
    return;
  }

  state.deleteDialogChoice = state.deleteDialogChoice === 'cancel' ? 'confirm' : 'cancel';
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
  state.deleteDialogChoice = 'cancel';
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
    if (event.key === 'Enter') {
      return;
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === ' ') {
      event.preventDefault();
      toggleSelectedAudEpPlayback();
      return;
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === 'Backspace') {
      event.preventDefault();
      closeEnteredAudSeg();
    }
    return;
  }

  if (state.deleteDialogIndex >= 0) {
    if (event.key === 'Tab') {
      event.preventDefault();
      cycleDeleteDialogChoice(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        cycleDeleteDialogChoice(event.key === 'ArrowRight' ? 1 : -1);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        confirmDeleteSelectedAudEp();
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
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
      openDeleteDialog();
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

  if (state.enteredAudEpIndex >= 0 && state.audSegDraftId && event.key === ' ' && event.shiftKey) {
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

  if (event.key === ' ') {
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
  const deleteButton = event.target instanceof Element ? event.target.closest('[data-delete-action]') : null;
  if (deleteButton) {
    const action = deleteButton.dataset.deleteAction;
    if (action === 'confirm') {
      confirmDeleteSelectedAudEp();
    } else {
      closeDeleteDialog();
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
  const input =
    event.target instanceof HTMLTextAreaElement ? event.target.closest('.item__subseg-input') : null;
  if (!(input instanceof HTMLTextAreaElement)) {
    return;
  }

  const audSegId = input.dataset.subsegAudsegId || '';
  subSegDraftTextByAudSegId.set(audSegId, input.value);
  autosizeSubSegInput(input);
  scheduleSubSegSave(input.dataset.subsegAudsegId || '', input.value);
});

window.addEventListener('pagehide', () => {
  for (const audSegId of subSegSaveTimers.keys()) {
    flushSubSegSave(audSegId);
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

saveButton.addEventListener('click', async () => {
  const text = noteInput.value.trim();
  if (!text || !state.activeSelector) {
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

reloadAudData();
