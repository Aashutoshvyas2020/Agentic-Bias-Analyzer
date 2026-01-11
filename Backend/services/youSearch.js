const {
  YOU_SEARCH_API_URL,
  RESULTS_PER_CLAIM,
  FRESHNESS_DEFAULT
} = require("../config/controlBoard");
const { sessionCache, buildCacheKey } = require("./sessionCache");

function getFetch() {
  if (typeof fetch === "function") return fetch;
  try {
    return require("node-fetch");
  } catch (err) {
    return null;
  }
}

function sleep(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

function isTransientError(err) {
  if (!err) return false;
  var msg = String(err.message || "");
  return (
    err.name === "AbortError" ||
    /terminated/i.test(msg) ||
    /socket/i.test(msg) ||
    /ECONNRESET/i.test(msg) ||
    /ETIMEDOUT/i.test(msg)
  );
}

function isTransientStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function pickArray(data) {
  if (!data) return [];
  if (data.results && Array.isArray(data.results.web)) return data.results.web;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.hits)) return data.hits;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.search_results)) return data.search_results;
  if (Array.isArray(data.web_results)) return data.web_results;
  if (Array.isArray(data.pages)) return data.pages;
  return [];
}

function normalizeResult(item) {
  var url =
    item.url ||
    item.link ||
    item.sourceUrl ||
    item.source_url ||
    (item.page && item.page.url) ||
    (item.document && item.document.url) ||
    "";
  var title =
    item.title ||
    item.name ||
    item.pageTitle ||
    (item.page && item.page.title) ||
    (item.document && item.document.title) ||
    "";
  var snippet =
    item.snippet ||
    item.description ||
    item.extract ||
    item.text ||
    item.highlight ||
    "";
  var source =
    item.source ||
    item.site ||
    item.publisher ||
    "";
  var date =
    item.date ||
    item.published ||
    item.published_date ||
    item.publishedDate ||
    item.timestamp ||
    "";
  var contentMarkdown =
    item.content_markdown ||
    item.content_markdown_if_any ||
    (item.livecrawl && (item.livecrawl.content_markdown || item.livecrawl.content)) ||
    (item.content && item.content.markdown) ||
    item.markdown ||
    "";

  return {
    url: url,
    title: title,
    snippet: snippet,
    source: source,
    date: date,
    content_markdown_if_any: contentMarkdown
  };
}

async function searchWeb(query, options, context) {
  var fetchFn = getFetch();
  if (!fetchFn) {
    throw new Error("Fetch is not available in this Node runtime.");
  }

  var opts = options || {};
  var ctx = context || {};
  var logger = ctx.logger || console;
  var count = opts.count || RESULTS_PER_CLAIM;
  var freshness = opts.freshness || FRESHNESS_DEFAULT;
  var livecrawl = opts.livecrawl;
  var livecrawlFormats = opts.livecrawl_formats || "markdown";
  var allowlistVersion = opts.allowlist_version || ctx.allowlistVersion;
  var requestLivecrawl = livecrawl;
  var requestLivecrawlFormats = livecrawlFormats;
  var requestCount = count;
  var triedLite = false;

  var cacheKey = buildCacheKey(query, freshness, allowlistVersion);
  var cached = sessionCache.get(cacheKey);
  if (cached) {
    return {
      results: cached,
      cached: true,
      query: query
    };
  }

  if (ctx.budget && ctx.claimId && typeof ctx.budget.canSpend === "function") {
    if (!ctx.budget.canSpend(ctx.claimId)) {
      return {
        results: [],
        cached: false,
        query: query,
        budgetExceeded: true
      };
    }
  }

  if (!process.env.YOU_API_KEY) {
    throw new Error("Missing YOU_API_KEY environment variable.");
  }

  if (ctx.budget && ctx.claimId && typeof ctx.budget.spend === "function") {
    ctx.budget.spend(ctx.claimId);
  }

  function buildUrl() {
    var params = new URLSearchParams();
    params.set("query", query);
    params.set("count", String(requestCount));
    if (freshness) params.set("freshness", freshness);
    if (requestLivecrawl !== undefined) params.set("livecrawl", String(requestLivecrawl));
    if (requestLivecrawlFormats) params.set("livecrawl_formats", String(requestLivecrawlFormats));
    return YOU_SEARCH_API_URL + "?" + params.toString();
  }
  var headers = {
    "X-API-Key": process.env.YOU_API_KEY,
    "Accept-Encoding": "identity",
    "User-Agent": "BiasLens/1.0"
  };

  var attempt = 0;
  var lastError = null;
  while (attempt < 3) {
    try {
      var url = buildUrl();
      var controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var timer = controller ? setTimeout(function() { controller.abort(); }, 20000) : null;
      var response = await fetchFn(url, { headers: headers, signal: controller ? controller.signal : undefined });
      if (timer) clearTimeout(timer);
      if (!response.ok) {
        var reqId = (response.headers && response.headers.get) ? response.headers.get("x-request-id") : "";
        if (!triedLite && response.status >= 500 && requestLivecrawl !== undefined) {
          triedLite = true;
          requestLivecrawl = undefined;
          requestLivecrawlFormats = undefined;
          requestCount = Math.min(requestCount, 4);
          attempt++;
          await sleep(300 * attempt);
          continue;
        }
        if (isTransientStatus(response.status) && attempt < 2) {
          attempt++;
          await sleep(300 * attempt);
          continue;
        }
        var bodyText = "";
        try {
          bodyText = await response.text();
        } catch (err) {
          bodyText = "[body read failed]";
        }
        var errMsg = "You.com error " + response.status;
        if (reqId) errMsg += " (request-id " + reqId + ")";
        errMsg += ": " + bodyText;
        var httpErr = new Error(errMsg);
        httpErr.isHttpError = true;
        httpErr.status = response.status;
        throw httpErr;
      }
      var rawText = "";
      try {
        rawText = await response.text();
      } catch (err) {
        if (isTransientError(err) && attempt < 2) {
          attempt++;
          await sleep(300 * attempt);
          continue;
        }
        throw err;
      }
      var data = JSON.parse(rawText);
      var rawResults = pickArray(data);
      var normalized = rawResults.map(normalizeResult);
      sessionCache.set(cacheKey, normalized);
      return {
        results: normalized,
        cached: false,
        query: query
      };
    } catch (err) {
      lastError = err;
      if (attempt < 2 && (isTransientError(err) || (err.isHttpError && err.status >= 500))) {
        attempt++;
        await sleep(300 * attempt);
        continue;
      }
      if (logger && logger.warn) {
        logger.warn("You.com search failed:", err.message);
      }
      if (err && err.isHttpError && err.status < 500 && err.status !== 429) {
        throw err;
      }
      if (err && err.isHttpError && err.status >= 500) {
        return {
          results: [],
          cached: false,
          query: query,
          error: err
        };
      }
      return {
        results: [],
        cached: false,
        query: query,
        error: err
      };
    }
  }

  throw lastError || new Error("You.com search failed.");
}

module.exports = {
  searchWeb
};
