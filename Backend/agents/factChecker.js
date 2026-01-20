const {
  RESULTS_PER_CLAIM,
  FRESHNESS_DEFAULT,
  MAX_RUN_QUERIES,
  VERIFICATION_TIMEOUT_MS,
  ALLOWLIST_VERSION,
  FACTCHECK_VERDICT_PROMPT_TEMPLATE,
  ALLOWED_SOURCE_TLDS,
  TOP_NEWS_DOMAINS
} = require("../config/controlBoard");
const { searchWeb } = require("../services/youSearch");

const MAX_QUERIES_PER_CLAIM = 5;
const MAX_SOURCES_PER_CLAIM = 6;
const FACTCHECK_VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "directness", "reasoning_short"],
  properties: {
    verdict: { type: "string", enum: ["Supported", "Contradicted", "Unverified"] },
    directness: { type: "number", minimum: 0, maximum: 1 },
    reasoning_short: { type: "string", minLength: 12, maxLength: 400 }
  }
};

function parseStrictJsonOrThrow(text, label) {
  var raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    var cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
    if (cleaned !== raw) {
      try {
        return JSON.parse(cleaned);
      } catch (err2) {
        // fall through to error
      }
    }

    var message =
      label + " returned invalid JSON.\n\n" +
      "Raw output starts with: " + raw.slice(0, 120) + "\n\n" +
      "Full raw output:\n" + raw;

    var e = new Error(message);
    e.name = "InvalidModelJSON";
    e.raw = raw;
    throw e;
  }
}

function fillTemplate(template, values) {
  return template
    .replace(/\{\{ALLOWED_SOURCES\}\}/g, values.allowedSources || "")
    .replace(/\{\{CLAIM\}\}/g, values.claim || "")
    .replace(/\{\{RAW_RESULTS\}\}/g, values.rawResults || "");
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeVerdict(verdict) {
  var v = String(verdict || "").trim().toLowerCase();
  if (v === "supported") return "Supported";
  if (v === "contradicted") return "Contradicted";
  return "Unverified";
}

function domainFromUrl(url) {
  try {
    var parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch (err) {
    return "";
  }
}

function domainMatches(host, domain) {
  if (!host || !domain) return false;
  if (host === domain) return true;
  return host.endsWith("." + domain);
}

function isAllowedDomain(host) {
  if (!host) return false;
  for (var i = 0; i < ALLOWED_SOURCE_TLDS.length; i++) {
    if (host.endsWith(ALLOWED_SOURCE_TLDS[i])) return true;
  }
  for (var j = 0; j < TOP_NEWS_DOMAINS.length; j++) {
    if (domainMatches(host, TOP_NEWS_DOMAINS[j])) return true;
  }
  return false;
}

function uniqueList(items) {
  var seen = {};
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var value = items[i];
    if (!value || seen[value]) continue;
    seen[value] = true;
    out.push(value);
  }
  return out;
}

function truncate(text, limit) {
  var str = String(text || "");
  if (str.length <= limit) return str;
  return str.slice(0, limit) + "...";
}

function createBudget() {
  return {
    totalUsed: 0,
    perClaimUsed: {},
    canSpend: function(claimId) {
      var perClaim = this.perClaimUsed[claimId] || 0;
      return this.totalUsed < MAX_RUN_QUERIES && perClaim < MAX_QUERIES_PER_CLAIM;
    },
    spend: function(claimId) {
      this.totalUsed += 1;
      this.perClaimUsed[claimId] = (this.perClaimUsed[claimId] || 0) + 1;
    }
  };
}

function computeConfidence(verdict, directness, evidence) {
  var base = verdict === "Unverified" ? 20 : 40;
  var evidenceBoost = Math.min(evidence.length - 1, 2) * 10;
  var directnessBoost = Math.round(clamp(directness || 0.3, 0, 1) * 20);
  var score = base + evidenceBoost + directnessBoost;
  if (verdict === "Unverified") score = Math.min(score, 45);
  return clamp(Math.round(score), 0, 100);
}

function formatResultsForPrompt(results) {
  if (!results.length) return "No results available.";
  var lines = [];
  var seen = {};
  for (var i = 0; i < results.length; i++) {
    var item = results[i] || {};
    if (!item.url || seen[item.url]) continue;
    seen[item.url] = true;
    var domain = domainFromUrl(item.url);
    var snippet = item.content_markdown_if_any || item.snippet || item.description || "";
    lines.push(
      "Result " + (lines.length + 1) + " (" + domain + "): " +
      truncate(item.title || "", 180) + "\n" +
      "Snippet: " + truncate(snippet, 420) + "\n" +
      "URL: " + item.url
    );
  }
  return lines.join("\n");
}

async function evaluateVerdict(ai, model, claimText, results, allowedSources) {
  var prompt = fillTemplate(FACTCHECK_VERDICT_PROMPT_TEMPLATE, {
    claim: claimText,
    rawResults: formatResultsForPrompt(results),
    allowedSources: allowedSources
  });

  var response = await ai.models.generateContent({
    model: model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: FACTCHECK_VERDICT_SCHEMA
    }
  });

  var json = parseStrictJsonOrThrow(response.text, "FactCheck Verdict");
  var verdict = normalizeVerdict(json.verdict);
  var directness = Number(json.directness);
  if (Number.isNaN(directness)) directness = 0.3;
  var reasoning = String(json.reasoning_short || "").trim();

  return {
    verdict: verdict,
    directness: clamp(directness, 0, 1),
    reasoning_short: reasoning
  };
}

async function checkSourceMatch(opts) {
  var headline = String(opts.headline || "").trim();
  if (!headline) {
    return { status: "skipped", canonical_url: "" };
  }

  var sources = ["reuters", "ap"];
  var match = { status: "not_found", canonical_url: "" };
  for (var i = 0; i < sources.length; i++) {
    var site = sources[i] === "reuters" ? "reuters.com" : "apnews.com";
    var query = "\"" + headline + "\" site:" + site;
    try {
      var result = await searchWeb(query, {
        count: 3,
        freshness: opts.freshness || FRESHNESS_DEFAULT,
        allowlist_version: ALLOWLIST_VERSION
      }, {
        budget: opts.budget,
        claimId: "source-match",
        logger: opts.logger
      });
      var items = result.results || [];
      if (items.length) {
        match.status = "matched";
        match.canonical_url = items[0].url || "";
        match.source = sources[i];
        break;
      }
    } catch (err) {
      if (opts.logger && opts.logger.warn) {
        opts.logger.warn("Source match search failed:", err.message || err);
      }
    }
  }
  return match;
}

function normalizeQueries(claim) {
  var list = [];
  var base = claim.claim ? String(claim.claim).trim() : "";
  if (Array.isArray(claim.recommended_queries)) {
    list = list.concat(claim.recommended_queries);
  }
  if (claim.query_hint) list.push(claim.query_hint);
  if (base) list.push(base);
  var normalized = uniqueList(list.map(function(item) { return String(item).trim(); })).filter(Boolean);
  if (normalized.length < MAX_QUERIES_PER_CLAIM && base) {
    normalized.push(base + " official");
  }
  if (normalized.length < MAX_QUERIES_PER_CLAIM && base) {
    normalized.push(base + " report");
  }
  return normalized.slice(0, MAX_QUERIES_PER_CLAIM);
}

function collectEvidence(results) {
  var evidence = [];
  var seenDomains = {};
  var seenUrls = {};
  var deferred = [];
  for (var i = 0; i < results.length; i++) {
    if (evidence.length >= MAX_SOURCES_PER_CLAIM) break;
    var item = results[i] || {};
    if (!item.url || seenUrls[item.url]) continue;
    var host = domainFromUrl(item.url);
    if (!host) continue;
    if (seenDomains[host]) continue;
    if (!isAllowedDomain(host)) {
      deferred.push(item);
      continue;
    }
    var excerpt = item.content_markdown_if_any || item.snippet || "";
    evidence.push({
      url: item.url,
      title: item.title || host,
      source_domain: host,
      excerpt: truncate(excerpt, 240)
    });
    seenDomains[host] = true;
    seenUrls[item.url] = true;
  }
  if (evidence.length < MAX_SOURCES_PER_CLAIM && deferred.length) {
    for (var d = 0; d < deferred.length; d++) {
      if (evidence.length >= MAX_SOURCES_PER_CLAIM) break;
      var fallback = deferred[d] || {};
      if (!fallback.url || seenUrls[fallback.url]) continue;
      var fallbackHost = domainFromUrl(fallback.url);
      if (!fallbackHost || seenDomains[fallbackHost]) continue;
      var fallbackExcerpt = fallback.content_markdown_if_any || fallback.snippet || "";
      evidence.push({
        url: fallback.url,
        title: fallback.title || fallbackHost,
        source_domain: fallbackHost,
        excerpt: truncate(fallbackExcerpt, 240)
      });
      seenDomains[fallbackHost] = true;
      seenUrls[fallback.url] = true;
    }
  }
  return evidence;
}

async function runFactCheck(opts) {
  var claims = Array.isArray(opts.claims) ? opts.claims : [];
  var ai = opts.ai;
  var model = opts.model;
  var logger = opts.logger || console;
  var freshness = opts.freshness || FRESHNESS_DEFAULT;

  var start = Date.now();
  var budget = createBudget();
  var sourceMatch = await checkSourceMatch({
    headline: opts.headline,
    freshness: freshness,
    budget: budget,
    logger: logger
  });

  var results = [];
  var budgetExceeded = false;
  var timeoutExceeded = false;

  for (var i = 0; i < claims.length; i++) {
    if (Date.now() - start > VERIFICATION_TIMEOUT_MS) {
      timeoutExceeded = true;
    }
    if (budgetExceeded || timeoutExceeded) {
      results.push({
        id: claims[i].id,
        claim: claims[i].claim,
        verdict: "Unverified",
        confidence: 20,
        key_evidence: [],
        reasoning_short: "Verification budget exceeded.",
        queries_used: [],
        notes: "verification budget exceeded"
      });
      continue;
    }

    var claim = claims[i];
    var queryList = normalizeQueries(claim);
    var queriesUsed = [];
    var aggregated = [];
    var claimId = claim.id || ("c" + i);

    for (var q = 0; q < queryList.length; q++) {
      if (!budget.canSpend(claimId)) {
        budgetExceeded = true;
        break;
      }
      if (Date.now() - start > VERIFICATION_TIMEOUT_MS) {
        timeoutExceeded = true;
        break;
      }

      var query = queryList[q];
      try {
        var result = await searchWeb(query, {
          count: RESULTS_PER_CLAIM,
          freshness: freshness,
          livecrawl: "all",
          livecrawl_formats: "markdown",
          allowlist_version: ALLOWLIST_VERSION
        }, {
          budget: budget,
          claimId: claimId,
          logger: logger
        });
        queriesUsed.push(query);
        if (result.results && result.results.length) {
          aggregated = aggregated.concat(result.results);
        }
      } catch (err) {
        if (logger && logger.warn) {
          logger.warn("You.com search failed:", err.message || err);
        }
      }
    }

    if (budgetExceeded || timeoutExceeded) {
      results.push({
        id: claim.id,
        claim: claim.claim,
        verdict: "Unverified",
        confidence: 20,
        key_evidence: [],
        reasoning_short: "Verification budget exceeded.",
        queries_used: queriesUsed,
        notes: "verification budget exceeded"
      });
      continue;
    }

    var evidence = collectEvidence(aggregated);

    if (!aggregated.length) {
      results.push({
        id: claim.id,
        claim: claim.claim,
        verdict: "Unverified",
        confidence: 25,
        key_evidence: [],
        reasoning_short: "No search results returned.",
        queries_used: queriesUsed,
        notes: ""
      });
      continue;
    }

    var allowedSourcesText =
      "Allowed TLDs: " + ALLOWED_SOURCE_TLDS.join(", ") + "\n" +
      "Top news domains: " + TOP_NEWS_DOMAINS.join(", ");

    var verdictResult = await evaluateVerdict(ai, model, claim.claim, aggregated, allowedSourcesText);
    var confidence = computeConfidence(verdictResult.verdict, verdictResult.directness, evidence);
    results.push({
      id: claim.id,
      claim: claim.claim,
      verdict: verdictResult.verdict,
      confidence: confidence,
      key_evidence: evidence,
      reasoning_short: verdictResult.reasoning_short || "Verdict determined from evidence.",
      queries_used: queriesUsed,
      notes: ""
    });

  }

  var runtime = Date.now() - start;
  if (logger && logger.log) {
    logger.log("[FactCheck] queries_used=" + budget.totalUsed + "/" + MAX_RUN_QUERIES + " runtime_ms=" + runtime);
  }
  if ((budgetExceeded || timeoutExceeded) && logger && logger.warn) {
    logger.warn("[FactCheck] verification budget exceeded, remaining claims set to Unverified.");
  }

  return {
    source_match: sourceMatch,
    claims: results,
    meta: {
      queries_count: budget.totalUsed,
      runtime_ms: runtime
    }
  };
}

module.exports = {
  runFactCheck
};
