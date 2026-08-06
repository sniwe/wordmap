import fs from 'node:fs';
import readline from 'node:readline';

const slot = process.env.CODEX_WORKER_SLOT || 'unknown';
const failFile = process.env.CODEX_WORKER_FAIL_FILE;
const failSlots = new Set(String(process.env.CODEX_WORKER_FAIL_SLOTS || '').split(',').map((value) => value.trim()).filter(Boolean));
process.stderr.write('[codex-worker] ready\n');

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return;
  }
  const slotFailFile = failFile ? `${failFile}-${slot}` : '';
  if (failSlots.has(slot) && slotFailFile && !fs.existsSync(slotFailFile)) {
    fs.writeFileSync(slotFailFile, 'failed\n');
    process.exit(17);
  }
  process.stdout.write(`${JSON.stringify({ res: payload.task === 'contextType'
    ? { contextType: 'chinPhrase', targetType: 'chinFuzz' }
    : `fake-root-${slot}` })}\n`);
});
