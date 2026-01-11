/*
  script.js — BiasLens UI (3-column redesign)

  What changed (vs legacy panel UI):
  - Replaced 4 debug-style panels with a clean 3-column layout:
      SCOUT (claim candidates) | ORACLE (verdict + pressure) | SPAR (live interaction)
  - Added dynamic loading states + a visible "agent" feed during inference
  - Added sample loader + Clear button + Ctrl+Enter shortcut
  - Removed legacy renderProsecutor/renderDefender/renderArena panel logic

  Notes:
  - This front-end does NOT do OSINT/web grounding yet.
    PROBE shows claim candidates only (unverified). The backend still returns
    prosecutor/defender/judge.
*/

// -------------------------
// CONFIG
// -------------------------

// Change this if you run the backend locally:
// var API_URL = "http://localhost:3000/analyze";
var API_URL = "https://news-bias-analyzer.onrender.com/analyze";

// -------------------------
// ELEMENTS
// -------------------------

function el(id) { return document.getElementById(id); }

var headlineEl = el("headline");
var articleEl = el("article");

var btnAnalyze = el("analyzeBtn");
var btnDemo = el("demoBtn");
var btnClear = el("clearBtn");

var statusPill = el("statusPill");
var statusEl = el("status");

var groundContent = el("groundContent");
var dynamicsFeed = el("dynamicsFeed");

var verdictEl = el("verdict");
var verdictSubEl = el("verdictSub");

var pressureWrap = el("pressureWrap");
var pressureBar = el("pressureBar");
var pressureLabel = el("pressureLabel");

var coreCard = el("coreCard");
var keyFactorEl = el("keyFactor");
var synthesisReasonEl = el("synthesisReason");

// -------------------------
// UTIL
// -------------------------

function escapeHTML(s) {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function nowTime() {
  try { return new Date().toLocaleTimeString(); }
  catch(e) { return ""; }
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function setBusy(isBusy, msg, kind) {
  btnAnalyze.disabled = !!isBusy;
  btnDemo.disabled = !!isBusy;
  btnClear.disabled = !!isBusy;

  statusEl.textContent = msg || (isBusy ? "Running" : "Idle");

  statusPill.classList.remove("running", "error");
  if (isBusy) statusPill.classList.add("running");
  if (kind === "error") statusPill.classList.add("error");
}

function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

// -------------------------
// FEED (DUEL)
// -------------------------

function clearFeed() {
  dynamicsFeed.innerHTML = "";
}

function feedMsg(role, title, htmlBody) {
  var wrap = document.createElement("div");
  wrap.className = "msg " + role;

  wrap.innerHTML =
    "<div class='meta'>" +
      "<span class='tag'>" + escapeHTML(title) + "</span>" +
      "<span class='time'>" + escapeHTML(nowTime()) + "</span>" +
    "</div>" +
    "<div class='body'>" + htmlBody + "</div>";

  dynamicsFeed.appendChild(wrap);
  dynamicsFeed.scrollTop = dynamicsFeed.scrollHeight;
}

function feedSystem(text) {
  feedMsg("sys", "SYSTEM", "<div class='line'>" + escapeHTML(text) + "</div>");
}

function feedEdge(quote, reason) {
  var q = quote ? "<div class='quote'>\"" + escapeHTML(quote) + "\"</div>" : "";
  var r = reason ? "<div class='line'>" + escapeHTML(reason) + "</div>" : "";
  // Label is user-facing; CSS class remains .edge
  feedMsg("edge", "SKEPTIC", q + r);
}

function feedAnchor(counterQuote, reason, empty) {
  if (empty) {
    // Label is user-facing; CSS class remains .anchor
    feedMsg("anchor", "STEELMAN", "<div class='muted'>No counter-signal found for this point.</div>");
    return;
  }
  var q = counterQuote ? "<div class='quote'>\"" + escapeHTML(counterQuote) + "\"</div>" : "";
  var r = reason ? "<div class='line'>" + escapeHTML(reason) + "</div>" : "";
  feedMsg("anchor", "STEELMAN", q + r);
}

// Loading animation line while backend runs
var thinkingTimer = null;
var thinkingPhase = 0;
var pingTimer = null;
var pingPhase = 0;

function stopPings() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function startPings() {
  stopPings();
  pingPhase = 0;

  // These are intentionally generic. They create "live" interaction while the backend runs
  // (Render can take 10–20s). The real duel is replayed once results return.
  var script = [
    { role: "edge",   title: "SKEPTIC",  text: "Scanning for framing signals…" },
    { role: "anchor", title: "STEELMAN", text: "Preparing counter-context…" },
    { role: "edge",   title: "SKEPTIC",  text: "Flagging loaded phrases / asymmetry…" },
    { role: "anchor", title: "STEELMAN", text: "Searching for balancing evidence…" },
    { role: "sys",    title: "SYSTEM",   text: "ORACLE warming up (synthesis)…" }
  ];

  pingTimer = setInterval(function () {
    var step = script[pingPhase % script.length];
    var body = "<div class='line muted'>" + escapeHTML(step.text) + "</div>";
    feedMsg(step.role === "sys" ? "sys" : step.role, step.title, body);
    pingPhase++;
  }, 950);
}
function startThinking() {
  stopThinking();
  stopPings();
  thinkingPhase = 0;
  feedSystem("Session opened. Initializing agents…");

  var line = document.createElement("div");
  line.className = "msg sys";
  line.innerHTML =
    "<div class='meta'><span class='tag'>SYSTEM</span><span class='time'>" + escapeHTML(nowTime()) + "</span></div>" +
    "<div class='body'><div class='line' id='thinkingLine'>Booting analysis</div></div>";

  dynamicsFeed.appendChild(line);

  thinkingTimer = setInterval(function () {
    var elLine = document.getElementById("thinkingLine");
    if (!elLine) return;

    var dots = ".".repeat((thinkingPhase % 4));
    var text = "Booting analysis";
    if (thinkingPhase > 2) text = "Scanning rhetorical pressure";
    if (thinkingPhase > 7) text = "Generating counter-context";
    if (thinkingPhase > 12) text = "Synthesizing verdict";

    elLine.textContent = text + dots;
    thinkingPhase++;
  }, 350);

  // Kick off a light "live" stream while waiting on the network.
  startPings();
}

function stopThinking() {
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }
  stopPings();
  var elLine = document.getElementById("thinkingLine");
  if (elLine) elLine.removeAttribute("id");
}

// -------------------------
// PROBE (claim candidates)
// -------------------------

function splitSentences(text) {
  // Sentence-ish split without lookbehind (works everywhere)
  var cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  var matches = cleaned.match(/[^.!?]+[.!?]+(?:\s+|$)/g);
  var parts = matches ? matches : [cleaned];

  return parts
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length >= 40; });
}

function scoreClaimCandidate(s) {
  var score = 0;
  if (/[0-9]/.test(s)) score += 2;
  if (/\b(said|says|announced|voted|approved|reported|according to)\b/i.test(s)) score += 2;
  if (/\b(\d{4})\b/.test(s)) score += 1;
  if (/\b(UN|U\.S\.|EU|Senate|Congress|Reuters|NATO|Court|Ministry)\b/.test(s)) score += 1;
  return score;
}

function pickClaimCandidates(articleText, maxN) {
  var sents = splitSentences(articleText);
  if (sents.length === 0) return [];

  // Score & pick top
  var scored = sents.map(function (s) {
    return { s: s, score: scoreClaimCandidate(s) };
  });
  scored.sort(function (a, b) { return b.score - a.score; });

  var picked = [];
  for (var i = 0; i < scored.length && picked.length < maxN; i++) {
    // avoid super-long wall-of-text claims
    if (scored[i].s.length > 320) continue;
    picked.push(scored[i].s);
  }

  // If scoring filtered too much, just take the first N
  if (picked.length === 0) {
    picked = sents.slice(0, maxN);
  }

  return picked;
}

function renderProbe(articleText) {
  var claims = pickClaimCandidates(articleText, 3);

  var html = "";
  html += "<div class='probe-note'>" +
    "<div class='probe-title'>No external verification enabled</div>" +
    "<div class='probe-sub'>This build surfaces checkable claim candidates only (unverified). OSINT grounding is a planned module.</div>" +
  "</div>";

  if (claims.length === 0) {
    html += "<div class='probe-empty'>No claim candidates found. Paste a longer article.</div>";
    groundContent.innerHTML = html;
    return;
  }

  for (var i = 0; i < claims.length; i++) {
    html += "<div class='claim'>";
    html += "  <div class='claim-head'>";
    html += "    <div class='claim-label'>CLAIM CANDIDATE " + (i + 1) + "</div>";
    html += "    <div class='claim-badge'>UNVERIFIED</div>";
    html += "  </div>";
    html += "  <div class='claim-body'>" + escapeHTML(claims[i]) + "</div>";
    html += "  <div class='claim-foot'>Suggested check: official statement / transcript / reputable wire copy</div>";
    html += "</div>";
  }

  groundContent.innerHTML = html;
}

// -------------------------
// CORE (verdict + pressure)
// -------------------------

function computeNarrativePressure(prosecutor, defender, judge) {
  // A simple, stable index for demos.
  // (When you add a scored-judge, swap this to the judge's pressure.)
  var base = 50;

  var pCount = (prosecutor && prosecutor.evidence) ? prosecutor.evidence.length : 0;
  var dCount = (defender && defender.rebuttals) ? defender.rebuttals.length : 0;

  base += pCount * 6; // prosecutorial flags increase pressure
  base -= dCount * 4; // rebuttals reduce pressure

  if (judge && judge.winner === "biased") base += 10;
  if (judge && judge.winner === "neutral") base -= 10;

  return Math.round(clamp(base, 0, 100));
}

function renderCore(judge, pressure) {
  var w = (judge && judge.winner) ? String(judge.winner).toUpperCase() : "—";

  verdictEl.textContent = w;
  // CSS uses .verdict.neutral / .verdict.biased
  verdictEl.classList.remove("neutral", "biased");
  if (w === "NEUTRAL") verdictEl.classList.add("neutral");
  if (w === "BIASED") verdictEl.classList.add("biased");

  verdictSubEl.textContent = (judge && judge.key_factor) ? String(judge.key_factor) : "";

  pressureWrap.style.display = "block";
  pressureBar.style.width = pressure + "%";
  pressureLabel.textContent = pressure + " / 100";

  coreCard.style.display = "block";
  keyFactorEl.textContent = (judge && judge.key_factor) ? String(judge.key_factor) : "Key factor";
  synthesisReasonEl.textContent = (judge && judge.reason) ? String(judge.reason) : "";
}

function resetCore() {
  verdictEl.textContent = "—";
  verdictEl.classList.remove("neutral", "biased");
  verdictSubEl.textContent = "Run an analysis to generate a verdict.";

  pressureWrap.style.display = "none";
  pressureBar.style.width = "0%";
  pressureLabel.textContent = "0 / 100";

  coreCard.style.display = "none";
  keyFactorEl.textContent = "—";
  synthesisReasonEl.textContent = "";
}

// -------------------------
// DUEL playback
// -------------------------

function findRebuttalForQuote(defender, quote) {
  if (!defender || !Array.isArray(defender.rebuttals)) return null;
  for (var i = 0; i < defender.rebuttals.length; i++) {
    if (String(defender.rebuttals[i].prosecutor_quote) === String(quote)) return defender.rebuttals[i];
  }
  return null;
}

async function playbackDuel(prosecutor, defender, judge) {
  // Clean feed (but keep the "session opened" context if you want)
  clearFeed();

  feedSystem("Agents online: SKEPTIC (framing signals) vs STEELMAN (counter-context)");

  if (!prosecutor || !Array.isArray(prosecutor.evidence) || prosecutor.evidence.length === 0) {
    feedSystem("No prosecutor evidence returned.");
    return;
  }

  for (var i = 0; i < prosecutor.evidence.length; i++) {
    var p = prosecutor.evidence[i] || {};
    var rebut = findRebuttalForQuote(defender, p.quote);

    await sleep(250);
    feedEdge(p.quote, p.reason);

    await sleep(320);
    if (rebut) {
      feedAnchor(rebut.counter_quote, rebut.reason, false);
    } else {
      // fallback: try index-match if exact quote match failed
      if (defender && Array.isArray(defender.rebuttals) && defender.rebuttals[i]) {
        var ri = defender.rebuttals[i];
        feedAnchor(ri.counter_quote, ri.reason, false);
      } else {
        feedAnchor("", "", true);
      }
    }
  }

  await sleep(220);
  var final = (judge && judge.winner) ? String(judge.winner).toUpperCase() : "—";
  feedSystem("Synthesis complete: " + final);
}

// -------------------------
// MAIN
// -------------------------

function clearAll() {
  headlineEl.value = "";
  articleEl.value = "";
  groundContent.innerHTML = "Paste an article and hit Analyze.";
  clearFeed();
  resetCore();
  setBusy(false, "Idle");
}

var SAMPLE = {
  headline: "Tech giant faces scrutiny over 'independent' research program",
  article:
    "A major technology company said Saturday that its research grants program is fully independent after critics questioned whether the funding influences public policy debates. " +
    "The company announced it would expand the program by 25% this year, describing the effort as a way to support open inquiry and innovation. " +
    "Several academics who previously received grants said the funding came with no formal restrictions, but some noted that researchers may still avoid topics that could strain relationships with sponsors. " +
    "A spokesperson said the company does not review findings before publication and does not require researchers to reach specific conclusions. " +
    "However, advocacy groups said the company frequently highlights favorable studies while downplaying research that raises concerns about market power and privacy. " +
    "The company said it publishes a public list of grants and welcomes criticism, adding that its products have 'dramatically improved' people's lives. " +
    "Regulators in multiple jurisdictions have increased oversight of the technology sector in recent years, and lawmakers have called for clearer rules around funding disclosures. " +
    "Analysts said the debate reflects a broader tension between private sponsorship and public trust, and that transparency is likely to remain a central issue."
};

async function analyze() {
  var headline = (headlineEl.value || "").trim();
  var article = (articleEl.value || "").trim();

  if (!headline || !article) {
    alert("Please paste both headline and article text.");
    return;
  }

  // Reset UI for new run
  renderProbe(article);
  resetCore();
  clearFeed();

  setBusy(true, "Running agents…");
  startThinking();

  var t0 = Date.now();

  try {
    var response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headline: headline, article: article })
    });

    var data = await response.json();
    stopThinking();

    if (!response.ok) {
      setBusy(false, "Error", "error");
      clearFeed();
      feedSystem("Backend returned an error.");
      feedMsg("sys", "ERROR", "<div class='line'>" + escapeHTML(data.error || "Request failed") + "</div>");
      if (data.details) {
        feedMsg("sys", "DETAILS", "<div class='line'>" + escapeHTML(String(data.details).slice(0, 800)) + "</div>");
      }
      return;
    }

    // CORE
    var pressure = computeNarrativePressure(data.prosecutor, data.defender, data.judge);
    renderCore(data.judge, pressure);

    // DUEL playback (interleaved)
    await playbackDuel(data.prosecutor, data.defender, data.judge);

    // Status
    var dt = ((Date.now() - t0) / 1000).toFixed(1);
    setBusy(false, "Done in " + dt + "s");

  } catch (err) {
    stopThinking();
    setBusy(false, "Network error", "error");
    clearFeed();
    feedSystem("Network error reaching backend.");
    feedMsg("sys", "HINT", "<div class='line'>If you're using Render, the service may be sleeping. Try again in 10–20s.</div>");
  }
}

btnAnalyze.addEventListener("click", function () {
  analyze();
});

btnDemo.addEventListener("click", function () {
  headlineEl.value = SAMPLE.headline;
  articleEl.value = SAMPLE.article;
  setBusy(false, "Sample loaded");
});

btnClear.addEventListener("click", function () {
  clearAll();
});

// Ctrl + Enter shortcut
document.addEventListener("keydown", function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    analyze();
  }
});

// First paint
clearAll();
