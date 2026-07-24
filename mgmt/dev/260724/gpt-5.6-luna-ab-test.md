# Codex CLI model A/B test — 2026-07-24

## Result

For the project’s deployed Codex worker path, `gpt-5.6-luna` at medium effort was marginally faster than the current `gpt-5.4-mini` worker at low effort for warm Chinese disambiguation requests: **1.952 s vs 2.008 s median (2.8% faster)**.

Cold startup-to-ready was effectively tied: **5.353 s for Luna vs 5.344 s for the deployed baseline (0.18% slower)**.

At the same medium effort, Luna’s request median was **1.952 s vs 2.944 s for `gpt-5.4-mini` (33.7% faster)**.

## Models and scope

- CLI: `codex-cli 0.145.0`
- Current worker baseline: `gpt-5.4-mini`, low effort, from `mgmt/codex-worker/src/index.js`
- Candidate: `gpt-5.6-luna`, medium effort
- The user profile default is already `gpt-5.6-luna`; the baseline is therefore the worker’s actual configured model, not the profile default.
- No collection data or edit-note records were changed.

## Method

Each trial started a fresh `codex app-server --listen stdio://` process, initialized it, and started a thread. Startup time is process launch through the `thread/start` response. Three cold startup trials were collected per model.

For work speed, each model used two persistent-thread batches. Each batch sent one warm-up request followed by six generated `contextType` Chinese disambiguation payloads. Request time is from `turn/start` submission through the completed agent message. There were 12 measured payload requests per model.

The six payloads were:

| Context | Target |
|---|---|
| `消息被传播后，大家都知道了` | `消息` |
| `他不是文明人说的那样` | `文明人` |
| `你好吗世界` | `你好` |
| `操你妈是什么意思` | `操你妈` |
| `这个办法很有效` | `办法` |
| `我们明天再讨论这个问题` | `讨论` |

Both models used the same prompt shape, output schema, cwd, approval policy, and sandbox policy. The measured requests were sent directly through app-server so model processing could be separated from worker JSON plumbing.

## Measurements

| Comparison | Baseline | Luna | Luna delta |
|---|---:|---:|---:|
| Startup median; deployed baseline low vs Luna medium | 5,343.9 ms | 5,353.4 ms | +9.5 ms / +0.18% |
| Request median; deployed baseline low vs Luna medium | 2,007.8 ms | 1,951.8 ms | −56.0 ms / −2.8% |
| Request mean; deployed baseline low vs Luna medium | 1,982.6 ms | 2,349.6 ms | +367.0 ms / +18.5% |
| Startup median; both medium effort | 5,353.2 ms | 5,353.4 ms | +0.2 ms / +0.004% |
| Request median; both medium effort | 2,944.3 ms | 1,951.8 ms | −992.5 ms / −33.7% |

The deployed-baseline request mean is lower than its median because its run had less high-tail latency. Luna’s request range was 1,548–4,850 ms in the medium comparison; the low-effort baseline range was 1,528–2,705 ms.

## Interpretation

Luna does not materially improve cold readiness in this setup. It does improve median request latency, but the advantage against the actual low-effort worker is small and its medium-effort tail was wider in this sample. Against an equal-effort medium baseline, the median improvement is substantial.

For a production choice, Luna is a reasonable candidate for the worker, with a follow-up run recommended after longer steady-state traffic if tail latency matters more than median latency.

## Raw evidence

- [Equal-medium and Luna raw results](benchmark-results.json)
- [Deployed `gpt-5.4-mini` low-effort raw results](benchmark-results-gpt54-low.json)
- [Minimal benchmark harness](benchmark.mjs)
