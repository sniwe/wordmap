export function normalizeRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request must be a JSON object.');
  }

  const request = {
    context: value.context,
    target: value.target,
    substring: value.substring,
  };

  for (const [key, field] of Object.entries(request)) {
    if (typeof field !== 'string' || field.length === 0) {
      throw new Error(`Request field "${key}" must be a non-empty string.`);
    }
  }

  return request;
}

export function buildPrompt(request) {
  const { context, target, substring } = normalizeRequest(request);

  return [
    'You are the discern-languageUnit-root worker.',
    'Read context, target, and substring.',
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
  const target = String(request?.target ?? '').trim();
  const value = String(result ?? target).trim();
  if (!value) {
    return value;
  }

  const lower = value.toLowerCase();
  if (lower.length > 4 && lower.endsWith('iest')) {
    return `${value.slice(0, -4)}y`;
  }

  if (lower.length > 3 && lower.endsWith('est')) {
    return value.slice(0, -3);
  }

  if (lower.length > 3 && lower.endsWith('ied')) {
    return `${value.slice(0, -3)}y`;
  }

  if (lower.length > 2 && lower.endsWith('ed')) {
    return value.slice(0, -2);
  }

  return value;
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
