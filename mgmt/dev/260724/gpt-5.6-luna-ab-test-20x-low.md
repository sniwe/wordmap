# Codex CLI model A/B test — 20× low-effort run — 2026-07-24

## Result

With both models at low reasoning effort, Luna was faster on median request time but showed a severe tail-latency outlier:

- Startup-to-ready median: **5,360.0 ms vs 5,353.8 ms**, Luna **6.2 ms / 0.12% slower**.
- Request median: **1,790.5 ms vs 1,874.9 ms**, Luna **84.4 ms / 4.5% faster**.
- Luna request mean: **7,611.3 ms**, driven by one **99,889.8 ms** request.

The median result favors Luna, but this run does not support an unqualified switch because Luna’s tail was much worse: p95 was **17,591.5 ms** versus **2,694.3 ms** for the baseline.

## Test setup

- CLI: `codex-cli 0.145.0`
- Baseline: `gpt-5.4-mini`, low effort
- Candidate: `gpt-5.6-luna`, low effort
- Startup trials: 20 fresh `codex app-server --listen stdio://` processes per model
- Request trials: 20 generated Chinese disambiguation payloads per model on one persistent initialized thread
- Startup measurement: process launch through `thread/start` response
- Request measurement: `turn/start` submission through completed agent message
- Both used the same prompt shape, output schema, cwd, approval policy, and sandbox policy
- No collection data or edit-note records were changed

## Measurements

| Metric | `gpt-5.4-mini` low | `gpt-5.6-luna` low | Luna delta |
|---|---:|---:|---:|
| Startup median | 5,353.8 ms | 5,360.0 ms | +6.2 ms / +0.12% |
| Startup mean | 5,357.1 ms | 5,355.6 ms | −1.5 ms / −0.03% |
| Startup range | 5,334.0–5,460.1 ms | 5,316.4–5,400.4 ms | similar |
| Request median | 1,874.9 ms | 1,790.5 ms | −84.4 ms / −4.5% |
| Request mean | 2,032.6 ms | 7,611.3 ms | +5,578.7 ms / +274.3% |
| Request p90 | 2,568.6 ms | 3,845.7 ms | +1,277.1 ms |
| Request p95 | 2,694.3 ms | 17,591.5 ms | +14,897.2 ms |
| Request maximum | 3,285.4 ms | 99,889.8 ms | +96,604.4 ms |

The Luna outlier was the payload targeting `打开`; the next-slowest Luna request targeted `内容` at 17,591.5 ms. The baseline’s slowest request targeted `餐厅` at 3,285.4 ms.

## Generated payload set

This is the same 20-payload Chinese disambiguation set used in the preceding 20× run, covering lexical words, compounds, greetings, clauses, and phrase-like targets. The raw artifacts contain the exact context, target, substring, response, and timing for every request.

## Interpretation

At low effort, Luna has a modest median speed advantage and no meaningful startup advantage. The observed tail behavior is the decisive caveat: use median-only conclusions cautiously. A production decision should first investigate or repeat the 99.9-second `打开` request under a longer sample before replacing the current worker model.

## Raw evidence

- [Baseline low-effort raw results](benchmark-results-20x-gpt54-low.json)
- [Luna low-effort raw results](benchmark-results-20x-luna-low.json)
- [Benchmark harness](benchmark.mjs)
