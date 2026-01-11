const TTL_MS = 10 * 60 * 1000;
const MAX_EVENTS = 200;

var store = new Map();

function now() {
  return Date.now();
}

function prune() {
  var cutoff = now() - TTL_MS;
  for (var entry of store.entries()) {
    var value = entry[1];
    if (!value || value.updatedAt < cutoff) {
      store.delete(entry[0]);
    }
  }
}

function initProgress(runId) {
  if (!runId) return;
  store.set(runId, {
    events: [],
    updatedAt: now(),
    done: false,
    error: ""
  });
}

function pushProgress(runId, message) {
  if (!runId || !message) return;
  var entry = store.get(runId);
  if (!entry) {
    initProgress(runId);
    entry = store.get(runId);
  }
  entry.events.push({ ts: now(), message: String(message) });
  if (entry.events.length > MAX_EVENTS) {
    entry.events = entry.events.slice(-MAX_EVENTS);
  }
  entry.updatedAt = now();
  store.set(runId, entry);
  prune();
}

function completeProgress(runId) {
  if (!runId) return;
  var entry = store.get(runId);
  if (!entry) {
    initProgress(runId);
    entry = store.get(runId);
  }
  entry.done = true;
  entry.updatedAt = now();
  store.set(runId, entry);
}

function failProgress(runId, error) {
  if (!runId) return;
  var entry = store.get(runId);
  if (!entry) {
    initProgress(runId);
    entry = store.get(runId);
  }
  entry.done = true;
  entry.error = String(error || "failed");
  entry.updatedAt = now();
  store.set(runId, entry);
}

function getProgress(runId) {
  prune();
  var entry = store.get(runId);
  if (!entry) {
    return {
      events: [],
      done: true,
      error: "not_found",
      updatedAt: now()
    };
  }
  return {
    events: entry.events,
    done: entry.done,
    error: entry.error || "",
    updatedAt: entry.updatedAt
  };
}

module.exports = {
  initProgress,
  pushProgress,
  completeProgress,
  failProgress,
  getProgress
};
