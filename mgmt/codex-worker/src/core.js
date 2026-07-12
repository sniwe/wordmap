const ROOT_TASK = 'root';
const CONTEXT_TYPE_TASK = 'contextType';
const CONTEXT_TYPE_VALUES = new Set(['chinWord', 'chinPhrase']);

function normalizeTask(task) {
  return task === CONTEXT_TYPE_TASK ? CONTEXT_TYPE_TASK : ROOT_TASK;
}

export function normalizeRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request must be a JSON object.');
  }

  const request = {
    task: value.task,
    context: value.context,
    target: value.target,
    substring: value.substring,
  };

  request.task = normalizeTask(request.task);

  for (const [key, field] of Object.entries(request)) {
    if (key === 'task') {
      continue;
    }

    if (typeof field !== 'string' || field.length === 0) {
      throw new Error(`Request field "${key}" must be a non-empty string.`);
    }
  }

  return request;
}

export function buildPrompt(request) {
  const { task, context, target, substring } = normalizeRequest(request);

  if (task === CONTEXT_TYPE_TASK) {
    return [
      'You are the discern-languageUnit-context-type worker.',
      'Read context, target, and substring.',
      'Decide whether the Chinese context should be tagged as chinWord or chinPhrase.',
      'Use chinWord for a single Chinese lexical unit.',
      'Use chinPhrase for a multiword phrase, compound, or broader phrase context.',
      'Return only a JSON object with the shape {"res":"chinWord"} or {"res":"chinPhrase"}.',
      '',
      `context: ${context}`,
      `target: ${target}`,
      `substring: ${substring}`,
    ].join('\n');
  }

  return [
    'You are the discern-languageUnit-root worker.',
    'Read context, target, and substring.',
    'Infer the base English word directly from the target and substring.',
    'Prefer the plain root over comparative, superlative, plural, tense, or participle forms.',
    'Examples: newest -> new; published -> publish; faggiest -> fag.',
    'Resolve the final langUnitRoot only.',
    'Return only a JSON object with the shape {"res":"..."}.',
    '',
    `context: ${context}`,
    `target: ${target}`,
    `substring: ${substring}`,
  ].join('\n');
}

export function parseEnvelope(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Codex response was empty.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new Error(`Codex response was not valid JSON: ${text}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Codex response must be a JSON object.');
  }

  if (typeof parsed.res !== 'string' || parsed.res.length === 0) {
    throw new Error('Codex response must contain a non-empty string "res".');
  }

  return { res: parsed.res };
}

export function parseFinalEnvelope(text) {
  if (typeof text !== 'string') {
    throw new Error('Codex response was empty.');
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error('Codex response was empty.');
  }

  try {
    return parseEnvelope(trimmed);
  } catch {
    return { res: trimmed };
  }
}

export function normalizeLanguageUnitRoot(request, result) {
  return String(result ?? request?.target ?? '').trim();
}

export function normalizeLanguageUnitContextType(request, result) {
  const value = String(result ?? '').trim();
  if (CONTEXT_TYPE_VALUES.has(value)) {
    return value;
  }

  return request?.context?.type === 'chinWord' ? 'chinWord' : 'chinPhrase';
}

export function parseCodexJsonl(stdout) {
  let threadId = null;
  let finalText = null;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      threadId = event.thread_id;
    }

    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      if (typeof event.item.text === 'string') {
        finalText = event.item.text;
      }
    }
  }

  return { threadId, finalText };
}
