var API_URL = "https://news-bias-analyzer.onrender.com/analyze";

var btn = document.getElementById("analyzeBtn");
var demoBtn = document.getElementById("demoBtn");
var clearBtn = document.getElementById("clearBtn");
var statusEl = document.getElementById("status");

var realityContent = document.getElementById("realityContent");

var verdictEl = document.getElementById("verdict");
var pressureBar = document.getElementById("pressureBar");
var pressureLabel = document.getElementById("pressureLabel");
var synthesisReason = document.getElementById("synthesisReason");
var keyFactor = document.getElementById("keyFactor");

var prevBtn = document.getElementById("prevCard");
var nextBtn = document.getElementById("nextCard");
var cardHost = document.getElementById("cardHost");
var cardIndexEl = document.getElementById("cardIndex");
var cardTotalEl = document.getElementById("cardTotal");

var _cards = [];
var _idx = 0;

function escapeHTML(s) {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setLoading(isLoading, msg) {
  btn.disabled = isLoading;
  demoBtn.disabled = isLoading;
  clearBtn.disabled = isLoading;
  prevBtn.disabled = isLoading || (_cards.length <= 1);
  nextBtn.disabled = isLoading || (_cards.length <= 1);

  statusEl.textContent = isLoading ? (msg || "Analyzing...") : "";
}

function resetUI() {
  verdictEl.textContent = "—";
  pressureBar.style.width = "0%";
  pressureLabel.textContent = "—";
  synthesisReason.textContent = "—";
  synthesisReason.classList.add("muted");
  keyFactor.textContent = "—";
  keyFactor.classList.add("muted");

  realityContent.innerHTML = "<div class='muted'>Paste an article and run analysis. Claim candidates will appear here.</div>";

  _cards = [];
  _idx = 0;
  renderCardHostEmpty();
  updateNav();
}

function renderCardHostEmpty() {
  cardHost.innerHTML =
    "<div class='card empty'>" +
      "<div class='empty-title'>No cards yet</div>" +
      "<div class='empty-sub'>Run an analysis to generate paired Signal → Counter cards.</div>" +
    "</div>";
  cardIndexEl.textContent = "0";
  cardTotalEl.textContent = "0";
}

function updateNav() {
  var total = _cards.length;
  cardTotalEl.textContent = String(total);
  cardIndexEl.textContent = total ? String(_idx + 1) : "0";
  prevBtn.disabled = (total <= 1) || (_idx <= 0);
  nextBtn.disabled = (total <= 1) || (_idx >= total - 1);
}

function buildRebuttalMap(defender) {
  var map = {};
  if (!defender || !Array.isArray(defender.rebuttals)) return map;

  for (var i = 0; i < defender.rebuttals.length; i++) {
    var r = defender.rebuttals[i];
    if (r && r.prosecutor_quote) map[r.prosecutor_quote] = r;
  }
  return map;
}

function extractClaimCandidates(articleText) {
  // Lightweight claim candidates (no OSINT):
  // pick 3–6 sentences that look "checkable": numbers, dates, named entities-like patterns.
  var text = (articleText || "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  // Split into sentences (simple heuristic)
  var sentences = text.split(/(?<=[.?!])\s+/).filter(Boolean);

  var scored = [];
  for (var i = 0; i < sentences.length; i++) {
    var s = sentences[i].trim();
    if (s.length < 60) continue;

    var score = 0;
    if (/\b\d{4}\b/.test(s)) score += 2;                 // year
    if (/\b\d+(\.\d+)?\b/.test(s)) score += 2;           // numbers
    if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(s)) score += 2; // month
    if (/[A-Z][a-z]+ [A-Z][a-z]+/.test(s)) score += 1;   // "First Last"
    if (/\b(said|announced|reported|voted|arrested|killed|signed|approved)\b/i.test(s)) score += 1;

    scored.push({ s: s, score: score });
  }

  scored.sort(function(a, b){ return b.score - a.score; });

  var out = [];
  for (var j = 0; j < scored.length && out.length < 5; j++) {
    if (scored[j].score >= 3) out.push(scored[j].s);
  }

  return out;
}

function renderReality(articleText) {
  var claims = extractClaimCandidates(articleText);
  if (!claims.length) {
    realityContent.innerHTML = "<div class='muted'>No strong claim candidates detected. (This is normal for opinion-heavy articles.)</div>";
    return;
  }

  var html = "";
  for (var i = 0; i < claims.length; i++) {
    html +=
      "<div class='block' style='margin-bottom:10px;'>" +
        "<div class='block-head'>" +
          "<div class='block-title'>Claim candidate</div>" +
          "<div class='badge'>UNVERIFIED</div>" +
        "</div>" +
        "<div class='quote'>" + escapeHTML(claims[i]) + "</div>" +
        "<div class='reason'>This looks checkable (numbers/dates/entities). External verification module not enabled yet.</div>" +
      "</div>";
  }
  realityContent.innerHTML = html;
}

function computeNarrativeLoad(prosecutor, defender, judge) {
  // Keep simple and stable. This replaces your old "framing pressure" branding.
  var base = 45;

  var pCount = (prosecutor && prosecutor.evidence) ? prosecutor.evidence.length : 0;
  var dCount = (defender && defender.rebuttals) ? defender.rebuttals.length : 0;

  base += pCount * 7;   // stronger weight for flags
  base -= dCount * 6;   // stronger reduction for counters

  if (judge && judge.winner === "biased") base += 8;
  if (judge && judge.winner === "neutral") base -= 8;

  if (base < 0) base = 0;
  if (base > 100) base = 100;
  return Math.round(base);
}

function renderSynthesis(prosecutor, defender, judge) {
  if (!judge) {
    verdictEl.textContent = "—";
    synthesisReason.textContent = "Invalid judge output.";
    synthesisReason.classList.remove("muted");
    return;
  }

  verdictEl.textContent = (judge.winner || "—").toUpperCase();

  var load = computeNarrativeLoad(prosecutor, defender, judge);
  pressureBar.style.width = load + "%";
  pressureLabel.textContent = load + " / 100";

  keyFactor.textContent = (judge.key_factor || "—");
  keyFactor.classList.remove("muted");

  synthesisReason.textContent = (judge.reason || "—");
  synthesisReason.classList.remove("muted");
}

function buildCards(prosecutor, defender) {
  var cards = [];

  if (!prosecutor || !Array.isArray(prosecutor.evidence)) return cards;

  var rebutMap = buildRebuttalMap(defender);

  for (var i = 0; i < prosecutor.evidence.length; i++) {
    var p = prosecutor.evidence[i] || {};
    var rebut = rebutMap[p.quote] || null;

    cards.push({
      idx: i + 1,
      signal_quote: p.quote || "",
      signal_reason: p.reason || "",
      counter_quote: rebut ? (rebut.counter_quote || "") : "",
      counter_reason: rebut ? (rebut.reason || "") : ""
    });
  }

  return cards;
}

function renderCard(i) {
  if (!_cards.length) {
    renderCardHostEmpty();
    return;
  }

  var c = _cards[i];

  var counterMissing = (!c.counter_quote && !c.counter_reason);

  cardHost.innerHTML =
    "<div class='card'>" +

      "<div class='block'>" +
        "<div class='block-head'>" +
          "<div class='block-title'>Signal</div>" +
          "<div class='badge'>#" + c.idx + "</div>" +
        "</div>" +
        "<div class='quote'>“" + escapeHTML(c.signal_quote) + "”</div>" +
        "<div class='reason'>" + escapeHTML(c.signal_reason) + "</div>" +
      "</div>" +

      "<div class='block'>" +
        "<div class='block-head'>" +
          "<div class='block-title'>Counter</div>" +
          "<div class='badge'>" + (counterMissing ? "NONE" : "MATCHED") + "</div>" +
        "</div>" +
        (counterMissing
          ? "<div class='quote'>No counter provided for this signal.</div><div class='reason'>Defense did not directly address this quote.</div>"
          : "<div class='quote'>“" + escapeHTML(c.counter_quote) + "”</div><div class='reason'>" + escapeHTML(c.counter_reason) + "</div>"
        ) +
      "</div>" +

    "</div>";

  _idx = i;
  updateNav();
}

function gotoPrev() {
  if (_idx > 0) renderCard(_idx - 1);
}

function gotoNext() {
  if (_idx < _cards.length - 1) renderCard(_idx + 1);
}

prevBtn.addEventListener("click", gotoPrev);
nextBtn.addEventListener("click", gotoNext);

document.addEventListener("keydown", function(e){
  // Left/right navigation
  if (e.key === "ArrowLeft") gotoPrev();
  if (e.key === "ArrowRight") gotoNext();

  // Ctrl+Enter to analyze
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analyze();
});

clearBtn.addEventListener("click", function(){
  document.getElementById("headline").value = "";
  document.getElementById("article").value = "";
  resetUI();
});

demoBtn.addEventListener("click", function(){
  // Keep it safe + short. Replace with your preferred Reuters sample if you want.
  document.getElementById("headline").value =
    "City council votes on new housing ordinance amid protests";
  document.getElementById("article").value =
    "The city council voted 6-3 on Saturday to approve a new housing ordinance that supporters say will increase supply, while critics argue it could accelerate displacement. " +
    "Outside city hall, several hundred demonstrators gathered, chanting and holding signs. " +
    "Officials said the policy includes tenant protections and a phased rollout over 18 months. " +
    "A coalition of neighborhood groups said the ordinance favors developers and called for a referendum. " +
    "The mayor’s office said it expects the measure to reduce rent pressure over time, though economists cautioned results may vary by district.";
});

async function analyze() {
  var headline = document.getElementById("headline").value.trim();
  var article = document.getElementById("article").value.trim();

  if (!headline || !article) {
    alert("Please paste both headline and article text.");
    return;
  }

  setLoading(true, "Running agents...");
  resetUI();

  // Show early claim candidates immediately (feels “alive”)
  renderReality(article);

  // Temporary card placeholder during inference
  cardHost.innerHTML =
    "<div class='card empty'>" +
      "<div class='empty-title'>Analyzing…</div>" +
      "<div class='empty-sub'>Generating paired Signal → Counter cards.</div>" +
    "</div>";

  try {
    var resp = await fetch(API_URL, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ headline: headline, article: article })
    });

    var data = await resp.json();

    if (!resp.ok) {
      verdictEl.textContent = "ERROR";
      synthesisReason.textContent = (data && data.error) ? data.error : "Request failed.";
      synthesisReason.classList.remove("muted");
      renderCardHostEmpty();
      setLoading(false, "");
      return;
    }

    // Build ordered cards (prosecutor order preserved)
    _cards = buildCards(data.prosecutor, data.defender);
    _idx = 0;

    if (_cards.length) renderCard(0);
    else renderCardHostEmpty();

    // Synthesis
    renderSynthesis(data.prosecutor, data.defender, data.judge);

    setLoading(false, "");
  } catch (err) {
    verdictEl.textContent = "ERROR";
    synthesisReason.textContent = "Backend error or CORS issue.";
    synthesisReason.classList.remove("muted");
    renderCardHostEmpty();
    setLoading(false, "");
  }
}

// Button hook
btn.addEventListener("click", analyze);

// Initialize
resetUI();