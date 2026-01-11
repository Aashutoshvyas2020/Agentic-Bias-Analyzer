const crypto = require("crypto");
const {
  CACHE_TTL_MS,
  CACHE_MAX_ENTRIES,
  ALLOWLIST_VERSION
} = require("../config/controlBoard");

class SessionCache {
  constructor(opts) {
    this.ttlMs = opts.ttlMs;
    this.maxEntries = opts.maxEntries;
    this.map = new Map();
  }

  get(key) {
    var entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    entry.lastAccess = Date.now();
    return entry.value;
  }

  set(key, value) {
    var now = Date.now();
    this.map.set(key, {
      value: value,
      expiresAt: now + this.ttlMs,
      insertedAt: now,
      lastAccess: now
    });
    this.prune();
  }

  prune() {
    var now = Date.now();
    for (var entry of this.map.entries()) {
      if (entry[1].expiresAt <= now) this.map.delete(entry[0]);
    }
    while (this.map.size > this.maxEntries) {
      var firstKey = this.map.keys().next().value;
      if (firstKey === undefined) break;
      this.map.delete(firstKey);
    }
  }
}

function buildCacheKey(query, freshness, allowlistVersion) {
  var input = String(query) + "|" + String(freshness) + "|" + String(allowlistVersion || ALLOWLIST_VERSION);
  return crypto.createHash("sha256").update(input).digest("hex");
}

var sessionCache = new SessionCache({
  ttlMs: CACHE_TTL_MS,
  maxEntries: CACHE_MAX_ENTRIES
});

module.exports = {
  SessionCache,
  sessionCache,
  buildCacheKey
};
