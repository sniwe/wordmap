const ROOT_TASK = 'root';
const CONTEXT_TYPE_TASK = 'contextType';
const CONTEXT_TYPE_VALUES = new Set(['chinWord', 'chinPhrase']);
const KNOWN_CHIN_WORDS = new Set(['\u8349\u6ce5\u9a6c', '\u6587\u660e\u4eba', '\u4f60\u597d', '\u4e16\u754c']);
const KNOWN_CHIN_PHRASES = new Set(['\u64cd\u4f60\u5988', '\u4f60\u597d\u4e16\u754c']);

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
      'You are the discern-languageUnit-chinese-types worker.',
      'Read context, target, and substring.',
      'Classify contextType for the full bounded context.',
      'Classify targetType for the selected target substring.',
      'Use chinWord when the text is one lexical entry.',
      'Use chinPhrase when the text is a sentence, clause, greeting plus object, verb-object insult, or several lexical entries together.',
      'Examples:',
      'context cao-ni-ma-shi-yi-zhong-ma-ma, target cao-ni-ma -> {"contextType":"chinPhrase","targetType":"chinWord"}',
      'context cao-ni-ma-bu-shi-wen-ming-ren-shuo-de, target wen-ming-ren -> {"contextType":"chinPhrase","targetType":"chinWord"}',
      'context cao-ni-ma-bu-shi-wen-ming-ren-shuo-de, target cao-ni-ma profanity -> {"contextType":"chinPhrase","targetType":"chinPhrase"}',
      'target ni-hao-shi-jie -> {"contextType":"chinPhrase","targetType":"chinPhrase"}',
      'target ni-hao -> {"targetType":"chinWord"}',
      'target shi-jie -> {"targetType":"chinWord"}',
      'Return only a JSON object with the shape {"res":{"contextType":"chinPhrase","targetType":"chinWord"}}.',
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

  if (typeof parsed.res !== 'string' && (!parsed.res || typeof parsed.res !== 'object' || Array.isArray(parsed.res))) {
    throw new Error('Codex response must contain a non-empty string or object "res".');
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

function normalizeChineseType(value) {
  const type = String(value ?? '').trim();
  return CONTEXT_TYPE_VALUES.has(type) ? type : '';
}

function inferChineseContextType(text) {
  const count = String(text ?? '').match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
  return count > 2 ? 'chinPhrase' : 'chinWord';
}

export function classifyKnownChineseTypes(request) {
  const context = String(request?.context ?? '').trim();
  const target = String(request?.target ?? request?.substring ?? '').trim();
  const contextType = inferChineseContextType(context || target);
  if (KNOWN_CHIN_WORDS.has(target)) {
    return { contextType, targetType: 'chinWord' };
  }

  if (KNOWN_CHIN_PHRASES.has(target)) {
    return { contextType, targetType: 'chinPhrase' };
  }

  return null;
}

export function classifyKnownChineseContextType(request) {
  return classifyKnownChineseTypes(request)?.targetType ?? '';
}

export function normalizeLanguageUnitChineseTypes(request, result) {
  const known = classifyKnownChineseTypes(request);
  if (known) {
    return known;
  }

  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return {
      contextType: normalizeChineseType(result.contextType) || inferChineseContextType(request?.context ?? request?.target),
      targetType: normalizeChineseType(result.targetType) || normalizeChineseType(result.res) || inferChineseContextType(request?.target),
    };
  }

  return {
    contextType: inferChineseContextType(request?.context ?? request?.target),
    targetType: normalizeChineseType(result) || inferChineseContextType(request?.target),
  };
}

export function normalizeLanguageUnitContextType(request, result) {
  return normalizeLanguageUnitChineseTypes(request, result).targetType;
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
