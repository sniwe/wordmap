import './styles.css';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="settings-shell">
    <button class="settings-button" id="settings-button" type="button" aria-haspopup="menu" aria-expanded="false">⚙</button>
    <div class="settings-popover" id="settings-popover" role="menu" hidden>
      <label class="settings-popover__item">
        <input type="checkbox" />
        <span>codex CLI worker</span>
      </label>
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
const settingsPopoverCheckbox = settingsPopover?.querySelector('input[type="checkbox"]');
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
const subSegDraftPayloadByAudSegId = new Map();
const subSegSaveTimers = new Map();
const langUnitBubbleEscapeState = new Map();
const langUnitBubbleTargetIndexByAudSegId = new Map();
let settingsOpen = false;
let codexWordRootInferenceEnabled = localStorage.getItem('codex-word-root-inference-enabled') === '1';
let workerToastTimer = null;
if (import.meta.env.DEV) {
  createDevReloadTone();
}

function createItemId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  return state.audSegItems
    .filter((item) => Number(item?.audEpIndex) === index)
    .slice()
    .sort((a, b) => Number(a?.tcs ?? 0) - Number(b?.tcs ?? 0));
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
  langUnitBubbleTargetIndexByAudSegId.set(audSegId, getLangUnitBubbleIndex(audSegId, langUnitId));
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
          const label = item.ssHead ?? item.label ?? item.text ?? '';
          const tcs = formatTime(Number(item.tcs ?? 0));
          const tce = item.tce == null || item.tce === '' ? '  ' : formatTime(Number(item.tce));
          const hasLabel = Boolean(String(label).trim());
          const subSegMarkup = isEntered ? renderSubSegList(item) : '';
          const langUnitRefsMarkup = isEntered ? renderLangUnitRefsList(item) : '';
          return `
            <li class="item__segment${isDraft ? ' item__segment--draft' : ''}${isEntered ? ' item__segment--entered' : ''}${isTargeted ? ' is-targeted' : ''}">
              <span class="item__segment-timing">${escapeHtml(`${tcs}-${tce}`)}</span>
              ${hasLabel ? `<span class="item__segment-text">${escapeHtml(label)}</span>` : ''}
              ${subSegMarkup}
              ${langUnitRefsMarkup}
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

function getLangUnitBubbleIndex(audSegId, langUnitId) {
  if (!audSegId || !langUnitId) {
    return -1;
  }

  const subSegItem = getSubSegItemForAudSeg(audSegId);
  const payload = subSegDraftPayloadByAudSegId.get(audSegId);
  const tokens = Array.isArray(payload?.content)
    ? payload.content
    : Array.isArray(subSegItem?.content)
      ? subSegItem.content
      : [];
  let bubbleIndex = -1;

  for (const token of tokens) {
    if (token?.type !== 'langUnitRef') {
      continue;
    }

    bubbleIndex += 1;
    if (String(token.langUnitId ?? '') === langUnitId) {
      return bubbleIndex;
    }
  }

  return -1;
}

function getLangUnitItem(langUnitId) {
  return state.langUnitItems.find((item) => item?._id === langUnitId) ?? null;
}

function getLangUnitItemByText(text) {
  return state.langUnitItems.find((item) => String(item?.text ?? '') === text) ?? null;
}

function getLangUnitReferenceCount(langUnitId) {
  if (!langUnitId) {
    return 0;
  }

  const langUnit = getLangUnitItem(langUnitId);
  if (Array.isArray(langUnit?.refs) && langUnit.refs.length) {
    return langUnit.refs.length;
  }

  let count = 0;
  for (const subSegItem of state.subSegItems) {
    for (const token of Array.isArray(subSegItem?.content) ? subSegItem.content : []) {
      if (token?.type === 'langUnitRef' && String(token.langUnitId ?? '') === langUnitId) {
        count += 1;
      }
    }
  }

  return count;
}

function sanitizeSubSegMarkup(value) {
  if (typeof value !== 'string' || !value) {
    return '';
  }

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
      return escapeHtml(node.textContent ?? '');
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
      const dataAttr = langUnitId ? ` data-langunit-id="${escapeHtml(langUnitId)}"` : '';
      return `<span class="langunit-bubble"${dataAttr}>${bubbleContent}</span>`;
    }

    if (blockTags.has(node.tagName)) {
      const blockContent = serializeChildren(node.childNodes);
      return blockContent || '<br>';
    }

    return serializeChildren(node.childNodes);
  };

  return serializeChildren(template.content.childNodes);
}

function renderSubSegContentTokens(tokens) {
  if (!Array.isArray(tokens)) {
    return '';
  }

  return tokens
    .map((token) => {
      if (!token || typeof token !== 'object') {
        return '';
      }

      if (token.type === 'text') {
        return escapeHtml(String(token.text ?? '')).replaceAll('\n', '<br>');
      }

      if (token.type === 'langUnitRef') {
        const langUnitId = String(token.langUnitId ?? '').trim();
        const langUnit = getLangUnitItem(langUnitId);
        const text = String(langUnit?.text ?? token.text ?? '');
        const count = Math.max(1, getLangUnitReferenceCount(langUnitId));
        return `<span class="langunit-bubble"${langUnitId ? ` data-langunit-id="${escapeHtml(langUnitId)}"` : ''}${count > 1 ? ` data-langunit-count="${count}"` : ''}>${escapeHtml(text)}</span>`;
      }

      return '';
    })
    .join('');
}

function renderSubSegList(audSegItem) {
  const audSegId = audSegItem?._id || '';
  const subSegItem = getSubSegItemForAudSeg(audSegId);
  const value = subSegDraftTextByAudSegId.get(audSegId);
  const renderedContent = subSegItem?.content ? renderSubSegContentTokens(subSegItem.content) : '';
  const content = value ?? (renderedContent || sanitizeSubSegMarkup(subSegItem?.text ?? ''));
  return `
    <ul class="item__subsegs" aria-label="subSegs">
      <li class="item__subseg item__subseg--seed">
        <div
          class="item__subseg-input"
          aria-label="subSeg input"
          role="textbox"
          contenteditable="true"
          spellcheck="false"
          data-subseg-audseg-id="${escapeHtml(audSegId)}"
        >${content}</div>
      </li>
    </ul>
  `;
}

function renderLangUnitRefsList(audSegItem) {
  const audSegId = audSegItem?._id || '';
  const targetIndex = langUnitBubbleTargetIndexByAudSegId.get(audSegId);
  const subSegItem = getSubSegItemForAudSeg(audSegId);
  const payload = subSegDraftPayloadByAudSegId.get(audSegId);
  const tokens = Array.isArray(payload?.content) ? payload.content : Array.isArray(subSegItem?.content) ? subSegItem.content : [];
  let bubbleIndex = -1;
  let langUnitId = '';
  for (const token of tokens) {
    if (token?.type !== 'langUnitRef') {
      continue;
    }

    bubbleIndex += 1;
    if (bubbleIndex === targetIndex) {
      langUnitId = String(token.langUnitId ?? '').trim();
      break;
    }
  }

  const langUnit = getLangUnitItem(langUnitId);
  const subSegId = subSegItem?._id || '';
  const refs = Array.isArray(langUnit?.refs)
    ? langUnit.refs.filter((ref) => String(ref?.subSegId ?? '') !== subSegId)
    : [];

  if (!langUnitId || refs.length < 1 || (Array.isArray(langUnit?.refs) ? langUnit.refs.length : 0) < 2) {
    return '<ul class="item__langunit-refs" hidden></ul>';
  }

  const context = String(langUnit?.context ?? langUnit?.text ?? '').trim();
  const items = refs
    .map(
      (ref) => `
        <li class="item__langunit-ref" data-subseg-id="${escapeHtml(String(ref?.subSegId ?? ''))}" data-audseg-id="${escapeHtml(String(ref?.audSegId ?? ''))}" data-langunit-id="${escapeHtml(langUnitId)}">
          <span class="item__langunit-ref-context">${escapeHtml(getSubSegItemForAudSeg(String(ref?.audSegId ?? ''))?.text ?? context).replaceAll('\n', '<br>')}</span>
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

function isLangUnitContextBoundary(char) {
  return char === '\n' || char === '.' || char === '。' || char === '．' || char === '｡';
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

function extractSubSegEditorPayload(editor) {
  if (!(editor instanceof HTMLElement)) {
    return { content: [], langUnits: [] };
  }

  const content = [];
  const langUnitsById = new Map();
  let plainText = '';
  const appendContentText = (text) => {
    if (!text) {
      return;
    }

    const last = content[content.length - 1];
    if (last?.type === 'text') {
      last.text += text;
      return;
    }

    content.push({ type: 'text', text });
  };

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
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

    if (node.tagName === 'SPAN' && node.classList.contains('langunit-bubble')) {
      const bubbleText = node.textContent ?? '';
      let langUnitId = node.getAttribute('data-langunit-id') || '';
      if (!langUnitId) {
        langUnitId = createItemId();
        node.setAttribute('data-langunit-id', langUnitId);
      }

      const start = plainText.length;
      plainText += bubbleText;
      langUnitsById.set(langUnitId, {
        _id: langUnitId,
        text: bubbleText,
        start,
        end: plainText.length,
      });
      content.push({ type: 'langUnitRef', langUnitId });
      return;
    }

    for (const child of node.childNodes) {
      walk(child);
    }

    if (node.tagName === 'DIV' || node.tagName === 'P' || node.tagName === 'LI') {
      plainText += '\n';
      appendContentText('\n');
    }
  };

  for (const child of editor.childNodes) {
    walk(child);
  }

  while (content.length && content[content.length - 1]?.type === 'text') {
    const tail = content[content.length - 1];
    tail.text = tail.text.replace(/\n+$/g, '');
    if (tail.text) {
      break;
    }

    content.pop();
  }

  const langUnits = [...langUnitsById.values()].map(({ start, end, ...langUnit }) => ({
    ...langUnit,
    // ponytail: sentence boundary scan stays simple; newline and full-stop punctuation are enough here.
    context: getLangUnitBubbleContext(plainText, start, end),
  }));

  return {
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

  return editor.innerText.replace(/\u00a0/g, ' ');
}

function getSubSegEditorMarkup(editor) {
  if (!(editor instanceof HTMLElement)) {
    return '';
  }

  return sanitizeSubSegMarkup(editor.innerHTML);
}

function getLangUnitBubbles(editor) {
  if (!(editor instanceof HTMLElement)) {
    return [];
  }

  return [...editor.querySelectorAll('.langunit-bubble')];
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

  const audSegId = editor.dataset.subsegAudsegId || '';
  const bubbles = getLangUnitBubbles(editor);
  const targetIndex = langUnitBubbleTargetIndexByAudSegId.get(audSegId);

  bubbles.forEach((bubble) => bubble.classList.remove('is-targeted'));
  if (!bubbles.length) {
    langUnitBubbleTargetIndexByAudSegId.set(audSegId, -1);
    langUnitBubbleEscapeState.delete(audSegId);
    if (restoreCaret) {
      setCaretToEnd(editor);
    }
    return;
  }

  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= bubbles.length) {
    if (restoreCaret) {
      setCaretToEnd(editor);
    }
    syncLangUnitRefsLists();
    return;
  }

  bubbles[targetIndex].classList.add('is-targeted');
  syncLangUnitRefsLists();
}

function cycleLangUnitBubbleTarget(editor, step) {
  if (!(editor instanceof HTMLElement) || !step) {
    return false;
  }

  const audSegId = editor.dataset.subsegAudsegId || '';
  const bubbles = getLangUnitBubbles(editor);
  if (!bubbles.length) {
    return false;
  }

  const currentIndex = Number.isInteger(langUnitBubbleTargetIndexByAudSegId.get(audSegId))
    ? langUnitBubbleTargetIndexByAudSegId.get(audSegId)
    : -1;
  const slots = bubbles.length + 1;
  const nextIndex = ((currentIndex + 1 + step + slots) % slots) - 1;

  langUnitBubbleTargetIndexByAudSegId.set(audSegId, nextIndex);
  syncLangUnitBubbleTarget(editor, nextIndex === -1);
  return true;
}

function syncSubSegEditorDraft(editor) {
  if (!(editor instanceof HTMLElement)) {
    return;
  }

  const audSegId = editor.dataset.subsegAudsegId || '';
  const markup = getSubSegEditorMarkup(editor);
  const payload = extractSubSegEditorPayload(editor);
  subSegDraftTextByAudSegId.set(audSegId, markup);
  subSegDraftPayloadByAudSegId.set(audSegId, payload);
  autosizeSubSegInput(editor);
  scheduleSubSegSave(audSegId);
  void saveSubSeg(audSegId);
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
  const langUnit = getLangUnitItemByText(text);
  const langUnitId = langUnit?._id || createItemId();
  bubble.dataset.langunitId = langUnitId;
  bubble.dataset.langunitCount = String(Math.max(1, getLangUnitReferenceCount(langUnitId) + 1));
  bubble.append(range.extractContents());
  range.insertNode(bubble);

  const caret = document.createRange();
  caret.setStartAfter(bubble);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  syncSubSegEditorDraft(editor);
  return true;
}

function handleLangUnitBubbleSpace(editor) {
  const audSegId = editor.dataset.subsegAudsegId || '';
  const pending = langUnitBubbleEscapeState.get(audSegId);
  const now = Date.now();
  const boundary = getLangUnitBubbleBoundary(editor);
  const targetIndex = Number.isInteger(langUnitBubbleTargetIndexByAudSegId.get(audSegId))
    ? langUnitBubbleTargetIndexByAudSegId.get(audSegId)
    : -1;

  if (pending && now - pending.at < 250) {
    langUnitBubbleEscapeState.delete(audSegId);
    if (targetIndex >= 0) {
      langUnitBubbleTargetIndexByAudSegId.set(audSegId, -1);
      syncLangUnitBubbleTarget(editor, true);
    }
    return true;
  }

  if (!boundary) {
    if (targetIndex >= 0) {
      langUnitBubbleEscapeState.set(audSegId, { edge: 'end', at: now });
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
  langUnitBubbleEscapeState.set(audSegId, { edge: boundary.edge, at: now });
  syncSubSegEditorDraft(editor);
  return true;
}

function scheduleSubSegSave(audSegId) {
  if (!audSegId) {
    return;
  }

  const existing = subSegSaveTimers.get(audSegId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    subSegSaveTimers.delete(audSegId);
    void saveSubSeg(audSegId);
  }, 500);

  subSegSaveTimers.set(audSegId, timer);
}

function flushSubSegSave(audSegId) {
  const payload = subSegDraftPayloadByAudSegId.get(audSegId);
  if (!payload) {
    return;
  }

  const existing = subSegSaveTimers.get(audSegId);
  if (existing) {
    clearTimeout(existing);
    subSegSaveTimers.delete(audSegId);
  }

  const body = JSON.stringify({ audSegId, ...payload });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/subSegs/items', new Blob([body], { type: 'application/json' }));
    return;
  }

  void saveSubSeg(audSegId);
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

async function saveSubSeg(audSegId) {
  const payload = subSegDraftPayloadByAudSegId.get(audSegId);
  if (!payload) {
    return;
  }

  const knownLangUnitIds = new Set(state.langUnitItems.map((item) => item?._id).filter(Boolean));

  const response = await fetch('/api/subSegs/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audSegId, ...payload }),
  });

  if (!response.ok) {
    return;
  }

  const result = await response.json();
  const saved = result?.subSeg ?? result;
  subSegDraftTextByAudSegId.delete(audSegId);
  subSegDraftPayloadByAudSegId.delete(audSegId);
  if (Array.isArray(result?.langUnits)) {
    mergeLangUnitItems(result.langUnits);
  } else if (payload.langUnits?.length) {
    mergeLangUnitItems(payload.langUnits);
  }
  const inferredLangUnits = Array.isArray(result?.langUnits) ? result.langUnits : (payload.langUnits ?? []);
  for (const langUnit of inferredLangUnits) {
    if (langUnit?._id && !knownLangUnitIds.has(langUnit._id)) {
      void inferLangUnitRoot(langUnit);
    }
  }
  state.subSegItems = saved
    ? [saved, ...state.subSegItems.filter((item) => item?.audSegId !== audSegId)]
    : state.subSegItems.filter((item) => item?.audSegId !== audSegId);
  syncLangUnitRefsLists();
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

function syncSettingsPopover() {
  if (!settingsButton || !settingsPopover) {
    return;
  }

  settingsButton.setAttribute('aria-expanded', String(settingsOpen));
  settingsPopover.hidden = !settingsOpen;
  if (settingsPopoverCheckbox instanceof HTMLInputElement) {
    settingsPopoverCheckbox.checked = codexWordRootInferenceEnabled;
  }
}

function toggleSettingsPopover(forceOpen) {
  settingsOpen = typeof forceOpen === 'boolean' ? forceOpen : !settingsOpen;
  syncSettingsPopover();
}

function showWorkerToast(message) {
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
  }, 1800);
}

async function refreshCodexWorkerStatus() {
  if (!codexWordRootInferenceEnabled) {
    return;
  }

  const response = await fetch('/api/codex-worker/status');
  if (!response.ok) {
    return;
  }

  const status = await response.json();
  if (status?.primeComplete) {
    showWorkerToast('test prime complete');
  }
}

function setCodexWordRootInferenceEnabled(enabled) {
  codexWordRootInferenceEnabled = Boolean(enabled);
  localStorage.setItem('codex-word-root-inference-enabled', codexWordRootInferenceEnabled ? '1' : '0');
  syncSettingsPopover();
  showWorkerToast(codexWordRootInferenceEnabled ? 'on detected' : 'off detected');
  if (codexWordRootInferenceEnabled) {
    void refreshCodexWorkerStatus();
  }
}

async function inferLangUnitRoot(langUnit) {
  if (!codexWordRootInferenceEnabled || !(langUnit?._id)) {
    return;
  }

  if (!/^[A-Za-z]+$/.test(String(langUnit.text ?? '').trim())) {
    return;
  }

  const response = await fetch(`/api/langUnits/items/${encodeURIComponent(langUnit._id)}/root`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: String(langUnit.context ?? ''),
      target: String(langUnit.text ?? ''),
      substring: String(langUnit.text ?? ''),
    }),
  });

  if (!response.ok) {
    return;
  }

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
    const langUnitBubbleTargetActive = langUnitBubbleTargetIndexByAudSegId.get(audSegId) ?? -1;

    if (event.key === 'Enter') {
      if (editor && langUnitBubbleTargetActive >= 0) {
        event.preventDefault();
        return;
      }

      if (editor && wrapSelectedSubSegText(editor)) {
        event.preventDefault();
      }
      return;
    }

    if (isSpaceKey(event) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (editor && handleLangUnitBubbleSpace(editor)) {
        event.preventDefault();
        return;
      }

      if (editor && langUnitBubbleTargetActive >= 0) {
        event.preventDefault();
      }
      return;
    }

    if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      if (editor && cycleLangUnitBubbleTarget(editor, event.key === 'ArrowRight' ? 1 : -1)) {
        event.preventDefault();
      }
      return;
    }

    if (isCtrlModifierActive(event) && !event.metaKey && !event.altKey && !event.shiftKey && event.key === 'Backspace') {
      if (editor && langUnitBubbleTargetIndexByAudSegId.get(editor.dataset.subsegAudsegId || '') !== -1) {
        langUnitBubbleTargetIndexByAudSegId.set(editor.dataset.subsegAudsegId || '', -1);
        syncLangUnitBubbleTarget(editor, true);
        event.preventDefault();
        return;
      }
      event.preventDefault();
      closeEnteredAudSeg();
      return;
    }

    if (isCtrlPlaybackToggle(event)) {
      event.preventDefault();
      toggleSelectedAudEpPlayback();
      return;
    }

    if (editor && langUnitBubbleTargetActive >= 0) {
      event.preventDefault();
      return;
    }
    return;
  }

  if (state.deleteDialogIndex >= 0) {
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
  const input = event.target instanceof Element ? event.target.closest('.item__subseg-input') : null;
  if (!(input instanceof HTMLElement)) {
    return;
  }

  syncSubSegEditorDraft(input);
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

settingsButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleSettingsPopover();
});

settingsPopoverCheckbox?.addEventListener('change', () => {
  setCodexWordRootInferenceEnabled(settingsPopoverCheckbox.checked);
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.settings-shell')) {
    return;
  }

  toggleSettingsPopover(false);
});

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

syncSettingsPopover();
if (codexWordRootInferenceEnabled) {
  void refreshCodexWorkerStatus();
}
reloadAudData();
