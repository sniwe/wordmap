# Codex CLI model A/B test — repeat 2, low effort, outlier-resistant — 2026-07-24

## Result

The same 20-payload / 20-start test was repeated with both models at low reasoning effort. This repeat had no extreme latency stall.

- Startup median: Luna **5,364.6 ms** vs baseline **5,368.9 ms**; Luna **4.3 ms / 0.08% faster**.
- Request median: Luna **2,230.3 ms** vs baseline **2,243.1 ms**; Luna **12.8 ms / 0.6% faster**.
- 10% trimmed request mean: Luna **2,282.9 ms** vs baseline **2,802.9 ms**; Luna **520.0 ms / 18.6% faster**.

The trimmed mean removes the single fastest and single slowest request from each 20-request set. It is the primary work-speed comparison here because the prior Luna run contained a 99.9-second stall.

## Measurements

| Metric | `gpt-5.4-mini` low | `gpt-5.6-luna` low | Luna delta |
|---|---:|---:|---:|
| Startup median | 5,368.9 ms | 5,364.6 ms | −4.3 ms / −0.08% |
| Request median | 2,243.1 ms | 2,230.3 ms | −12.8 ms / −0.6% |
| Request 10% trimmed mean | 2,802.9 ms | 2,282.9 ms | −520.0 ms / −18.6% |
| Request raw mean | 2,939.5 ms | 2,399.1 ms | −540.4 ms / −18.4% |
| Request range | 1,720.5–6,616.2 ms | 1,409.9–5,479.5 ms | lower Luna maximum |

No request exceeded 7 seconds in this repeat. The slowest baseline request targeted `打开` at 6,616.2 ms; the slowest Luna request targeted `你好` at 5,479.5 ms.

## Method

- CLI: `codex-cli 0.145.0`
- 20 fresh app-server startup trials per model
- 20 generated Chinese disambiguation payloads per model on one persistent thread
- Startup measured from process launch through `thread/start` response
- Request measured from `turn/start` submission through completed agent message
- Same prompt shape, output schema, cwd, approval policy, and sandbox policy for both models

## Conclusion

Without the extreme outlier, Luna is essentially tied on median request speed and materially faster on the trimmed mean in this repeat. Startup speed remains indistinguishable. The result is more representative than the previous Luna-low run, but the raw artifacts should still be retained because tail behavior can vary between runs.

## Raw evidence

- [Baseline repeat raw results](benchmark-results-20x-repeat2-gpt54-low.json)
- [Luna repeat raw results](benchmark-results-20x-repeat2-luna-low.json)
- [Benchmark harness](benchmark.mjs)
