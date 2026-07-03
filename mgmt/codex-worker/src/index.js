import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { unlink } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { buildPrompt, normalizeRequest, parseCodexJsonl, parseEnvelope } from './core.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const workerDir = resolve(moduleDir, '..');
const schemaPath = join(moduleDir, 'response.schema.json');
const lastMessagePath = join(moduleDir, '.codex-last-message.txt');
const requestTimeoutMs = Number(process.env.CODEX_WORKER_REQUEST_TIMEOUT_MS || 240000);
const startupProbe = 'test';

let sessionId = process.env.CODEX_WORKER_SESSION_ID || null;
let queue = Promise.resolve();
let codexBinary = null;

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

async function runCodex(prompt, resume = false) {
  log(resume && sessionId ? `resume ${sessionId}` : 'fresh thread');
  const args = [
    'exec',
    ...(resume ? ['resume'] : []),
    ...(resume ? ['--all'] : []),
    '--json',
    '--dangerously-bypass-approvals-and-sandbox',
    '--skip-git-repo-check',
    '--output-schema',
    schemaPath,
    '--output-last-message',
    lastMessagePath,
  ];

  if (!resume) {
    args.push('--cd', workerDir);
  }
  if (resume && sessionId) {
    args.push(sessionId);
  }

  const codexBin = resolveCodexBinary();
  const child = process.platform === 'win32'
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
  const stdout = [];
  const stderr = [];

  const started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Codex request timed out after ${requestTimeoutMs}ms.`));
    }, requestTimeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ code, signal });
        return;
      }
      reject(new Error(`Codex exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}.`));
    });
  });

  child.stdout.on('data', (chunk) => {
    stdout.push(chunk.toString('utf8'));
  });

  child.stderr.on('data', (chunk) => {
    stderr.push(chunk.toString('utf8'));
  });

  child.stdin.end(prompt);

  await started.catch((error) => {
    error.stdout = stdout.join('');
    error.stderr = stderr.join('');
    throw error;
  });

  let finalText = '';
  try {
    finalText = await readFile(lastMessagePath, 'utf8');
  } catch {
    finalText = stdout.join('');
  } finally {
    await unlink(lastMessagePath).catch(() => {});
  }

  return { stdout: stdout.join(''), stderr: stderr.join(''), finalText };
}

async function resolveRequest(payload) {
  const request = normalizeRequest(payload);
  const prompt = buildPrompt(request);
  const firstAttempt = sessionId
    ? await runCodex(prompt, true).catch(async (error) => {
        sessionId = null;
        log(`resume failed, starting fresh session: ${error.message}`);
        return runCodex(prompt, false);
      })
    : await runCodex(prompt, false);

  const parsed = parseCodexJsonl(firstAttempt.stdout);
  if (parsed.threadId) {
    sessionId = parsed.threadId;
  }

  return parseEnvelope(parsed.finalText || firstAttempt.finalText || '');
}

async function warmupInteractiveWorker() {
  log(`startup probe: ${startupProbe}`);
  const result = await runCodex(startupProbe, false);
  const parsed = parseCodexJsonl(result.stdout);
  if (parsed.threadId) {
    sessionId = parsed.threadId;
  }
  log('startup probe complete');
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

async function runOneShot(payload) {
  try {
    await enqueue(payload);
  } catch {
    process.exitCode = 1;
  }
}

async function runInteractive() {
  log('ready');
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  rl.setPrompt('codex-worker> ');
  rl.prompt();

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }

    try {
      const payload = JSON.parse(text);
      enqueue(payload).finally(() => rl.prompt());
    } catch (error) {
      log(error.message);
      rl.prompt();
    }
  });
}

async function main() {
  const argv = process.argv.slice(2);
  log('startup');

  if (argv.length > 0) {
    const payload = await readRequestFromSource(parseArgv(argv));
    await runOneShot(payload);
    return;
  }

  if (!process.stdin.isTTY) {
    const text = await readStdinText();
    const payloads = parseManyPayloads(text);
    if (payloads.length === 0) {
      throw new Error('No request payload provided.');
    }
    for (const payload of payloads) {
      await runOneShot(payload);
    }
    return;
  }

  await warmupInteractiveWorker();
  await runInteractive();
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
