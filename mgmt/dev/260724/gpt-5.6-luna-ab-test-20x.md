# Codex CLI model A/B test — 20× run — 2026-07-24

## Result

Across 20 cold startups and 20 generated Chinese disambiguation requests per model, `gpt-5.6-luna` at medium effort was faster than the deployed `gpt-5.4-mini` low-effort worker baseline:

- Startup-to-ready median: **5,351.2 ms vs 5,353.8 ms**, Luna **2.7 ms / 0.05% faster**.
- Request-processing median: **1,760.6 ms vs 1,874.9 ms**, Luna **114.3 ms / 6.1% faster**.

## Test setup

- CLI: `codex-cli 0.145.0`
- Baseline: `gpt-5.4-mini`, low effort, matching `mgmt/codex-worker/src/index.js`
- Candidate: `gpt-5.6-luna`, medium effort
- Startup trials: 20 fresh `codex app-server --listen stdio://` processes per model
- Request trials: 20 payloads per model on one persistent initialized thread
- Startup measurement: process launch through `thread/start` response
- Request measurement: `turn/start` submission through completed agent message
- Both used the same prompt shape, output schema, cwd, approval policy, and sandbox policy
- No collection data or edit-note records were changed

## Measurements

| Metric | `gpt-5.4-mini` low | `gpt-5.6-luna` medium | Luna delta |
|---|---:|---:|---:|
| Startup median | 5,353.8 ms | 5,351.2 ms | −2.7 ms / −0.05% |
| Startup mean | 5,357.1 ms | 5,352.2 ms | −4.9 ms / −0.09% |
| Startup range | 5,334.0–5,460.1 ms | 5,333.5–5,399.4 ms | narrower Luna tail |
| Request median | 1,874.9 ms | 1,760.6 ms | −114.3 ms / −6.1% |
| Request mean | 2,032.6 ms | 1,942.8 ms | −89.8 ms / −4.4% |
| Request range | 1,473.8–3,285.4 ms | 1,278.1–4,348.0 ms | wider Luna tail |

## Generated payloads

Each payload used `task: contextType` with the listed context and target:

| # | Context | Target |
|---:|---|---|
| 1 | `消息被传播后，大家都知道了` | `消息` |
| 2 | `他不是文明人说的那样` | `文明人` |
| 3 | `你好吗世界` | `你好` |
| 4 | `操你妈是什么意思` | `操你妈` |
| 5 | `这个办法很有效` | `办法` |
| 6 | `我们明天再讨论这个问题` | `讨论` |
| 7 | `天气预报说明天会下雨` | `天气预报` |
| 8 | `请把门打开让我进去` | `打开` |
| 9 | `这本书的内容非常有趣` | `内容` |
| 10 | `她正在学习新的语言` | `学习` |
| 11 | `我们需要解决这个困难` | `解决` |
| 12 | `孩子们在公园里玩耍` | `孩子们` |
| 13 | `这家餐厅的服务很好` | `餐厅` |
| 14 | `他昨天买了一部手机` | `手机` |
| 15 | `请不要忘记关灯` | `忘记` |
| 16 | `他们已经完成了工作` | `完成` |
| 17 | `我想知道你的想法` | `想法` |
| 18 | `这个城市有很多历史建筑` | `历史建筑` |
| 19 | `我们一起去看电影吧` | `看电影` |
| 20 | `她把问题解释得很清楚` | `解释` |

## Interpretation

In this larger sample, Luna has a modest median work-speed advantage and essentially identical startup readiness. Luna’s request maximum was higher, so the median improvement should not be treated as a tail-latency guarantee. The result supports trying Luna in the worker, with another longer steady-state run if tail latency becomes the primary decision metric.

## Raw evidence

- [Baseline raw results](benchmark-results-20x-gpt54-low.json)
- [Luna raw results](benchmark-results-20x-luna-medium.json)
- [Benchmark harness](benchmark.mjs)
