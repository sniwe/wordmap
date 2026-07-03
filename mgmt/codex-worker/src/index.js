import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { buildPrompt, normalizeLanguageUnitRoot, normalizeRequest, parseEnvelope } from './core.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(moduleDir, '..');
const codexWorkspaceDir = join(process.env.TEMP || process.env.TMP || workerDir, 'codex-worker-runtime');
const requestTimeoutMs = Number(process.env.CODEX_WORKER_REQUEST_TIMEOUT_MS || 240000);
const codexModel = 'gpt-5.4-mini';
const codexEffort = 'low';
const startupProbe = 'test';
const streamedMode = process.env.CODEX_WORKER_STREAMED === '1';

let queue = Promise.resolve();
let codexBinary = null;
let codexServer = null;
let codexServerOutput = null;
let codexServerReady = null;
let nextMessageId = 1;
let threadId = null;
let startupProbeDone = false;
const pendingRequests = new Map();
const pendingTurns = new Map();
let shutdownRequested = false;

function log(message) {
  process.stderr.write(`[codex-worker] ${message}\n`);
}

function resolveCodexBinary() {
  if (codexBinary) return codexBinary;

  if (process.env.CODEX_BIN) {
    codexBinary = process.env.CODEX_BIN;
    return codexBinary;
  }

  if (process.platform === 'win32' && process.env.APPDATA) {
    codexBinary = join(process.env.APPDATA, 'npm', 'codex.cmd');
    return codexBinary;
  }

  codexBinary = 'codex';
  return codexBinary;
}

function parseArgv(argv) {
  if (argv.length === 0) return null;
  if (argv[0] === '--file') {
    if (!argv[1]) throw new Error('--file requires a path.');
    return { file: argv[1] };
  }
  if (argv[0] === '--demo') {
    return {
      context: 'demo context',
      target: 'demo target',
      substring: 'demo substring',
    };
  }
  if (argv[0] === '--payload') {
    if (!argv[1]) throw new Error('--payload requires a JSON string.');
    return JSON.parse(argv[1]);
  }
  return JSON.parse(argv.join(' '));
}

async function readRequestFromSource(source) {
  if (source?.file) {
    return JSON.parse(await readFile(source.file, 'utf8'));
  }
  return source;
}

async function readStdinText() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function parseManyPayloads(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('stdin JSON array must contain request objects.');
    return parsed.map(normalizeRequest);
  }

  if (trimmed.includes('\n')) {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => normalizeRequest(JSON.parse(line)));
  }

  return [normalizeRequest(JSON.parse(trimmed))];
}

function nextId() {
  return nextMessageId++;
}

function sendRpc(message) {
  if (!codexServer?.stdin.writable) {
    throw new Error('Codex app-server is not running.');
  }

  codexServer.stdin.write(`${JSON.stringify(message)}\n`);
}

function spawnCodex(args) {
  const codexBin = resolveCodexBinary();
  return process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', [codexBin, ...args].join(' ')], {
        cwd: workerDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    : spawn(codexBin, args, {
        cwd: workerDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
}

function getPendingRequest(id) {
  const pending = pendingRequests.get(id);
  if (!pending) {
    return null;
  }

  pendingRequests.delete(id);
  clearTimeout(pending.timer);
  return pending;
}

function handleServerMessage(message) {
  if (message?.id != null) {
    const pending = getPendingRequest(message.id);
    if (pending) {
      if (message.error) {
        pending.reject(new Error(message.error.message || 'Codex request failed.'));
        return;
      }

      pending.resolve(message);
    }
    return;
  }

  const method = message?.method;
  const params = message?.params ?? {};
  if (method === 'thread/started' && params.thread?.id) {
    threadId = params.thread.id;
    return;
  }

  if (method === 'item/completed' && params.item?.type === 'agentMessage') {
    const pendingTurn = pendingTurns.values().next().value;
    if (pendingTurn) {
      pendingTurn.finalText = String(params.item.text ?? '');
      clearTimeout(pendingTurn.timer);
      pendingTurns.clear();
      pendingTurn.resolve(pendingTurn.finalText);
    }
    return;
  }

  if (method === 'turn/completed' && params.turn?.status === 'failed') {
    const pendingTurn = pendingTurns.values().next().value;
    if (!pendingTurn) {
      return;
    }

    clearTimeout(pendingTurn.timer);
    pendingTurns.clear();
    pendingTurn.reject(new Error('Codex turn failed.'));
  }
}

async function startCodexServer() {
  if (codexServerReady) {
    return codexServerReady;
  }

  await mkdir(codexWorkspaceDir, { recursive: true });
  codexServer = spawnCodex(['app-server', '--listen', 'stdio://']);

  codexServerOutput = createInterface({ input: codexServer.stdout });
  codexServer.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });
  codexServer.on('exit', () => {
    codexServer = null;
    codexServerReady = null;
    codexServerOutput?.close();
    codexServerOutput = null;
    threadId = null;
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Codex app-server exited.'));
    }
    pendingRequests.clear();
    for (const pending of pendingTurns.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Codex app-server exited.'));
    }
    pendingTurns.clear();
  });
  codexServerOutput.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      handleServerMessage(JSON.parse(trimmed));
    } catch (error) {
      log(error.message);
    }
  });

  codexServerReady = (async () => {
    const initializeId = nextId();
    const initializeResult = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingRequests.has(initializeId)) {
          pendingRequests.delete(initializeId);
          reject(new Error(`Codex init timed out after ${requestTimeoutMs}ms.`));
        }
      }, requestTimeoutMs);
      pendingRequests.set(initializeId, { resolve, reject, timer });
      sendRpc({
        method: 'initialize',
        id: initializeId,
        params: {
          clientInfo: {
            name: 'codex-worker',
            title: 'Codex Worker',
            version: '1.0.0',
          },
        },
      });
    });

    if (initializeResult.error) {
      throw new Error(initializeResult.error.message || 'Codex init failed.');
    }

    sendRpc({ method: 'initialized', params: {} });

    const startId = nextId();
    const startResult = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingRequests.has(startId)) {
          pendingRequests.delete(startId);
          reject(new Error(`Thread start timed out after ${requestTimeoutMs}ms.`));
        }
      }, requestTimeoutMs);
      pendingRequests.set(startId, { resolve, reject, timer });
      sendRpc({
        method: 'thread/start',
        id: startId,
        params: {
          serviceName: 'codex-worker',
          model: codexModel,
          cwd: codexWorkspaceDir,
          approvalPolicy: 'never',
          sandbox: 'workspace-write',
        },
      });
    });

    threadId = startResult.result?.thread?.id ?? startResult.result?.threadId ?? null;
    if (!threadId) {
      throw new Error('Codex thread did not return an id.');
    }
  })();

  return codexServerReady;
}

async function ensureCodexServer() {
  await startCodexServer();
  if (!threadId) {
    throw new Error('Codex thread was not initialized.');
  }
  await runStartupProbe();
}

async function shutdownCodexServer() {
  if (!codexServer || shutdownRequested) {
    return;
  }

  shutdownRequested = true;
  const child = codexServer;
  codexServer = null;
  codexServerReady = null;
  codexServerOutput?.close();
  codexServerOutput = null;
  child.stdin.end();
  await new Promise((resolve) => {
    child.once('exit', resolve);
    setTimeout(() => {
      child.kill();
      resolve();
    }, 5000);
  });
}

async function runTurn(prompt, parseResult = true) {
  let completionResolve = null;
  let completionReject = null;
  const completion = new Promise((resolve, reject) => {
    completionResolve = resolve;
    completionReject = reject;
  });

  await new Promise((resolve, reject) => {
    const turnRequestId = nextId();
    const timer = setTimeout(() => {
      if (pendingRequests.has(turnRequestId)) {
        pendingRequests.delete(turnRequestId);
        reject(new Error(`Turn start timed out after ${requestTimeoutMs}ms.`));
      }
    }, requestTimeoutMs);
    pendingRequests.set(turnRequestId, {
      resolve: (message) => {
        const id = message.result?.turn?.id ?? null;
        if (!id) {
          reject(new Error('Codex turn did not return an id.'));
          return;
        }

        const timer = setTimeout(() => {
          if (pendingTurns.has(id)) {
            pendingTurns.delete(id);
            completionReject?.(new Error(`Turn completed timed out after ${requestTimeoutMs}ms.`));
          }
        }, requestTimeoutMs);

        pendingTurns.set(id, {
          resolve: completionResolve,
          reject: completionReject,
          finalText: '',
          timer,
        });
        resolve(id);
      },
      reject,
      timer,
    });

    sendRpc({
      method: 'turn/start',
      id: turnRequestId,
      params: {
        threadId,
        model: codexModel,
        effort: codexEffort,
        input: [
          {
            type: 'text',
            text: prompt,
          },
        ],
        cwd: codexWorkspaceDir,
        approvalPolicy: 'never',
        sandboxPolicy: {
          type: 'dangerFullAccess',
        },
        outputSchema: {
          type: 'object',
          properties: {
            res: { type: 'string' },
          },
          required: ['res'],
          additionalProperties: false,
        },
      },
    });
  });

  const finalText = await completion;
  return parseResult ? parseEnvelope(finalText) : finalText;
}

async function runStartupProbe() {
  if (startupProbeDone) {
    return;
  }

  await runTurn(startupProbe, false);
  startupProbeDone = true;
}

async function resolveRequest(payload) {
  const request = normalizeRequest(payload);
  const prompt = buildPrompt(request);
  await ensureCodexServer();

  const envelope = await runTurn(prompt);
  return { res: normalizeLanguageUnitRoot(request, envelope.res) };
}

async function handleRequest(payload) {
  const envelope = await resolveRequest(payload);
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

function enqueue(payload) {
  const job = queue.then(() => handleRequest(payload));
  queue = job.then(() => undefined, () => undefined);
  return job.catch((error) => {
    log(error.message);
    if (error.stdout) {
      log('stdout:');
      process.stderr.write(`${error.stdout}\n`);
    }
    if (error.stderr) {
      log('stderr:');
      process.stderr.write(`${error.stderr}\n`);
    }
    throw error;
  });
}

async function runOneShot(payload, closeServer = true) {
  try {
    await enqueue(payload);
  } catch {
    process.exitCode = 1;
  } finally {
    if (closeServer) {
      await shutdownCodexServer();
    }
  }
}

async function runInteractive(terminal = true) {
  log('ready');
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal });
  let closed = false;
  const promptIfOpen = () => {
    if (terminal && !closed) {
      rl.prompt();
    }
  };
  if (terminal) {
    rl.setPrompt('codex-worker> ');
    rl.prompt();
  }

  rl.on('close', () => {
    closed = true;
    void queue.then(() => shutdownCodexServer());
  });

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) {
      promptIfOpen();
      return;
    }

    try {
      const payload = JSON.parse(text);
      enqueue(payload).finally(promptIfOpen);
    } catch (error) {
      log(error.message);
      promptIfOpen();
    }
  });
}

async function main() {
  const argv = process.argv.slice(2);
  log('startup');
  const isTerminal = Boolean(process.stdin.isTTY);

  if (argv.length > 0) {
    const payload = await readRequestFromSource(parseArgv(argv));
    await runOneShot(payload);
    return;
  }

  if (!isTerminal && !streamedMode) {
    const text = await readStdinText();
    const payloads = parseManyPayloads(text);
    if (payloads.length === 0) {
      throw new Error('No request payload provided.');
    }
    for (const payload of payloads) {
      await runOneShot(payload, false);
    }
    await shutdownCodexServer();
    return;
  }

  await ensureCodexServer();
  await runInteractive(isTerminal);
}

main().catch((error) => {
  log(error.message);
  if (error.stdout) {
    log('stdout:');
    process.stderr.write(`${error.stdout}\n`);
  }
  if (error.stderr) {
    log('stderr:');
    process.stderr.write(`${error.stderr}\n`);
  }
  process.exitCode = 1;
});
