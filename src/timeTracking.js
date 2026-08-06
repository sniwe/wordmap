const DEFAULT_IDLE_AFTER_MS = 30_000;
const DEFAULT_SAMPLE_EVERY_MS = 1_000;
const DEFAULT_FLUSH_EVERY_MS = 10_000;

function keyOf(scopeType, scopeId) {
  return `${scopeType}:${scopeId}`;
}

function addTotals(target, source) {
  for (const metric of ['openMs', 'activeMs', 'playMs', 'activePlayMs']) {
    target[metric] = (target[metric] || 0) + (Number(source?.[metric]) || 0);
  }
}

export function createTimeTracker({
  getContext = () => ({}),
  flush: send = async () => {},
  clock = () => performance.now(),
  idleAfterMs = DEFAULT_IDLE_AFTER_MS,
  sampleEveryMs = DEFAULT_SAMPLE_EVERY_MS,
  flushEveryMs = DEFAULT_FLUSH_EVERY_MS,
} = {}) {
  let lastAt = clock();
  let lastActivityAt = lastAt;
  let visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  let context = {};
  let timer = null;
  let flushTimer = null;
  let stopped = false;
  let flushing = false;
  const pending = new Map();

  function signalActivity(kind, at = clock()) {
    if (Number.isFinite(at)) {
      lastActivityAt = at;
    }
    return kind;
  }

  function setVisibility(isVisible, at = clock()) {
    tick(at);
    visible = Boolean(isVisible);
  }

  function setContext(nextContext) {
    context = nextContext && typeof nextContext === 'object' ? nextContext : {};
  }

  function tick(at = clock()) {
    if (stopped || !Number.isFinite(at)) {
      return;
    }

    const elapsed = Math.max(0, Math.min(at - lastAt, sampleEveryMs * 4));
    lastAt = at;
    if (!elapsed) {
      return;
    }

    const nextContext = typeof getContext === 'function' ? getContext() : context;
    const active = visible && at - lastActivityAt <= idleAfterMs;
    const scopes = [{ scopeType: 'page', scopeId: 'app', parent: null, openMs: visible ? elapsed : 0, activeMs: active ? elapsed : 0 }];
    if (visible && nextContext.playing) {
      const parent = {
        audEpId: nextContext.audEpId || undefined,
        audSegId: nextContext.audSegId || undefined,
        grpId: nextContext.audSegGroupId || undefined,
      };
      for (const [scopeType, scopeId] of [
        ['audEp', nextContext.audEpId],
        ['audSeg', nextContext.audSegId],
        ['audSegGroup', nextContext.audSegGroupId],
        ['subSeg', nextContext.subSegId],
      ]) {
        if (scopeId) {
          scopes.push({ scopeType, scopeId, parent, playMs: elapsed, activePlayMs: active ? elapsed : 0 });
        }
      }
    }

    for (const scope of scopes) {
      const key = keyOf(scope.scopeType, scope.scopeId);
      const bucket = pending.get(key) || { scopeType: scope.scopeType, scopeId: scope.scopeId, parent: scope.parent ?? null, totals: {} };
      addTotals(bucket.totals, scope);
      pending.set(key, bucket);
    }
  }

  async function flush(options = {}) {
    if (!pending.size || flushing) {
      return;
    }
    flushing = true;
    const snapshot = [...pending.values()].map((item) => ({ ...item, totals: { ...item.totals } }));
    if (options.beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const accepted = navigator.sendBeacon('/api/timeTracking/deltas', new Blob([JSON.stringify({ deltas: snapshot })], { type: 'application/json' }));
      if (accepted) {
        for (const item of snapshot) pending.delete(keyOf(item.scopeType, item.scopeId));
      }
      flushing = false;
      return;
    }
    try {
      await send(snapshot, options);
      for (const item of snapshot) pending.delete(keyOf(item.scopeType, item.scopeId));
    } catch {
      // Keep unacknowledged deltas for the next batch.
    } finally {
      flushing = false;
    }
  }

  function stop() {
    stopped = true;
    clearInterval(timer);
    clearInterval(flushTimer);
    timer = null;
    flushTimer = null;
  }

  timer = setInterval(() => tick(), sampleEveryMs);
  flushTimer = setInterval(() => { void flush({ reason: 'interval' }); }, flushEveryMs);

  return {
    signalActivity,
    setVisibility,
    setContext,
    tick,
    flush,
    stop,
    pending,
  };
}

export const timeTrackingDefaults = { DEFAULT_IDLE_AFTER_MS, DEFAULT_SAMPLE_EVERY_MS, DEFAULT_FLUSH_EVERY_MS };
