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
var factcheckSummary = document.getElementById("factcheckSummary");

var prevBtn = document.getElementById("prevCard");
var nextBtn = document.getElementById("nextCard");
var cardHost = document.getElementById("cardHost");
var cardIndexEl = document.getElementById("cardIndex");
var cardTotalEl = document.getElementById("cardTotal");
var sourceMatchEl = document.getElementById("sourceMatch");

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
  if (sourceMatchEl) sourceMatchEl.disabled = isLoading;

  statusEl.textContent = isLoading ? (msg || "Analyzing...") : "";
}

function resetUI() {
  verdictEl.textContent = "\u2014";
  pressureBar.style.width = "0%";
  pressureLabel.textContent = "\u2014";
  synthesisReason.textContent = "\u2014";
  synthesisReason.classList.add("muted");
  keyFactor.textContent = "\u2014";
  keyFactor.classList.add("muted");
  if (factcheckSummary) {
    factcheckSummary.textContent = "\u2014";
    factcheckSummary.classList.add("muted");
  }

  realityContent.innerHTML = "<div class='muted'>Paste an article and run analysis. Fact-checked claims will appear here.</div>";
  realityContent.classList.add("muted");

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

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function getVerdictClass(verdict) {
  var v = String(verdict || "").toLowerCase();
  if (v === "supported") return "supported";
  if (v === "contradicted") return "contradicted";
  return "unverified";
}

function renderSourceMatchBadge(sourceMatch, container) {
  if (!sourceMatch || sourceMatch.status !== "matched" || !sourceMatch.canonical_url) return;

  var badge = document.createElement("div");
  badge.className = "source-match";

  var label = document.createElement("span");
  label.textContent = "Matched Source";

  var link = document.createElement("a");
  link.href = sourceMatch.canonical_url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = (sourceMatch.source && sourceMatch.source.toLowerCase() === "ap") ? "AP" : "Reuters";

  badge.appendChild(label);
  badge.appendChild(link);
  container.appendChild(badge);
}

function buildFactcheckCard(item) {
  var verdictClass = getVerdictClass(item.verdict);
  var details = document.createElement("details");
  details.className = "fc-card fade";

  var summary = document.createElement("summary");
  var chip = document.createElement("span");
  chip.className = "fc-chip " + verdictClass;
  chip.textContent = (item.verdict || "Unverified").toUpperCase();

  var claimEl = document.createElement("div");
  claimEl.className = "fc-claim";
  claimEl.textContent = item.claim || "";

  summary.appendChild(chip);
  summary.appendChild(claimEl);
  details.appendChild(summary);

  var body = document.createElement("div");
  body.className = "fc-body";

  var confidence = Number(item.confidence);
  if (Number.isNaN(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(100, confidence));

  var confWrap = document.createElement("div");
  confWrap.className = "fc-confidence";

  var confLabel = document.createElement("div");
  confLabel.className = "fc-confidence-label";
  confLabel.textContent = "Confidence " + confidence + "%";

  var confBar = document.createElement("div");
  confBar.className = "fc-bar";

  var confFill = document.createElement("div");
  confFill.className = "fc-bar-fill " + verdictClass;
  confFill.style.width = confidence + "%";

  confBar.appendChild(confFill);
  confWrap.appendChild(confLabel);
  confWrap.appendChild(confBar);
  body.appendChild(confWrap);

  if (item.key_evidence && item.key_evidence.length) {
    var evidenceWrap = document.createElement("div");
    evidenceWrap.className = "fc-evidence";

    var evidenceLabel = document.createElement("div");
    evidenceLabel.className = "fc-section-label";
    evidenceLabel.textContent = "Evidence";
    evidenceWrap.appendChild(evidenceLabel);

    for (var i = 0; i < item.key_evidence.length; i++) {
      var ev = item.key_evidence[i] || {};
      if (!ev.url) continue;

      var link = document.createElement("a");
      link.className = "fc-link";
      link.href = ev.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = ev.title || ev.source_domain || "Source";

      var excerpt = document.createElement("span");
      excerpt.textContent = ev.excerpt || "";

      link.appendChild(excerpt);
      evidenceWrap.appendChild(link);
    }

    body.appendChild(evidenceWrap);
  }

  var whyLabel = document.createElement("div");
  whyLabel.className = "fc-section-label";
  whyLabel.textContent = "Why";

  var why = document.createElement("div");
  why.className = "fc-why";
  why.textContent = item.reasoning_short || "No reasoning provided.";

  if (item.notes) {
    var note = document.createElement("div");
    note.className = "fc-note";
    note.textContent = item.notes;
    why.appendChild(note);
  }

  body.appendChild(whyLabel);
  body.appendChild(why);

  details.appendChild(body);
  return details;
}

function renderFactcheckSequentially(claims, container) {
  if (!container || !claims.length) return;

  var i = 0;
  var firstDelay = randomBetween(1200, 1800);

  function showNext() {
    if (i >= claims.length) return;

    var card = buildFactcheckCard(claims[i]);
    container.appendChild(card);

    setTimeout(function() {
      card.classList.add("visible");
      i++;
      var nextDelay = randomBetween(1000, 2000);
      setTimeout(showNext, nextDelay);
    }, 120);
  }

  setTimeout(showNext, firstDelay);
}

function renderFactcheck(factcheck) {
  if (!factcheck || !Array.isArray(factcheck.claims) || !factcheck.claims.length) {
    realityContent.innerHTML = "<div class='muted'>No factcheck results returned.</div>";
    realityContent.classList.add("muted");
    return;
  }

  realityContent.innerHTML = "";
  realityContent.classList.remove("muted");

  renderSourceMatchBadge(factcheck.source_match, realityContent);
  renderFactcheckSequentially(factcheck.claims, realityContent);
}

function renderFactcheckSummary(factcheck) {
  if (!factcheckSummary) return;
  if (!factcheck || !Array.isArray(factcheck.claims) || !factcheck.claims.length) {
    factcheckSummary.textContent = "No factcheck results.";
    factcheckSummary.classList.add("muted");
    return;
  }

  var supported = 0;
  var contradicted = 0;
  var unverified = 0;

  for (var i = 0; i < factcheck.claims.length; i++) {
    var verdict = String(factcheck.claims[i].verdict || "").toLowerCase();
    if (verdict === "supported") supported++;
    else if (verdict === "contradicted") contradicted++;
    else unverified++;
  }

  var summary = "Supported " + supported + " / Contradicted " + contradicted + " / Unverified " + unverified;

  if (factcheck.source_match && factcheck.source_match.status === "matched") {
    var sourceLabel = (factcheck.source_match.source && factcheck.source_match.source.toLowerCase() === "ap") ? "AP" : "Reuters";
    summary += " | Matched source: " + sourceLabel;
  }

  factcheckSummary.textContent = summary;
  factcheckSummary.classList.remove("muted");
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

function renderSynthesis(prosecutor, defender, judge, factcheck) {
  if (!judge) {
    verdictEl.textContent = "—";
    synthesisReason.textContent = "Invalid judge output.";
    synthesisReason.classList.remove("muted");
    renderFactcheckSummary(factcheck);
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
  renderFactcheckSummary(factcheck);
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
  document.getElementById("headline").value =
    "Tens of thousands protest in Minneapolis over fatal ICE shooting [link to article: https://www.reuters.com/world/us/fatal-ice-shooting-minneapolis-activist-sets-stage-national-protests-2026-01-10/]";
  document.getElementById("article").value =
    "Minneapolis police estimate tens of thousands present at protests on Saturday\n" +
    "Mayor urges protesters to remain peaceful and not \"take the bait\" from Trump\n" +
    "Over 1,000 \"ICE Out\" rallies planned across U.S.\n" +
    "Minnesota Democrats denied access to ICE facility outside Minneapolis\n\n" +
    "MINNEAPOLIS, Jan 10 (Reuters) - Tens of thousands of people marched through Minneapolis on Saturday to decry the fatal shooting of a woman by a U.S. immigration agent, part of more than 1,000 rallies planned nationwide this weekend against the federal government's deportation drive.\n\n" +
    "The massive turnout in Minneapolis despite a whipping, cold wind underscores how the fatal shooting of 37-year-old Renee Good by an Immigration and Customs Enforcement officer on Wednesday has struck a chord, fueling protests in major cities and some towns. Minnesota's Democratic leaders and the administration of President Donald Trump, a Republican, have offered starkly different accounts of the incident.\n\n" +
    "Led by a team of Indigenous Mexican dancers, demonstrators in Minneapolis, which has a metropolitan population of 3.8 million, marched towards the residential street where Good was shot in her car.\n\n" +
    "The boisterous crowd, which the Minneapolis Police Department estimated in the tens of thousands, chanted Good's name and slogans such as \"Abolish ICE\" and \"No justice, no peace -- get ICE off our streets.\"\n\n" +
    "\"I'm insanely angry, completely heartbroken and devastated, and then just like longing and hoping that things get better,\" Ellison Montgomery, a 30-year-old protester, told Reuters.\n\n" +
    "Minnesota officials have called the shooting unjustified, pointing to bystander video they say showed Good's vehicle turning away from the agent as he fired. The Department of Homeland Security, which oversees ICE, has maintained that the agent acted in self-defense because Good, a volunteer in a community network that monitors and records ICE operations in Minneapolis, drove forward in the direction of the agent who then shot her, after another agent had approached the driver's side and told her to get out of the car.\n\n" +
    "The shooting on Wednesday came soon after some 2,000 federal officers were dispatched to the Minneapolis-St. Paul area in what DHS has called its largest operation ever, deepening a rift between the administration and Democratic leaders in the state.\n\n" +
    "Federal-state tensions escalated further on Thursday when a U.S. Border Patrol agent in Portland, Oregon, shot and wounded a man and woman in their car after an attempted vehicle stop. Using language similar to its description of the Minneapolis incident, DHS said the driver had tried to \"weaponize\" his vehicle and run over agents.\n\n" +
    "The two DHS-related shootings prompted a coalition of progressive and civil rights groups, including Indivisible and the American Civil Liberties Union, to plan more than 1,000 events under the banner \"ICE Out For Good\" on Saturday and Sunday. The rallies have been scheduled to end before nightfall to minimize the potential for violence.\n\n" +
    "In Philadelphia, protesters chanted \"ICE has got to go\" and \"No fascist USA,\" as they marched from City Hall to a rally outside a federal detention facility, according to the local ABC affiliate. In Manhattan, several hundred people carried anti-ICE signs as they walked past an immigration court where agents have arrested migrants following their hearings.\n\n" +
    "\"We demand justice for Renee, ICE out of our communities, and action from our elected leaders. Enough is enough,\" said Leah Greenberg, co-executive director of Indivisible.\n\n" +
    "Minnesota became a major flashpoint in the administration's efforts to deport millions of immigrants months before the Good shooting, with Trump criticizing its Democratic leaders amid a massive welfare fraud scandal involving some members of the large Somali-American community there.\n\n" +
    "Minneapolis Mayor Jacob Frey, a Democrat who has been critical of immigration agents and the shooting, told a press conference earlier on Saturday that the demonstrations have remained mostly peaceful and that anyone damaging property or engaging in unlawful activity would be arrested by police.\n\n" +
    "\"We will not counter Donald Trump's chaos with our own brand of chaos,\" Frey said. \"He wants us to take the bait.\"\n\n" +
    "More than 200 law enforcement officers were deployed Friday night to control protests that led to $6,000 in damage at the Depot Renaissance Hotel and failed attempts by some demonstrators to enter the Hilton Canopy Hotel, believed to house ICE agents, the City of Minneapolis said in a statement.\n\n" +
    "Police Chief Brian O'Hara said some in the crowd scrawled graffiti and damaged windows at the Depot Renaissance Hotel. He said the gathering at the Hilton Canopy Hotel began as a \"noise protest\" but escalated as more than 1,000 demonstrators converged on the site, leading to 29 arrests.\n\n" +
    "\"We initiated a plan and took our time to de-escalate the situation, issued multiple warnings, declaring an unlawful assembly, and ultimately then began to move in and disperse the crowd,\" O'Hara said.\n\n" +
    "Three Minnesota congressional Democrats showed up at a regional ICE headquarters near Minneapolis on Saturday morning but were denied access. Legislators called the denial illegal.\n\n" +
    "\"We made it clear to ICE and DHS that they were violating federal law,\" U.S. Representative Angie Craig told reporters as she stood outside the Whipple Federal Building in St. Paul with Representatives Kelly Morrison and Ilhan Omar.\n\n" +
    "Federal law prohibits DHS from blocking members of Congress from entering ICE detention sites, but DHS has increasingly restricted such oversight visits, prompting confrontations with Democratic lawmakers.\n\n" +
    "\"It is our job as members of Congress to make sure those detained are treated with humanity, because we are the damn United States of America,\" Craig said.\n\n" +
    "Referencing the damage and protests at Minneapolis hotels overnight, DHS spokesperson Tricia McLaughlin said the congressional Democrats were denied entry to ensure \"the safety of detainees and staff, and in compliance with the agency's mandate.\" She said DHS policies require members of Congress to notify ICE at least seven days in advance of facility visits.";
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
      body: JSON.stringify({ headline: headline, article: article, source_hint: (sourceMatchEl ? sourceMatchEl.value : "") })
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

    renderFactcheck(data.factcheck);

    // Build ordered cards (prosecutor order preserved)
    _cards = buildCards(data.prosecutor, data.defender);
    _idx = 0;

    if (_cards.length) renderCard(0);
    else renderCardHostEmpty();

    // Synthesis
    renderSynthesis(data.prosecutor, data.defender, data.judge, data.factcheck);

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
