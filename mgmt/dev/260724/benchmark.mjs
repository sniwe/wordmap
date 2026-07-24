import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const models = process.argv.slice(2).length ? process.argv.slice(2) : ['gpt-5.4-mini', 'gpt-5.6-luna'];
const effort = process.env.BENCH_EFFORT || 'medium';
const payloads = [
  ['消息被传播后，大家都知道了', '消息', '消息'],
  ['他不是文明人说的那样', '文明人', '文明人'],
  ['你好吗世界', '你好', '你好'],
  ['操你妈是什么意思', '操你妈', '操你妈'],
  ['这个办法很有效', '办法', '办法'],
  ['我们明天再讨论这个问题', '讨论', '讨论'],
  ['天气预报说明天会下雨', '天气预报', '天气预报'],
  ['请把门打开让我进去', '打开', '打开'],
  ['这本书的内容非常有趣', '内容', '内容'],
  ['她正在学习新的语言', '学习', '学习'],
  ['我们需要解决这个困难', '解决', '解决'],
  ['孩子们在公园里玩耍', '孩子们', '孩子们'],
  ['这家餐厅的服务很好', '餐厅', '餐厅'],
  ['他昨天买了一部手机', '手机', '手机'],
  ['请不要忘记关灯', '忘记', '忘记'],
  ['他们已经完成了工作', '完成', '完成'],
  ['我想知道你的想法', '想法', '想法'],
  ['这个城市有很多历史建筑', '历史建筑', '历史建筑'],
  ['我们一起去看电影吧', '看电影', '看电影'],
  ['她把问题解释得很清楚', '解释', '解释'],
].map(([context, target, substring]) => ({ task: 'contextType', context, target, substring }));

const codexBin = process.platform === 'win32' ? 'codex.cmd' : 'codex';
let nextId = 1;

function promptFor({ context, target, substring }) {
  return [
    'You are the discern-languageUnit-chinese-types worker.',
    'Read context, target, and substring.',
    'Classify contextType for the full bounded context.',
    'Classify targetType for the selected target substring.',
    'Use chinWord when the text is one lexical entry.',
    'Use chinPhrase when the text is a sentence, clause, greeting plus object, verb-object insult, or several lexical entries together.',
    'Return only a JSON object with the shape {"res":{"contextType":"chinPhrase","targetType":"chinWord"}}.',
    '',
    `context: ${context}`,
    `target: ${target}`,
    `substring: ${substring}`,
  ].join('\n');
}

function startServer(model) {
  const command = process.platform === 'win32' ? 'cmd.exe' : codexBin;
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', codexBin, 'app-server', '--listen', 'stdio://'] : ['app-server', '--listen', 'stdio://'];
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = '';
  const events = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    for (;;) {
      const end = buffer.indexOf('\n');
      if (end < 0) break;
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line) {
        try { events.push(JSON.parse(line)); } catch {}
      }
    }
  });
  child.stderr.on('data', () => {});
  const waitFor = (predicate, timeout = 120000) => new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(() => {
      const index = events.findIndex(predicate);
      if (index >= 0) {
        clearInterval(timer);
        resolve(events.splice(index, 1)[0]);
      } else if (performance.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for app-server event for ${model}.`));
      }
    }, 5);
  });
  const send = (method, params, id = nextId++) => {
    child.stdin.write(`${JSON.stringify({ method, params, ...(id == null ? {} : { id }) })}\n`);
    return id;
  };
  return { child, waitFor, send };
}

async function oneTrial(model, includeRequests) {
  const server = startServer(model);
  const start = performance.now();
  const initId = server.send('initialize', { clientInfo: { name: 'benchmark', title: 'benchmark', version: '1' } });
  await server.waitFor((event) => event.id === initId);
  server.send('initialized', {}, null);
  const threadIdRequest = server.send('thread/start', { serviceName: 'benchmark', model, cwd: process.cwd(), approvalPolicy: 'never', sandbox: 'workspace-write' });
  const threadResult = await server.waitFor((event) => event.id === threadIdRequest);
  const threadId = threadResult.result?.thread?.id ?? threadResult.result?.threadId;
  const readyMs = performance.now() - start;
  const requests = [];
  const turn = async (payload) => {
    const turnStart = performance.now();
    const turnIdRequest = server.send('turn/start', {
      threadId,
      model,
      effort,
      input: [{ type: 'text', text: promptFor(payload) }],
      cwd: process.cwd(),
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
      outputSchema: { type: 'object', properties: { res: { type: 'object', properties: { contextType: { type: 'string' }, targetType: { type: 'string' } }, required: ['contextType', 'targetType'], additionalProperties: false } }, required: ['res'], additionalProperties: false },
    });
    const turnStarted = await server.waitFor((event) => event.id === turnIdRequest);
    const actualTurnId = turnStarted.result?.turn?.id;
    await server.waitFor((event) => event.method === 'item/completed' && event.params?.item?.type === 'agentMessage');
    return performance.now() - turnStart;
  };
  if (includeRequests) {
    await turn({ context: '你好世界', target: '你好', substring: '你好' });
    for (const payload of payloads) requests.push({ payload, ms: await turn(payload) });
  }
  server.child.stdin.end();
  await new Promise((resolve) => server.child.once('exit', resolve));
  return { model, readyMs, requests };
}

const results = [];
for (const model of models) {
  for (let trial = 1; trial <= 20; trial += 1) results.push({ trial, ...(await oneTrial(model, false)) });
  results.push({ trial: 1, ...(await oneTrial(model, true)) });
}
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), cli: 'codex-cli 0.145.0', effort, payloads, results }, null, 2));
