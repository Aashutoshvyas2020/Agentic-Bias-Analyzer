var API_URL = (typeof window !== "undefined" && window.API_URL) ? window.API_URL : "https://news-bias-analyzer.onrender.com/analyze";

var btn;
var demoBtn;
var clearBtn;
var statusEl;
var statusBar;
var statusFill;

var verificationHost;
var prevVerifyBtn;
var nextVerifyBtn;
var verifyIndexEl;
var verifyTotalEl;

var verdictEl;
var pressureBar;
var pressureLabel;
var synthesisReason;
var keyFactor;
var keyFactorBlock;
var synthesisReasonBlock;
var factcheckSummary;
var logList;

var prevBtn;
var nextBtn;
var cardHost;
var cardIndexEl;
var cardTotalEl;

var _analysisCards = [];
var _analysisIdx = 0;
var _analysisAvailable = 0;
var _analysisTimers = [];

var _verifyCards = [];
var _verifyIdx = 0;
var _verifyAvailable = 0;
var _verifyTimers = [];

var _progressTimer = null;
var _progressRunId = "";
var _progressIndex = 0;

var _statusTimer = null;
var _statusProgressTimer = null;
var _statusProgress = 0;
var _statusMessageIdx = 0;
var _statusMessages = [
  "Extracting claims...",
  "Scanning sources...",
  "Cross-checking details...",
  "Weighing analysis...",
  "Synthesizing summary..."
];

var _initialized = false;

function escapeHTML(s) {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function applyReplacementCase(match, replacement) {
  if (!match) return replacement;
  if (match.toUpperCase() === match) return replacement.toUpperCase();
  if (match[0] && match[0].toUpperCase() === match[0]) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function sanitizeCopy(text) {
  if (text === undefined || text === null) return "";
  var str = String(text);
  var rules = [
    { re: /\bprosecutor(s)?\b/gi, val: "analyst" },
    { re: /\bprosecution\b/gi, val: "analyst" },
    { re: /\bdefender(s)?\b/gi, val: "analyst" },
    { re: /\bdefense\b/gi, val: "analyst" },
    { re: /\bdefendant(s)?\b/gi, val: "analyst" },
    { re: /\bjudge(s)?\b/gi, val: "synthesis" },
    { re: /\bcourtroom\b/gi, val: "analysis" },
    { re: /\btrial\b/gi, val: "analysis" },
    { re: /\badjudication\b/gi, val: "analysis" },
    { re: /\bcross[- ]examination\b/gi, val: "analysis" }
  ];

  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    str = str.replace(rule.re, function(match) {
      return applyReplacementCase(match, rule.val);
    });
  }

  return str;
}

function domainFromUrl(url) {
  try {
    var parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch (err) {
    return "";
  }
}

function setLoading(isLoading, msg) {
  btn.disabled = isLoading;
  demoBtn.disabled = isLoading;
  clearBtn.disabled = isLoading;

  prevVerifyBtn.disabled = isLoading || (_verifyAvailable <= 1);
  nextVerifyBtn.disabled = isLoading || (_verifyAvailable <= 1);

  prevBtn.disabled = isLoading || (_analysisAvailable <= 1);
  nextBtn.disabled = isLoading || (_analysisAvailable <= 1);

  if (isLoading) {
    startLoadingStatus(msg || "Analyzing...");
  } else {
    stopLoadingStatus();
  }
}

function clearTimers(list) {
  while (list.length) {
    clearTimeout(list.pop());
  }
}

function clearStatusTimers() {
  if (_statusTimer) {
    clearInterval(_statusTimer);
    _statusTimer = null;
  }
  if (_statusProgressTimer) {
    clearInterval(_statusProgressTimer);
    _statusProgressTimer = null;
  }
}

function startLoadingStatus(initialMsg) {
  if (!statusEl) return;
  clearStatusTimers();
  _statusProgress = 8;
  _statusMessageIdx = 0;

  if (statusBar) statusBar.classList.add("active");
  if (statusFill) statusFill.style.width = _statusProgress + "%";

  statusEl.textContent = initialMsg || _statusMessages[0];

  _statusTimer = setInterval(function() {
    _statusMessageIdx = (_statusMessageIdx + 1) % _statusMessages.length;
    statusEl.textContent = _statusMessages[_statusMessageIdx];
  }, 1400);

  _statusProgressTimer = setInterval(function() {
    if (!statusFill) return;
    if (_statusProgress >= 92) return;
    _statusProgress += randomBetween(4, 10);
    if (_statusProgress > 92) _statusProgress = 92;
    statusFill.style.width = _statusProgress + "%";
  }, 900);
}

function stopLoadingStatus() {
  clearStatusTimers();
  if (statusFill) {
    statusFill.style.width = "100%";
  }
  if (statusBar) {
    setTimeout(function() {
      statusBar.classList.remove("active");
      if (statusFill) statusFill.style.width = "0%";
    }, 420);
  }
  if (statusEl) statusEl.textContent = "";
}

function buildProgressUrl(runId) {
  if (!API_URL) return "";
  var base = API_URL.replace(/\/analyze\/?$/, "");
  return base + "/progress/" + runId;
}

function stopProgressPolling() {
  if (_progressTimer) {
    clearInterval(_progressTimer);
    _progressTimer = null;
  }
  _progressRunId = "";
  _progressIndex = 0;
}

function clearLog() {
  if (!logList) return;
  logList.innerHTML = "";
  logList.classList.add("muted");
  logList.textContent = "Waiting for analysis...";
}

function appendLog(message) {
  if (!logList || !message) return;
  if (logList.classList.contains("muted")) {
    logList.classList.remove("muted");
    logList.innerHTML = "";
  }
  var item = document.createElement("div");
  item.className = "log-item";
  item.textContent = message;
  logList.appendChild(item);
  while (logList.children.length > 3) {
    logList.removeChild(logList.firstChild);
  }
  for (var i = 0; i < logList.children.length; i++) {
    logList.children[i].classList.remove("log-item-new", "log-item-oldest");
  }
  if (logList.children.length) {
    logList.children[0].classList.add("log-item-oldest");
    logList.children[logList.children.length - 1].classList.add("log-item-new");
  }
}

function startProgressPolling(runId) {
  stopProgressPolling();
  _progressRunId = runId;
  _progressIndex = 0;
  var url = buildProgressUrl(runId);
  if (!url) return;

  if (_statusTimer) {
    clearInterval(_statusTimer);
    _statusTimer = null;
  }
  if (_statusProgressTimer) {
    clearInterval(_statusProgressTimer);
    _statusProgressTimer = null;
  }

  _progressTimer = setInterval(function() {
    fetch(url)
      .then(function(resp) { return resp.json(); })
      .then(function(data) {
        if (!data || !Array.isArray(data.events)) return;
        while (_progressIndex < data.events.length) {
          var entry = data.events[_progressIndex];
          if (entry && entry.message) {
            if (statusEl) statusEl.textContent = entry.message;
            appendLog(entry.message);
          }
          _progressIndex++;
        }
        if (statusFill && _statusProgress < 95) {
          _statusProgress = Math.min(95, _statusProgress + 2);
          statusFill.style.width = _statusProgress + "%";
        }
        if (data.done) {
          stopProgressPolling();
        }
      })
      .catch(function() {
        // keep polling until main request completes
      });
  }, 700);
}

function resetUI() {
  verdictEl.textContent = "\u2014";
  pressureBar.style.width = "0%";
  pressureLabel.textContent = "\u2014";
  synthesisReason.textContent = "\u2014";
  synthesisReason.classList.add("muted");
  keyFactor.textContent = "\u2014";
  keyFactor.classList.add("muted");
  if (keyFactorBlock) keyFactorBlock.style.display = "";
  if (synthesisReasonBlock) synthesisReasonBlock.style.display = "";
  if (factcheckSummary) {
    factcheckSummary.textContent = "\u2014";
    factcheckSummary.classList.add("muted");
  }

  clearTimers(_verifyTimers);
  clearTimers(_analysisTimers);

  _verifyCards = [];
  _verifyIdx = 0;
  _verifyAvailable = 0;
  renderVerificationHostEmpty();
  updateVerificationNav();

  _analysisCards = [];
  _analysisIdx = 0;
  _analysisAvailable = 0;
  renderAnalysisHostEmpty();
  updateAnalysisNav();

  clearLog();
}

function renderVerificationHostEmpty() {
  verificationHost.innerHTML =
    "<div class='card empty'>" +
      "<div class='empty-title'>No verification yet</div>" +
      "<div class='empty-sub'>Run an analysis to see verification cards.</div>" +
    "</div>";
  verifyIndexEl.textContent = "0";
  verifyTotalEl.textContent = "0";
}

function renderVerificationHostWorking() {
  verificationHost.innerHTML =
    "<div class='card empty'>" +
      "<div class='empty-title'>Working...</div>" +
      "<div class='empty-sub'>Preparing verification cards.</div>" +
    "</div>";
}

function renderAnalysisHostEmpty() {
  cardHost.innerHTML =
    "<div class='card empty'>" +
      "<div class='empty-title'>No cards yet</div>" +
      "<div class='empty-sub'>Run an analysis to generate signal/counter cards.</div>" +
    "</div>";
  cardIndexEl.textContent = "0";
  cardTotalEl.textContent = "0";
}

function renderAnalysisHostWorking() {
  cardHost.innerHTML =
    "<div class='card empty'>" +
      "<div class='empty-title'>Working...</div>" +
      "<div class='empty-sub'>Preparing analysis cards.</div>" +
    "</div>";
}

function updateVerificationNav() {
  var total = _verifyCards.length;
  verifyTotalEl.textContent = String(total);
  verifyIndexEl.textContent = total && _verifyAvailable ? String(_verifyIdx + 1) : "0";
  prevVerifyBtn.disabled = (total <= 1) || (_verifyIdx <= 0);
  nextVerifyBtn.disabled = (total <= 1) || (_verifyIdx >= _verifyAvailable - 1);
}

function updateAnalysisNav() {
  var total = _analysisCards.length;
  cardTotalEl.textContent = String(total);
  cardIndexEl.textContent = total && _analysisAvailable ? String(_analysisIdx + 1) : "0";
  prevBtn.disabled = (total <= 1) || (_analysisIdx <= 0);
  nextBtn.disabled = (total <= 1) || (_analysisIdx >= _analysisAvailable - 1);
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function verdictClass(verdict) {
  var v = String(verdict || "").toLowerCase();
  if (v === "supported") return "supported";
  if (v === "contradicted") return "contradicted";
  return "unverified";
}

function verdictLabel(verdict) {
  var v = String(verdict || "").toLowerCase();
  if (v === "supported") return "Verified";
  if (v === "contradicted") return "Disproven";
  return "Unverified";
}

function buildFactcheckCard(item) {
  var verdictCls = verdictClass(item.verdict);
  var card = document.createElement("div");
  card.className = "fc-card fade";

  var head = document.createElement("div");
  head.className = "fc-head";

  var chip = document.createElement("span");
  chip.className = "fc-chip " + verdictCls;
  chip.textContent = verdictLabel(item.verdict);

  var claimEl = document.createElement("div");
  claimEl.className = "fc-claim";
  claimEl.textContent = sanitizeCopy(item.claim || "");

  head.appendChild(chip);
  head.appendChild(claimEl);
  card.appendChild(head);

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
  confFill.className = "fc-bar-fill " + verdictCls;
  confFill.style.width = confidence + "%";

  confBar.appendChild(confFill);
  confWrap.appendChild(confLabel);
  confWrap.appendChild(confBar);
  card.appendChild(confWrap);

  var details = document.createElement("details");
  details.className = "fc-details";

  var summary = document.createElement("summary");
  summary.textContent = "Sources";
  details.appendChild(summary);

  var detailBody = document.createElement("div");
  detailBody.className = "fc-detail-body";

  var evidenceList = Array.isArray(item.key_evidence) ? item.key_evidence : [];
  if (evidenceList.length) {
    for (var i = 0; i < evidenceList.length; i++) {
      var ev = evidenceList[i] || {};
      if (!ev.url) continue;

      var itemWrap = document.createElement("div");
      itemWrap.className = "fc-source-item";

      var link = document.createElement("a");
      link.className = "fc-source";
      link.href = ev.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      var title = document.createElement("div");
      title.className = "fc-source-title";
      title.textContent = ev.title || ev.source_domain || "Source";

      var domain = document.createElement("div");
      domain.className = "fc-source-domain";
      domain.textContent = ev.source_domain || domainFromUrl(ev.url) || "";

      link.appendChild(title);
      link.appendChild(domain);
      itemWrap.appendChild(link);

      if (ev.excerpt) {
        var excerpt = document.createElement("div");
        excerpt.className = "fc-source-excerpt";
        excerpt.textContent = ev.excerpt;
        itemWrap.appendChild(excerpt);
      }

      detailBody.appendChild(itemWrap);
    }
  } else {
    var none = document.createElement("div");
    none.className = "fc-source-domain";
    none.textContent = "No sources returned.";
    detailBody.appendChild(none);
  }

  details.appendChild(detailBody);
  card.appendChild(details);

  var reasonDetails = document.createElement("details");
  reasonDetails.className = "fc-details";
  reasonDetails.open = true;

  var reasonSummary = document.createElement("summary");
  reasonSummary.textContent = "Reason";
  reasonDetails.appendChild(reasonSummary);

  var reasonBody = document.createElement("div");
  reasonBody.className = "fc-detail-body";
  var reasonText = sanitizeCopy(item.reasoning_short || "No reasoning provided.");
  var reasonBlock = document.createElement("div");
  reasonBlock.className = "fc-detail-block";
  reasonBlock.textContent = reasonText;
  reasonBody.appendChild(reasonBlock);

  reasonDetails.appendChild(reasonBody);
  card.appendChild(reasonDetails);

  return card;
}

function renderVerificationCard(i) {
  if (!_verifyCards.length || !_verifyAvailable) {
    renderVerificationHostEmpty();
    return;
  }

  var claim = _verifyCards[i];
  var card = buildFactcheckCard(claim);
  verificationHost.innerHTML = "";
  verificationHost.appendChild(card);

  setTimeout(function() {
    card.classList.add("visible");
  }, 80);

  _verifyIdx = i;
  updateVerificationNav();
}

function scheduleVerificationReveal() {
  clearTimers(_verifyTimers);
  _verifyAvailable = 0;

  if (!_verifyCards.length) {
    renderVerificationHostEmpty();
    updateVerificationNav();
    return;
  }

  renderVerificationHostWorking();
  updateVerificationNav();

  var firstDelay = randomBetween(1200, 1800);
  _verifyTimers.push(setTimeout(function() {
    _verifyAvailable = Math.min(1, _verifyCards.length);
    _verifyIdx = 0;
    renderVerificationCard(0);
    updateVerificationNav();

    var revealNext = function() {
      if (_verifyAvailable >= _verifyCards.length) return;
      _verifyAvailable += 1;
      updateVerificationNav();
      _verifyTimers.push(setTimeout(revealNext, randomBetween(1000, 2000)));
    };

    _verifyTimers.push(setTimeout(revealNext, randomBetween(1000, 2000)));
  }, firstDelay));
}

function renderVerification(factcheck) {
  if (!factcheck || !Array.isArray(factcheck.claims) || !factcheck.claims.length) {
    _verifyCards = [];
    _verifyAvailable = 0;
    renderVerificationHostEmpty();
    updateVerificationNav();
    return;
  }

  _verifyCards = factcheck.claims.slice();
  _verifyIdx = 0;
  scheduleVerificationReveal();
}

function renderVerificationCounts(factcheck) {
  if (!factcheckSummary) return;
  if (!factcheck || !Array.isArray(factcheck.claims) || !factcheck.claims.length) {
    factcheckSummary.textContent = "No verification results.";
    factcheckSummary.classList.add("muted");
    return;
  }

  var verified = 0;
  var disproven = 0;
  var noProof = 0;

  for (var i = 0; i < factcheck.claims.length; i++) {
    var verdict = String(factcheck.claims[i].verdict || "").toLowerCase();
    if (verdict === "supported") verified++;
    else if (verdict === "contradicted") disproven++;
    else noProof++;
  }

  var summary = "Verified " + verified + " / Disproven " + disproven + " / Unverified " + noProof;

  factcheckSummary.textContent = summary;
  factcheckSummary.classList.remove("muted");
}

function computeManipulationIndex(prosecutor, defender, judge) {
  var base = 45;

  var pCount = (prosecutor && prosecutor.evidence) ? prosecutor.evidence.length : 0;
  var dCount = (defender && defender.rebuttals) ? defender.rebuttals.length : 0;

  base += pCount * 7;
  base -= dCount * 6;

  if (judge && judge.winner === "biased") base += 8;
  if (judge && judge.winner === "neutral") base -= 8;

  if (base < 0) base = 0;
  if (base > 100) base = 100;
  return Math.round(base);
}

function renderSummary(prosecutor, defender, judge, factcheck, synthesisMeta) {
  if (!judge) {
    verdictEl.textContent = "\u2014";
    synthesisReason.textContent = "Invalid result output.";
    synthesisReason.classList.remove("muted");
    renderVerificationCounts(factcheck);
    return;
  }

  if (synthesisMeta && synthesisMeta.valid === false) {
    verdictEl.textContent = "NEUTRAL";
    if (keyFactorBlock) keyFactorBlock.style.display = "none";
    synthesisReason.textContent = "Synthesis unavailable \u2014 defaulted neutral";
    synthesisReason.classList.remove("muted");
    renderVerificationCounts(factcheck);
    return;
  }

  verdictEl.textContent = sanitizeCopy(judge.winner || "\u2014").toUpperCase();

  var load = computeManipulationIndex(prosecutor, defender, judge);
  pressureBar.style.width = load + "%";
  pressureLabel.textContent = load + " / 100";

  keyFactor.textContent = sanitizeCopy(judge.key_factor || "\u2014");
  keyFactor.classList.remove("muted");

  synthesisReason.textContent = sanitizeCopy(judge.reason || "\u2014");
  synthesisReason.classList.remove("muted");
  renderVerificationCounts(factcheck);
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

function buildAnalysisCards(prosecutor, defender) {
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

function buildAnalysisCard(item) {
  var card = document.createElement("div");
  card.className = "card fade";

  var signalBlock = document.createElement("div");
  signalBlock.className = "block";

  var signalHead = document.createElement("div");
  signalHead.className = "block-head";

  var signalTitle = document.createElement("div");
  signalTitle.className = "block-title";
  signalTitle.textContent = "Signal";

  var signalBadge = document.createElement("div");
  signalBadge.className = "badge";
  signalBadge.textContent = "#" + item.idx;

  signalHead.appendChild(signalTitle);
  signalHead.appendChild(signalBadge);
  signalBlock.appendChild(signalHead);

  var signalQuote = document.createElement("div");
  signalQuote.className = "quote";
  signalQuote.innerHTML = "&ldquo;" + escapeHTML(item.signal_quote) + "&rdquo;";
  signalBlock.appendChild(signalQuote);

  card.appendChild(signalBlock);

  var counterBlock = document.createElement("div");
  counterBlock.className = "block";

  var counterHead = document.createElement("div");
  counterHead.className = "block-head";

  var counterTitle = document.createElement("div");
  counterTitle.className = "block-title";
  counterTitle.textContent = "Counter";

  var counterBadge = document.createElement("div");
  counterBadge.className = "badge";
  counterBadge.textContent = item.counter_quote ? "MATCHED" : "MISSING";

  counterHead.appendChild(counterTitle);
  counterHead.appendChild(counterBadge);
  counterBlock.appendChild(counterHead);

  var counterQuote = document.createElement("div");
  counterQuote.className = "quote";
  if (item.counter_quote) {
    counterQuote.innerHTML = "&ldquo;" + escapeHTML(item.counter_quote) + "&rdquo;";
  } else {
    counterQuote.textContent = "No counter response provided.";
  }
  counterBlock.appendChild(counterQuote);

  card.appendChild(counterBlock);

  var details = document.createElement("details");
  details.className = "analysis-details";

  var summary = document.createElement("summary");
  summary.textContent = "Details";
  details.appendChild(summary);

  var signalReason = document.createElement("div");
  signalReason.className = "analysis-detail-block";
  signalReason.innerHTML = "<strong>Signal reasoning:</strong> " + escapeHTML(sanitizeCopy(item.signal_reason || "No reasoning provided."));

  var counterReason = document.createElement("div");
  counterReason.className = "analysis-detail-block";
  counterReason.innerHTML = "<strong>Counter reasoning:</strong> " + escapeHTML(sanitizeCopy(item.counter_reason || "No counter reasoning provided."));

  details.appendChild(signalReason);
  details.appendChild(counterReason);

  card.appendChild(details);

  return card;
}

function renderAnalysisCard(i) {
  if (!_analysisCards.length || !_analysisAvailable) {
    renderAnalysisHostEmpty();
    return;
  }

  var card = buildAnalysisCard(_analysisCards[i]);
  cardHost.innerHTML = "";
  cardHost.appendChild(card);

  setTimeout(function() {
    card.classList.add("visible");
  }, 80);

  _analysisIdx = i;
  updateAnalysisNav();
}

function scheduleAnalysisReveal() {
  clearTimers(_analysisTimers);
  _analysisAvailable = 0;

  if (!_analysisCards.length) {
    renderAnalysisHostEmpty();
    updateAnalysisNav();
    return;
  }

  renderAnalysisHostWorking();
  updateAnalysisNav();

  var firstDelay = randomBetween(1200, 1800);
  _analysisTimers.push(setTimeout(function() {
    _analysisAvailable = Math.min(1, _analysisCards.length);
    _analysisIdx = 0;
    renderAnalysisCard(0);
    updateAnalysisNav();

    var revealNext = function() {
      if (_analysisAvailable >= _analysisCards.length) return;
      _analysisAvailable += 1;
      updateAnalysisNav();
      _analysisTimers.push(setTimeout(revealNext, randomBetween(1000, 2000)));
    };

    _analysisTimers.push(setTimeout(revealNext, randomBetween(1000, 2000)));
  }, firstDelay));
}

function gotoPrevVerify() {
  if (_verifyIdx > 0) renderVerificationCard(_verifyIdx - 1);
}

function gotoNextVerify() {
  if (_verifyIdx < _verifyAvailable - 1) renderVerificationCard(_verifyIdx + 1);
}

function gotoPrev() {
  if (_analysisIdx > 0) renderAnalysisCard(_analysisIdx - 1);
}

function gotoNext() {
  if (_analysisIdx < _analysisAvailable - 1) renderAnalysisCard(_analysisIdx + 1);
}

function loadSampleArticle() {
  document.getElementById("headline").value =
    "Tens of thousands protest in Minneapolis over fatal ICE shooting";

  document.getElementById("article").value = `Minneapolis police estimate tens of thousands present at protests on Saturday
Mayor urges protesters to remain peaceful and not "take the bait" from Trump
Over 1,000 "ICE Out" rallies planned across U.S.
Minnesota Democrats denied access to ICE facility outside Minneapolis

MINNEAPOLIS, Jan 10 (Reuters) - Tens of thousands of people marched through Minneapolis on Saturday to decry the fatal shooting of a woman by a U.S. immigration agent, part of more than 1,000 rallies planned nationwide this weekend against the federal government's deportation drive.

The massive turnout in Minneapolis despite a whipping, cold wind underscores how the fatal shooting of 37-year-old Renee Good by an Immigration and Customs Enforcement officer on Wednesday has struck a chord, fueling protests in major cities and some towns. Minnesota's Democratic leaders and the administration of President Donald Trump, a Republican, have offered starkly different accounts of the incident.

Led by a team of Indigenous Mexican dancers, demonstrators in Minneapolis, which has a metropolitan population of 3.8 million, marched towards the residential street where Good was shot in her car.

The boisterous crowd, which the Minneapolis Police Department estimated in the tens of thousands, chanted Good's name and slogans such as "Abolish ICE" and "No justice, no peace -- get ICE off our streets."

"I'm insanely angry, completely heartbroken and devastated, and then just like longing and hoping that things get better," Ellison Montgomery, a 30-year-old protester, told Reuters.

Minnesota officials have called the shooting unjustified, pointing to bystander video they say showed Good's vehicle turning away from the agent as he fired. The Department of Homeland Security, which oversees ICE, has maintained that the agent acted in self-defense because Good, a volunteer in a community network that monitors and records ICE operations in Minneapolis, drove forward in the direction of the agent who then shot her, after another agent had approached the driver's side and told her to get out of the car.

The shooting on Wednesday came soon after some 2,000 federal officers were dispatched to the Minneapolis-St. Paul area in what DHS has called its largest operation ever, deepening a rift between the administration and Democratic leaders in the state.

Federal-state tensions escalated further on Thursday when a U.S. Border Patrol agent in Portland, Oregon, shot and wounded a man and woman in their car after an attempted vehicle stop. Using language similar to its description of the Minneapolis incident, DHS said the driver had tried to "weaponize" his vehicle and run over agents.

The two DHS-related shootings prompted a coalition of progressive and civil rights groups, including Indivisible and the American Civil Liberties Union, to plan more than 1,000 events under the banner "ICE Out For Good" on Saturday and Sunday. The rallies have been scheduled to end before nightfall to minimize the potential for violence.

In Philadelphia, protesters chanted "ICE has got to go" and "No fascist USA," as they marched from City Hall to a rally outside a federal detention facility, according to the local ABC affiliate. In Manhattan, several hundred people carried anti-ICE signs as they walked past an immigration court where agents have arrested migrants following their hearings.

"We demand justice for Renee, ICE out of our communities, and action from our elected leaders. Enough is enough," said Leah Greenberg, co-executive director of Indivisible.

Minnesota became a major flashpoint in the administration's efforts to deport millions of immigrants months before the Good shooting, with Trump criticizing its Democratic leaders amid a massive welfare fraud scandal involving some members of the large Somali-American community there.

Minneapolis Mayor Jacob Frey, a Democrat who has been critical of immigration agents and the shooting, told a press conference earlier on Saturday that the demonstrations have remained mostly peaceful and that anyone damaging property or engaging in unlawful activity would be arrested by police.

"We will not counter Donald Trump's chaos with our own brand of chaos," Frey said. "He wants us to take the bait."

More than 200 law enforcement officers were deployed Friday night to control protests that led to $6,000 in damage at the Depot Renaissance Hotel and failed attempts by some demonstrators to enter the Hilton Canopy Hotel, believed to house ICE agents, the City of Minneapolis said in a statement.

Police Chief Brian O'Hara said some in the crowd scrawled graffiti and damaged windows at the Depot Renaissance Hotel. He said the gathering at the Hilton Canopy Hotel began as a "noise protest" but escalated as more than 1,000 demonstrators converged on the site, leading to 29 arrests.

"We initiated a plan and took our time to de-escalate the situation, issued multiple warnings, declaring an unlawful assembly, and ultimately then began to move in and disperse the crowd," O'Hara said.

Three Minnesota congressional Democrats showed up at a regional ICE headquarters near Minneapolis on Saturday morning but were denied access. Legislators called the denial illegal.

"We made it clear to ICE and DHS that they were violating federal law," U.S. Representative Angie Craig told reporters as she stood outside the Whipple Federal Building in St. Paul with Representatives Kelly Morrison and Ilhan Omar.

Federal law prohibits DHS from blocking members of Congress from entering ICE detention sites, but DHS has increasingly restricted such oversight visits, prompting confrontations with Democratic lawmakers.

"It is our job as members of Congress to make sure those detained are treated with humanity, because we are the damn United States of America," Craig said.

Referencing the damage and protests at Minneapolis hotels overnight, DHS spokesperson Tricia McLaughlin said the congressional Democrats were denied entry to ensure "the safety of detainees and staff, and in compliance with the agency's mandate." She said DHS policies require members of Congress to notify ICE at least seven days in advance of facility visits.`;

  btn.focus();
  btn.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function analyze() {
  var headline = document.getElementById("headline").value.trim();
  var article = document.getElementById("article").value.trim();

  if (!headline || !article) {
    alert("Please paste both headline and article text.");
    return;
  }

  setLoading(true, "Running analysis...");
  resetUI();

  renderVerificationHostWorking();
  renderAnalysisHostWorking();

  try {
    var runId = "run_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    startProgressPolling(runId);
    var resp = await fetch(API_URL, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ headline: headline, article: article, run_id: runId })
    });

    var data = await resp.json();

    if (!resp.ok) {
      verdictEl.textContent = "ERROR";
      synthesisReason.textContent = (data && data.error) ? data.error : "Request failed.";
      synthesisReason.classList.remove("muted");
      renderVerificationHostEmpty();
      renderAnalysisHostEmpty();
      stopProgressPolling();
      setLoading(false, "");
      return;
    }

    renderVerification(data.factcheck);

    _analysisCards = buildAnalysisCards(data.prosecutor, data.defender);
    _analysisIdx = 0;
    scheduleAnalysisReveal();

    renderSummary(data.prosecutor, data.defender, data.judge, data.factcheck, data.synthesis_meta);

    stopProgressPolling();
    setLoading(false, "");
  } catch (err) {
    verdictEl.textContent = "ERROR";
    synthesisReason.textContent = "Backend error or CORS issue.";
    synthesisReason.classList.remove("muted");
    renderVerificationHostEmpty();
    renderAnalysisHostEmpty();
    stopProgressPolling();
    setLoading(false, "");
  }
}

function bindDom() {
  btn = document.getElementById("analyzeBtn");
  demoBtn = document.getElementById("demoBtn");
  clearBtn = document.getElementById("clearBtn");
  statusEl = document.getElementById("status");
  statusBar = document.getElementById("statusBar");
  statusFill = document.getElementById("statusFill");

  verificationHost = document.getElementById("verificationHost");
  prevVerifyBtn = document.getElementById("prevVerify");
  nextVerifyBtn = document.getElementById("nextVerify");
  verifyIndexEl = document.getElementById("verifyIndex");
  verifyTotalEl = document.getElementById("verifyTotal");

  verdictEl = document.getElementById("verdict");
  pressureBar = document.getElementById("pressureBar");
  pressureLabel = document.getElementById("pressureLabel");
  synthesisReason = document.getElementById("synthesisReason");
  keyFactor = document.getElementById("keyFactor");
  keyFactorBlock = document.getElementById("keyFactorBlock");
  synthesisReasonBlock = document.getElementById("synthesisReasonBlock");
  factcheckSummary = document.getElementById("factcheckSummary");
  logList = document.getElementById("logList");

  prevBtn = document.getElementById("prevCard");
  nextBtn = document.getElementById("nextCard");
  cardHost = document.getElementById("cardHost");
  cardIndexEl = document.getElementById("cardIndex");
  cardTotalEl = document.getElementById("cardTotal");

  return !!(
    btn && demoBtn && clearBtn && statusEl &&
    verificationHost && prevVerifyBtn && nextVerifyBtn && verifyIndexEl && verifyTotalEl &&
    verdictEl && pressureBar && pressureLabel && synthesisReason && keyFactor && factcheckSummary &&
    prevBtn && nextBtn && cardHost && cardIndexEl && cardTotalEl
  );
}

function init() {
  if (_initialized) return;
  _initialized = true;

  if (!bindDom()) {
    console.warn("BiasLens init: missing required DOM nodes.");
    return;
  }

  prevVerifyBtn.addEventListener("click", gotoPrevVerify);
  nextVerifyBtn.addEventListener("click", gotoNextVerify);

  prevBtn.addEventListener("click", gotoPrev);
  nextBtn.addEventListener("click", gotoNext);

  document.addEventListener("keydown", function(e){
    if (e.key === "ArrowLeft") gotoPrev();
    if (e.key === "ArrowRight") gotoNext();

    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analyze();
  });

  clearBtn.addEventListener("click", function(){
    document.getElementById("headline").value = "";
    document.getElementById("article").value = "";
    resetUI();
  });

  demoBtn.addEventListener("click", loadSampleArticle);
  btn.addEventListener("click", analyze);

  resetUI();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
