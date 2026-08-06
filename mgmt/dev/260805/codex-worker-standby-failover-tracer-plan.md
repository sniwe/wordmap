# Codex worker standby/failover tracer-bullet plan

Date: 2026-08-05

## Objective

Keep chin disambiguation and other Codex-backed work moving when the active CLI worker or its nested Codex app-server fails. Startup should prime two independent workers. One owns the active role; the other is warm standby. A failed active request is retried immediately on standby, while the failed slot is respawned, reprimed, and returned to standby when healthy.

The retry is safe because chin jobs already carry an expected instance snapshot and are applied with `requireInstanceMatch: true`. A retry can therefore produce either one mutation or a stale no-op, never an unsafe overwrite.

## Current seam to preserve

- `src/public/server.js` owns the in-memory chin FIFO, drain, timeout, and `getCodexWorkerClient()`.
- `mgmt/codex-worker/src/index.js` is a streamed JSONL worker process. It owns one nested `codex app-server` process and one Codex thread.
- The server currently serializes requests through one Promise chain and maps worker stdout lines to pending requests by order.
- Worker exit is currently reported generically through the server child `exit` handler; exit code, signal, stderr tail, slot, and generation are not retained.
- `/api/codex-worker/status` currently reports only prime completion.

Do not make the standby a second consumer of the same worker stream. Each slot must own its complete process tree, stdout parser, pending map, queue, prime promise, and Codex thread.

## Phase 1 — Worker slot seam with one active slot

Create the smallest internal `WorkerSlot` wrapper around the existing client behavior.

Shape:

```text
WorkerSlot {
  slotId: active | standby
  generation
  child
  pending
  requestQueue
  primePromise
  primeComplete
  state: starting | ready | busy | failed | repairing | closed
  lastError
  lastExit: { code, signal, at }
}
```

Move spawn, stdout JSONL matching, stderr forwarding, timeout, close, and exit cleanup behind the slot without changing request routing yet. Add structured lifecycle logging:

```text
[codex-worker][active][generation=3] spawned
[codex-worker][active][generation=3] primed
[codex-worker][active][generation=3] request-start id=...
[codex-worker][active][generation=3] exited code=... signal=...
```

Tracer gate: with only one slot enabled, existing root inference and chin disambiguation still work; a forced child exit produces an exit code/signal and a bounded request error rather than an unexplained stack trace.

## Phase 2 — Startup-spawned warm standby

Add a worker pool with exactly two slots. Startup creates both slots concurrently, but the app is considered worker-ready only after the active slot is primed. Standby priming may continue in parallel; requests never route to a slot until its own prime promise is complete.

Each slot must create its own nested Codex app-server and thread. Do not reuse `threadId`, `pendingRequests`, or `pendingTurns` across slots.

The standby may be kept idle after priming. It must not receive normal work while the active slot is healthy.

Extend `/api/codex-worker/status` with:

```json
{
  "active": { "state": "ready", "generation": 1 },
  "standby": { "state": "ready", "generation": 1 },
  "repairing": false,
  "lastFailure": null
}
```

Tracer gate: startup shows two independent `ready` lifecycle records; killing the standby alone does not interrupt active requests, and the standby is automatically repaired back to `ready`.

## Phase 3 — Active request failover

Put one routing method above the slot-specific request methods:

```text
request(payload)
  -> active slot
  -> on transport/exit/timeout failure: promote ready standby
  -> retry the same payload once on promoted slot
  -> begin repairing the failed slot
```

The original request must not be acknowledged until the retry succeeds or both slots fail. Keep the same logical request/job id in logs, but add `attempt`, `slotId`, and `generation` so one logical job can be traced across workers.

Promotion must be atomic from the queue’s perspective:

1. Mark the failed active slot unavailable.
2. Swap the ready standby into active role.
3. Send the in-flight payload to the promoted slot.
4. Start repair of the failed slot.
5. Do not allow another drain job to race ahead of the retry.

The stale-instance guard remains the final data-safety boundary. Do not enqueue a second completion event for the failed attempt; emit one logical completion event containing retry metadata.

Tracer gate: kill the active worker during one request. The same job completes through standby, the queue revision increments once, and the former active slot enters repair without blocking the next job.

## Phase 4 — Repair and standby restoration

Repair the failed slot in the background:

1. Kill the entire failed worker process if still present.
2. Clear its pending requests, stdout reader, timers, and old generation state.
3. Spawn a new generation for that slot.
4. Prime its nested app-server and thread.
5. Return it to standby only after readiness is confirmed.

Use generation fencing so late stdout or exit events from an old process cannot mutate the new slot. Back off repeated repair attempts; keep the active slot serving while repair is unavailable. A repair failure must not recursively trigger another failover.

Tracer gate: after active failover, status transitions `active old -> standby old`, `failed old -> repairing new generation -> standby ready`; normal traffic continues during repair.

## Phase 5 — Double-failure behavior and queue integration

Define the bounded failure contract:

- If active fails and standby succeeds: retry once, emit one successful completion.
- If active and standby both fail: emit one failed completion with both failure causes, release the dedupe key, and continue draining later jobs.
- If no slot is ready: pause the drain briefly while repair runs; do not spin or grow an unbounded retry loop.
- Preserve the existing job dedupe key across failover attempts; release it only after logical completion/failure.

Expose `active`, `standby`, `repairing`, `attempt`, and `lastFailure` in the status endpoint so the frontend toast/status path can say whether work was completed normally, failed over, or is waiting for repair.

Tracer gate: kill both workers in sequence. The queue reports a bounded failure, then resumes automatically once one repaired slot is ready. No stale worker response changes persisted langUnit data.

## Phase 6 — Verification harness and rollout

Add a narrow runtime verifier under `mgmt/dev/260805` that uses the real API and controlled worker failure hooks or process IDs. It should prove:

- both workers prime at startup;
- active success stays on active;
- active kill reroutes the same test job to standby;
- failed slot repairs and becomes standby;
- duplicate subSeg saves do not duplicate pending work;
- double failure produces one failed logical completion and a continuing queue;
- persisted `langUnit.instances[].context/target` is changed at most once;
- long subSeg line content and line breaks remain untouched by worker failover.

Only after the verifier passes should the frontend status/toast wording be expanded. The UI is downstream evidence; slot lifecycle logs and the status endpoint are authoritative.

## Suggested edit order

1. Slot wrapper and structured exit diagnostics.
2. Two-slot startup and standby priming.
3. Atomic promotion plus one-request retry.
4. Generation-safe repair loop.
5. Double-failure and queue status contract.
6. Runtime verifier, then frontend status/toast copy.

Each phase is independently runnable and leaves the previous single-worker behavior as the fallback until its tracer gate passes.
