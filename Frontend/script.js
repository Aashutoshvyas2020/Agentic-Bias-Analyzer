var API_URL = (typeof window !== "undefined" && window.API_URL)
  ? window.API_URL
  : "https://echoes-backend-z2sf.onrender.com/analyze";

var analyzeBtn;
var demoBtn;
var clearBtn;
var fetchUrlBtn;

var headlineInput;
var urlInput;
var articleInput;

var visualUpload;
var previewContainer;
var previewImg;
var removeFileBtn;
var imagePayload;

var statusEl;
var loadingWrap;
var loadingFill;
var loadingTimer;
var loadingStart;

var verificationHost;
var verifNav;
var prevClaim;
var nextClaim;
var claimIndicator;

var verdictEl;
var pressureBar;
var pressureLabel;
var countVerified;
var countDisproven;
var countUnverified;
var keyFactorEl;
var synthesisReasonEl;

var cardHost;
var imageAnalysisHost;

var isUrlFetching = false;

var verifyCards = [];
var verifyIdx = 0;
var verifyAvailable = 0;

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

function clearStatus() {
  if (!statusEl) return;
  statusEl.textContent = "";
  statusEl.classList.remove("status-ok", "status-warn", "status-error");
}

function setStatus(msg, tone, autoClearMs) {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.classList.remove("status-ok", "status-warn", "status-error");
  if (tone === "ok") statusEl.classList.add("status-ok");
  if (tone === "warn") statusEl.classList.add("status-warn");
  if (tone === "error") statusEl.classList.add("status-error");
  if (autoClearMs) {
    setTimeout(clearStatus, autoClearMs);
  }
}

function setLoading(isLoading) {
  analyzeBtn.disabled = isLoading;
  if (fetchUrlBtn) fetchUrlBtn.disabled = isLoading;
  demoBtn.disabled = isLoading;
  clearBtn.disabled = isLoading;
  if (prevClaim) prevClaim.disabled = isLoading || verifyAvailable <= 1;
  if (nextClaim) nextClaim.disabled = isLoading || verifyAvailable <= 1;
}

function startLoadingProgress() {
  if (!loadingWrap || !loadingFill) return;
  if (loadingTimer) clearInterval(loadingTimer);
  loadingWrap.style.display = "block";
  loadingFill.style.width = "0%";
  loadingStart = Date.now();
  loadingTimer = setInterval(function() {
    var elapsed = Date.now() - loadingStart;
    var progress = Math.min(90, (elapsed / 310000) * 90);
    loadingFill.style.width = progress.toFixed(2) + "%";
  }, 500);
}

function stopLoadingProgress() {
  if (!loadingWrap || !loadingFill) return;
  if (loadingTimer) {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }
  loadingFill.style.width = "100%";
  setTimeout(function() {
    loadingWrap.style.display = "none";
    loadingFill.style.width = "0%";
  }, 300);
}

function updateUrlMode() {
  var hasUrl = urlInput && urlInput.value.trim();
  if (headlineInput) headlineInput.disabled = !!hasUrl;
  if (articleInput) articleInput.disabled = !!hasUrl;
  if (fetchUrlBtn) fetchUrlBtn.style.display = hasUrl ? "inline-flex" : "none";
  if (analyzeBtn) analyzeBtn.disabled = !!hasUrl || isUrlFetching;
}

function resetOutputs() {
  if (verdictEl) {
    verdictEl.textContent = "Pending";
    verdictEl.className = "verdict-chip verdict-pending";
  }
  if (pressureLabel) pressureLabel.textContent = "0/100";
  if (pressureBar) pressureBar.style.width = "0%";

  if (keyFactorEl) {
    keyFactorEl.textContent = "-";
    keyFactorEl.classList.add("muted");
  }
  if (synthesisReasonEl) {
    synthesisReasonEl.textContent = "-";
    synthesisReasonEl.classList.add("muted");
  }

  if (countVerified) countVerified.textContent = "-";
  if (countDisproven) countDisproven.textContent = "-";
  if (countUnverified) countUnverified.textContent = "-";

  verifyCards = [];
  verifyIdx = 0;
  verifyAvailable = 0;
  renderVerificationHostEmpty();

  renderAnalysisHostEmpty();
  renderImageAnalysisEmpty();

}

function renderVerificationHostEmpty() {
  if (!verificationHost) return;
  verificationHost.innerHTML =
    "<div class='card' style='opacity: 0.6; pointer-events: none;'>" +
      "<div class='card-header'>" +
        "<span class='verdict-chip verdict-unverified'>Unverified</span>" +
      "</div>" +
      "<p class='claim-text'>Claim verification details will appear here after analysis...</p>" +
      "<div class='confidence-meter'>" +
        "<span>Confidence: 0%</span>" +
        "<div class='conf-bar-bg'><div class='conf-bar-fill' style='width: 0%'></div></div>" +
      "</div>" +
    "</div>";
  if (verifNav) verifNav.style.display = "none";
  if (claimIndicator) claimIndicator.textContent = "0 / 0";
}

function renderAnalysisHostEmpty() {
  if (!cardHost) return;
  cardHost.innerHTML =
    "<div class='card' style='opacity: 0.6;'>" +
      "<div class='comparison-grid'>" +
        "<div class='quote-box signal'>Signal quote will appear here...</div>" +
        "<div class='quote-box counter'>Counter-evidence or missing context...</div>" +
      "</div>" +
    "</div>";
}

function renderImageAnalysisEmpty() {
  if (!imageAnalysisHost) return;
  imageAnalysisHost.innerHTML =
    "<div class='card' style='opacity: 0.6; pointer-events: none;'>" +
      "<p class='claim-text'>Image analysis will appear here after analysis...</p>" +
      "<div class='confidence-meter'>" +
        "<span>Confidence: 0%</span>" +
        "<div class='conf-bar-bg'><div class='conf-bar-fill' style='width: 0%'></div></div>" +
      "</div>" +
    "</div>";
}

function verdictClass(verdict) {
  var v = String(verdict || "").toLowerCase();
  if (v === "supported") return "verified";
  if (v === "contradicted") return "disproven";
  return "unverified";
}

function verdictLabel(verdict) {
  var v = String(verdict || "").toLowerCase();
  if (v === "supported") return "Verified";
  if (v === "contradicted") return "Disproven";
  return "Unverified";
}

function buildCollapsible(title, contentEl, isOpen) {
  var wrap = document.createElement("div");
  wrap.className = "collapsible";

  var header = document.createElement("div");
  header.className = "collapsible-header";

  var label = document.createElement("span");
  label.textContent = title;

  var icon = document.createElement("svg");
  icon.className = "icon icon-sm";
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.innerHTML = "<polyline points='6 9 12 15 18 9'></polyline>";

  header.appendChild(label);
  header.appendChild(icon);

  var content = document.createElement("div");
  content.className = "collapsible-content";
  if (isOpen) content.classList.add("open");
  content.appendChild(contentEl);

  wrap.appendChild(header);
  wrap.appendChild(content);
  return wrap;
}

function buildFactcheckCard(item) {
  var card = document.createElement("div");
  card.className = "card fade";

  var header = document.createElement("div");
  header.className = "card-header";

  var chip = document.createElement("span");
  chip.className = "verdict-chip verdict-" + verdictClass(item.verdict);
  chip.textContent = verdictLabel(item.verdict);

  header.appendChild(chip);
  card.appendChild(header);

  var claimEl = document.createElement("p");
  claimEl.className = "claim-text";
  claimEl.textContent = sanitizeCopy(item.claim || "");
  card.appendChild(claimEl);

  var confidence = Number(item.confidence);
  if (Number.isNaN(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(100, confidence));

  var confWrap = document.createElement("div");
  confWrap.className = "confidence-meter";

  var confLabel = document.createElement("span");
  confLabel.textContent = "Confidence: " + confidence + "%";

  var confBar = document.createElement("div");
  confBar.className = "conf-bar-bg";

  var confFill = document.createElement("div");
  confFill.className = "conf-bar-fill";
  confFill.style.width = confidence + "%";

  confBar.appendChild(confFill);
  confWrap.appendChild(confLabel);
  confWrap.appendChild(confBar);
  card.appendChild(confWrap);

  var reasonBody = document.createElement("div");
  var reasonText = sanitizeCopy(item.reasoning_short || "No reasoning provided.");
  reasonBody.textContent = reasonText;
  var reasonBlock = buildCollapsible("Reason", reasonBody, true);
  card.appendChild(reasonBlock);

  var sourcesBody = document.createElement("div");
  var evidenceList = Array.isArray(item.key_evidence) ? item.key_evidence : [];
  if (evidenceList.length) {
    for (var i = 0; i < evidenceList.length; i++) {
      var ev = evidenceList[i] || {};
      if (!ev.url) continue;

      var sourceItem = document.createElement("div");
      sourceItem.className = "source-item";

      var link = document.createElement("a");
      link.className = "source-link";
      link.href = ev.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      var titleText = ev.title || ev.source_domain || "Source";
      var domain = ev.source_domain || domainFromUrl(ev.url) || "";
      link.textContent = titleText + (domain ? " (" + domain + ")" : "");

      sourceItem.appendChild(link);

      if (ev.excerpt) {
        var excerpt = document.createElement("div");
        excerpt.className = "source-excerpt";
        excerpt.textContent = ev.excerpt;
        sourceItem.appendChild(excerpt);
      }

      sourcesBody.appendChild(sourceItem);
    }
  } else {
    sourcesBody.textContent = "No sources returned.";
  }

  var sourcesBlock = buildCollapsible("Sources", sourcesBody, false);
  card.appendChild(sourcesBlock);

  if (item.notes) {
    var notesBody = document.createElement("div");
    notesBody.textContent = sanitizeCopy(item.notes);
    var notesBlock = buildCollapsible("Notes", notesBody, false);
    card.appendChild(notesBlock);
  }

  return card;
}
function updateVerificationNav() {
  if (!claimIndicator || !verifNav) return;

  if (!verifyCards.length || !verifyAvailable) {
    claimIndicator.textContent = "0 / 0";
    verifNav.style.display = "none";
    return;
  }

  claimIndicator.textContent = (verifyIdx + 1) + " / " + verifyCards.length;
  verifNav.style.display = "flex";
  if (prevClaim) prevClaim.disabled = verifyIdx <= 0;
  if (nextClaim) nextClaim.disabled = verifyIdx >= verifyAvailable - 1;
}

function renderVerificationCard(i) {
  if (!verifyCards.length || !verifyAvailable) {
    renderVerificationHostEmpty();
    return;
  }

  var card = buildFactcheckCard(verifyCards[i]);
  verificationHost.innerHTML = "";
  verificationHost.appendChild(card);

  requestAnimationFrame(function() {
    card.classList.add("visible");
  });

  verifyIdx = i;
  updateVerificationNav();
}

function renderVerification(factcheck) {
  if (!factcheck || !Array.isArray(factcheck.claims) || !factcheck.claims.length) {
    verifyCards = [];
    verifyAvailable = 0;
    renderVerificationHostEmpty();
    updateVerificationNav();
    return;
  }

  verifyCards = factcheck.claims.slice();
  verifyAvailable = verifyCards.length;
  verifyIdx = 0;
  renderVerificationCard(0);
  updateVerificationNav();
}

function renderVerificationCounts(factcheck) {
  if (!factcheck || !Array.isArray(factcheck.claims)) {
    if (countVerified) countVerified.textContent = "0";
    if (countDisproven) countDisproven.textContent = "0";
    if (countUnverified) countUnverified.textContent = "0";
    return;
  }

  var verified = 0;
  var disproven = 0;
  var unverified = 0;

  for (var i = 0; i < factcheck.claims.length; i++) {
    var verdict = String(factcheck.claims[i].verdict || "").toLowerCase();
    if (verdict === "supported") verified++;
    else if (verdict === "contradicted") disproven++;
    else unverified++;
  }

  if (countVerified) countVerified.textContent = String(verified);
  if (countDisproven) countDisproven.textContent = String(disproven);
  if (countUnverified) countUnverified.textContent = String(unverified);
}
function renderSummary(prosecutor, defender, judge, factcheck, synthesisMeta) {
  if (!judge) {
    if (verdictEl) {
      verdictEl.textContent = "Pending";
      verdictEl.className = "verdict-chip verdict-pending";
    }
    if (synthesisReasonEl) {
      synthesisReasonEl.textContent = "Invalid result output.";
      synthesisReasonEl.classList.remove("muted");
    }
    renderVerificationCounts(factcheck);
    return;
  }

  if (synthesisMeta && synthesisMeta.valid === false) {
    if (verdictEl) {
      verdictEl.textContent = "Neutral";
      verdictEl.className = "verdict-chip verdict-neutral";
    }
    if (keyFactorEl) keyFactorEl.textContent = "-";
    if (synthesisReasonEl) {
      synthesisReasonEl.textContent = "Synthesis unavailable - defaulted neutral";
      synthesisReasonEl.classList.remove("muted");
    }
    renderVerificationCounts(factcheck);
    return;
  }

  var winner = String(judge.winner || "").toLowerCase();
  var label = winner === "biased" ? "Biased" : "Neutral";

  if (verdictEl) {
    verdictEl.textContent = label;
    verdictEl.className = "verdict-chip verdict-" + (winner === "biased" ? "biased" : "neutral");
  }

  var persuasionValue = null;
  if (judge && typeof judge.persuasion_index === "number") {
    persuasionValue = judge.persuasion_index;
  } else if (judge && typeof judge.persuasionIndex === "number") {
    persuasionValue = judge.persuasionIndex;
  }

  if (typeof persuasionValue === "number" && !Number.isNaN(persuasionValue)) {
    var load = Math.max(0, Math.min(100, Math.round(persuasionValue)));
    if (pressureBar) pressureBar.style.width = load + "%";
    if (pressureLabel) pressureLabel.textContent = load + "/100";
  } else {
    if (pressureBar) pressureBar.style.width = "0%";
    if (pressureLabel) pressureLabel.textContent = "--";
  }

  if (keyFactorEl) {
    keyFactorEl.textContent = sanitizeCopy(judge.key_factor || "-");
    keyFactorEl.classList.remove("muted");
  }

  if (synthesisReasonEl) {
    synthesisReasonEl.textContent = sanitizeCopy(judge.reason || "-");
    synthesisReasonEl.classList.remove("muted");
  }

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

  var grid = document.createElement("div");
  grid.className = "comparison-grid";

  var signal = document.createElement("div");
  signal.className = "quote-box signal";
  signal.textContent = item.signal_quote ? "\"" + item.signal_quote + "\"" : "No signal quote provided.";

  var counter = document.createElement("div");
  counter.className = "quote-box counter";
  counter.textContent = item.counter_quote ? "\"" + item.counter_quote + "\"" : "No counter response provided.";

  grid.appendChild(signal);
  grid.appendChild(counter);
  card.appendChild(grid);

  var detailBody = document.createElement("div");

  var signalReason = document.createElement("div");
  signalReason.className = "analysis-detail";
  signalReason.textContent = "Signal reasoning: " + sanitizeCopy(item.signal_reason || "No reasoning provided.");

  var counterReason = document.createElement("div");
  counterReason.className = "analysis-detail";
  counterReason.textContent = "Counter reasoning: " + sanitizeCopy(item.counter_reason || "No counter reasoning provided.");

  detailBody.appendChild(signalReason);
  detailBody.appendChild(counterReason);

  var details = buildCollapsible("Details", detailBody, false);
  card.appendChild(details);

  return card;
}

function renderAnalysis(prosecutor, defender) {
  if (!cardHost) return;

  var cards = buildAnalysisCards(prosecutor, defender);
  if (!cards.length) {
    renderAnalysisHostEmpty();
    return;
  }

  cardHost.innerHTML = "";

  for (var i = 0; i < cards.length; i++) {
    var card = buildAnalysisCard(cards[i]);
    cardHost.appendChild(card);

    (function(cardEl) {
      requestAnimationFrame(function() {
        cardEl.classList.add("visible");
      });
    })(card);
  }
}

function renderImageAnalysis(imageAnalysis) {
  if (!imageAnalysisHost) return;
  if (!imageAnalysis) {
    renderImageAnalysisEmpty();
    return;
  }

  var card = document.createElement("div");
  card.className = "card fade";

  var summary = document.createElement("p");
  summary.className = "claim-text";
  summary.textContent = sanitizeCopy("Visual framing analysis based on the uploaded image.");
  card.appendChild(summary);

  var rawIndex = Number(imageAnalysis.bias_index);
  if (Number.isNaN(rawIndex)) rawIndex = 0;
  var indexValue = Math.max(0, Math.min(1, rawIndex));
  var percent = Math.round(indexValue * 100);

  var confWrap = document.createElement("div");
  confWrap.className = "confidence-meter";

  var confLabel = document.createElement("span");
  var category = sanitizeCopy(imageAnalysis.category || "neutral");
  confLabel.textContent = "Image Bias Index: " + percent + "% (" + category + ")";

  var confBar = document.createElement("div");
  confBar.className = "conf-bar-bg";

  var confFill = document.createElement("div");
  confFill.className = "conf-bar-fill";
  confFill.style.width = percent + "%";

  confBar.appendChild(confFill);
  confWrap.appendChild(confLabel);
  confWrap.appendChild(confBar);
  card.appendChild(confWrap);

  var scoresBody = document.createElement("div");
  var scores = imageAnalysis.scores || {};
  var scoreMap = [
    { label: "Emotional Load", value: scores.emotional },
    { label: "Composition Manipulation", value: scores.composition },
    { label: "Symbolic Framing", value: scores.symbolic },
    { label: "Text-Image Alignment Risk", value: scores.alignment }
  ];
  for (var s = 0; s < scoreMap.length; s++) {
    var row = document.createElement("div");
    row.className = "analysis-detail";
    var val = Number(scoreMap[s].value);
    if (Number.isNaN(val)) val = 0;
    val = Math.max(0, Math.min(3, val));
    row.textContent = scoreMap[s].label + ": " + val + "/3";
    scoresBody.appendChild(row);
  }
  var scoresBlock = buildCollapsible("Rubric Scores", scoresBody, true);
  card.appendChild(scoresBlock);

  var signalsBody = document.createElement("div");
  var signals = Array.isArray(imageAnalysis.signals) ? imageAnalysis.signals : [];
  if (signals.length) {
    for (var i = 0; i < signals.length; i++) {
      var item = document.createElement("div");
      item.className = "analysis-detail";
      item.textContent = "â€¢ " + sanitizeCopy(signals[i]);
      signalsBody.appendChild(item);
    }
  } else {
    signalsBody.textContent = "No framing signals reported.";
  }
  var signalsBlock = buildCollapsible("Signals", signalsBody, true);
  card.appendChild(signalsBlock);

  if (imageAnalysis.reasoning) {
    var reasoningBody = document.createElement("div");
    reasoningBody.textContent = sanitizeCopy(imageAnalysis.reasoning);
    var reasoningBlock = buildCollapsible("Reasoning", reasoningBody, true);
    card.appendChild(reasoningBlock);
  }

  if (imageAnalysis.limitations) {
    var limitsBody = document.createElement("div");
    limitsBody.textContent = sanitizeCopy(imageAnalysis.limitations);
    var limitsBlock = buildCollapsible("Limitations", limitsBody, true);
    card.appendChild(limitsBlock);
  }

  imageAnalysisHost.innerHTML = "";
  imageAnalysisHost.appendChild(card);

  requestAnimationFrame(function() {
    card.classList.add("visible");
  });
}

function loadDemoImage() {
  var demoPath = "demo-image.png";
  if (visualUpload) visualUpload.value = "";
  if (previewImg) previewImg.src = demoPath;
  if (previewContainer) previewContainer.classList.add("active");

  fetch(demoPath)
    .then(function(resp) {
      if (!resp.ok) throw new Error("demo image fetch failed");
      return resp.blob();
    })
    .then(function(blob) {
      var reader = new FileReader();
      reader.onload = function(evt) {
        var dataUrl = String(evt.target.result || "");
        var baseIndex = dataUrl.indexOf("base64,");
        if (baseIndex === -1) {
          imagePayload = null;
          return;
        }
        imagePayload = {
          mimeType: blob.type || "image/png",
          data: dataUrl.slice(baseIndex + 7)
        };
      };
      reader.readAsDataURL(blob);
    })
    .catch(function() {
      imagePayload = null;
    });
}

var SAMPLE_RESULTS = {
    "steps":  [
                  "Image Analyzer completed",
                  "Bias Agent completed",
                  "Neutrality Agent completed",
                  "Judge Agent completed",
                  "Fact Checker completed"
              ],
    "prosecutor":  {
                       "position":  "biased",
                       "evidence":  [
                                        {
                                            "quote":  "decry the fatal shooting of a woman by a U.S. immigration agent, part of more than 1,000 rallies planned nationwide this weekend against the federal government\u0027s deportation drive.",
                                            "reason":  "The use of the verb \u0027decry\u0027 and the characterization of policy as a \u0027deportation drive\u0027 employs loaded language that frames the government\u0027s actions as an aggressive campaign."
                                        },
                                        {
                                            "quote":  "The massive turnout in Minneapolis despite a whipping, cold wind underscores how the fatal shooting of 37-year-old Renee Good by an Immigration and Customs Enforcement officer on Wednesday has struck a chord",
                                            "reason":  "The phrase \u0027struck a chord\u0027 and the dramatic emphasis on a \u0027whipping, cold wind\u0027 use narrative-driven, evocative imagery to heighten the emotional weight of the event."
                                        },
                                        {
                                            "quote":  "\"I\u0027m insanely angry, completely heartbroken and devastated, and then just like longing and hoping that things get better,\"",
                                            "reason":  "The selection of an intensely emotional quote centers the narrative on personal grief and subjective feelings rather than objective details of the incident."
                                        },
                                        {
                                            "quote":  "\"We will not counter Donald Trump\u0027s chaos with our own brand of chaos,\" Frey said. \"He wants us to take the bait.\"",
                                            "reason":  "The inclusion of loaded phrasing like \u0027chaos\u0027 and the metaphor \u0027take the bait\u0027 frames one side of the dispute as a source of disorder and intentional provocation."
                                        },
                                        {
                                            "quote":  "\"It is our job as members of Congress to make sure those detained are treated with humanity, because we are the damn United States of America,\"",
                                            "reason":  "The use of an impassioned, moralizing quote featuring colloquial language emphasizes a narrative of ethical failure and righteous indignation."
                                        }
                                    ]
                   },
    "defender":  {
                     "position":  "neutral",
                     "rebuttals":  [
                                       {
                                           "prosecutor_quote":  "decry the fatal shooting of a woman by a U.S. immigration agent, part of more than 1,000 rallies planned nationwide this weekend against the federal government\u0027s deportation drive.",
                                           "counter_quote":  "The Department of Homeland Security, which oversees ICE, has maintained that the agent acted in self-defense because Good, a volunteer in a community network that monitors and records ICE operations in Minneapolis, drove forward in the direction of the agent who then shot her",
                                           "reason":  "By including the official government justification for the agent\u0027s actions, the article balances the description of the protest with the administration\u0027s stated reason for the use of force."
                                       },
                                       {
                                           "prosecutor_quote":  "The massive turnout in Minneapolis despite a whipping, cold wind underscores how the fatal shooting of 37-year-old Renee Good by an Immigration and Customs Enforcement officer on Wednesday has struck a chord",
                                           "counter_quote":  "The boisterous crowd, which the Minneapolis Police Department estimated in the tens of thousands",
                                           "reason":  "Attributing the size of the crowd to the Minneapolis Police Department provides an objective factual basis for the scale of the event rather than relying solely on atmospheric description."
                                       },
                                       {
                                           "prosecutor_quote":  "\"I\u0027m insanely angry, completely heartbroken and devastated, and then just like longing and hoping that things get better,\"",
                                           "counter_quote":  "DHS spokesperson Tricia McLaughlin said the congressional Democrats were denied entry to ensure \"the safety of detainees and staff, and in compliance with the agency\u0027s mandate.\"",
                                           "reason":  "The inclusion of formal agency statements regarding safety and mandates balances the emotional testimony of individual protesters with the government\u0027s procedural perspectives."
                                       },
                                       {
                                           "prosecutor_quote":  "\"We will not counter Donald Trump\u0027s chaos with our own brand of chaos,\" Frey said. \"He wants us to take the bait.\"",
                                           "counter_quote":  "Police Chief Brian O\u0027Hara said some in the crowd scrawled graffiti and damaged windows at the Depot Renaissance Hotel.",
                                           "reason":  "Reporting on specific acts of property damage attributed to the crowd by the police chief provides a factual counterpoint to the mayor\u0027s political framing of chaos."
                                       },
                                       {
                                           "prosecutor_quote":  "\"It is our job as members of Congress to make sure those detained are treated with humanity, because we are the damn United States of America,\"",
                                           "counter_quote":  "She said DHS policies require members of Congress to notify ICE at least seven days in advance of facility visits.",
                                           "reason":  "Providing the specific DHS policy regarding notification requirements offers a legalistic explanation for the denial of access, countering the emotional appeal of the lawmakers\u0027 claims."
                                       }
                                   ]
                 },
    "judge":  {
                  "winner":  "neutral",
                  "reason":  "The Neutrality Agent argued more effectively by demonstrating that the article provided specific factual and procedural rebuttals to the emotionally charged framing identified by the Bias Agent. While the Bias Agent successfully identified loaded language like \u0027deportation drive\u0027 and evocative descriptions of the weather, these elements were effectively balanced by the inclusion of official DHS justifications and police reports. The strongest point from the Bias Agent was the use of moralizing and impassioned quotes from members of Congress, which can significantly sway reader sentiment. However, this was insufficient because the Neutrality Agent highlighted that the article included specific legalistic explanations for the denial of access, such as the seven-day notification requirement. By citing these concrete policies and official self-defense claims, the Neutrality Agent proved the article maintained a substantive balance between emotional protest narratives and administrative procedures. Ultimately, the presence of specific counter-quotes directly answering the biased framing suggests the article provided more than just a procedural mention of the opposing side.",
                  "key_factor":  "The consistent inclusion of specific government policies and police reports effectively countered the emotionally charged and political protest narratives.",
                  "persuasion_index":  42
              },
    "factcheck":  {
                      "source_match":  {
                                           "status":  "matched",
                                           "canonical_url":  "https://www.reuters.com/world/us/fatal-ice-shooting-minneapolis-activist-sets-stage-national-protests-2026-01-10/",
                                           "source":  "reuters"
                                       },
                      "claims":  [
                                     {
                                         "id":  "c1",
                                         "claim":  "The Minneapolis Police Department estimated tens of thousands of protesters marched on January 10, 2026, following the fatal shooting of Renee Good.",
                                         "verdict":  "Supported",
                                         "confidence":  74,
                                         "key_evidence":  [
                                                              {
                                                                  "url":  "https://en.wikipedia.org/wiki/List_of_Renee_Good_protests",
                                                                  "title":  "List of Renee Good protests - Wikipedia",
                                                                  "source_domain":  "en.wikipedia.org",
                                                                  "excerpt":  "In January 2026, protests began throughout the United States in response to the killing of Renee Good and the 2026 Portland shooting. At least 36 arrests have been made, including 30 in Minneapolis and 6 in Portland."
                                                              },
                                                              {
                                                                  "url":  "https://www.cnn.com/us/live-news/minneapolis-ice-shooting-immigration-crackdown-01-10-26",
                                                                  "title":  "January 10, 2026 — Nationwide protests after ICE agent’s killing ...",
                                                                  "source_domain":  "www.cnn.com",
                                                                  "excerpt":  "Protests and vigils are taking place nationwide after an ICE agent fatally shot a woman in Minneapolis."
                                                              },
                                                              {
                                                                  "url":  "https://www.nytimes.com/2026/01/17/us/minneapolis-protests-ice.html",
                                                                  "title":  "The People of Minneapolis vs. ICE: A Street-Level View - The New ...",
                                                                  "source_domain":  "www.nytimes.com",
                                                                  "excerpt":  "An intense cat-and-mouse game is putting enraged residents face to face with heavily armed federal agents."
                                                              },
                                                              {
                                                                  "url":  "https://www.cbsnews.com/minnesota/live-updates/minneapolis-renee-good-ice-shooting-minnesota-bca-investigation/",
                                                                  "title":  "Family of Renee Good shares statement: \"We all already miss her ...",
                                                                  "source_domain":  "www.cbsnews.com",
                                                                  "excerpt":  "The family of Renee Good said in a written statement that she was \"the beautiful light of our family and brought joy to anyone she met.\""
                                                              },
                                                              {
                                                                  "url":  "https://www.reuters.com/world/us/fatal-ice-shooting-minneapolis-activist-sets-stage-national-protests-2026-01-10/",
                                                                  "title":  "Tens of thousands protest in Minneapolis over fatal ICE shooting ...",
                                                                  "source_domain":  "www.reuters.com",
                                                                  "excerpt":  "Mayor Jacob Frey urged demonstrators to stay peaceful to avoid Trump\u0027s \u0027bait.\u0027"
                                                              },
                                                              {
                                                                  "url":  "https://www.aljazeera.com/news/2026/1/10/we-have-to-stand-up-ice-killing-in-minneapolis-sparks-protests-across-us",
                                                                  "title":  "‘Abolish ICE’: Tens of thousands in Minneapolis, across US, ...",
                                                                  "source_domain":  "www.aljazeera.com",
                                                                  "excerpt":  "Protesters demand justice for Renee Nicole Good, a mother of three shot dead by an ICE agent in Minneapolis this week. People stand before a makeshift memorial during an \u0027ICE Out of Minnesota\u0027 rally organised by Minnesota Immigrant Rights A..."
                                                              }
                                                          ],
                                         "reasoning_short":  "Multiple sources confirm tens of thousands protested in Minneapolis on January 10, 2026, but the snippets do not explicitly name the Minneapolis Police Department as the source of that estimate.",
                                         "queries_used":  [
                                                              "Minneapolis police estimate Renee Good protest January 10 2026",
                                                              "tens of thousands protest Minneapolis ICE shooting",
                                                              "The Minneapolis Police Department estimated tens of thousands of protesters marched on January 10, 2026, following the fatal shooting of Renee Good.",
                                                              "The Minneapolis Police Department estimated tens of thousands of protesters marched on January 10, 2026, following the fatal shooting of Renee Good. official",
                                                              "The Minneapolis Police Department estimated tens of thousands of protesters marched on January 10, 2026, following the fatal shooting of Renee Good. report"
                                                          ],
                                         "notes":  ""
                                     },
                                     {
                                         "id":  "c2",
                                         "claim":  "A coalition including Indivisible and the ACLU scheduled over 1,000 ICE Out For Good rallies nationwide for the weekend of January 10-11, 2026.",
                                         "verdict":  "Supported",
                                         "confidence":  80,
                                         "key_evidence":  [
                                                              {
                                                                  "url":  "https://www.commondreams.org/news/renee-good-protest-weekend",
                                                                  "title":  "\u0027ICE Out for Good\u0027: Weekend Rallies Nationwide After Killing of ...",
                                                                  "source_domain":  "www.commondreams.org",
                                                                  "excerpt":  "\"They have literally started killing us—enough is enough,\" said one campaigner."
                                                              },
                                                              {
                                                                  "url":  "https://www.aclu.org/press-releases/ice-out-for-good-concludes-day-one-with-overwhelming-peaceful-actions",
                                                                  "title":  "ICE Out For Good Concludes Day One With Overwhelming Peaceful Actions ...",
                                                                  "source_domain":  "www.aclu.org",
                                                                  "excerpt":  "1,000+ events planned throughout the weekend of action"
                                                              },
                                                              {
                                                                  "url":  "https://front.moveon.org/5-pm-tuesday-ice-out-for-good-presser-vigil-at-cbp/",
                                                                  "title":  "ICYMI: Senators, Members of Congress, Faith Leaders, and Advocates ...",
                                                                  "source_domain":  "front.moveon.org",
                                                                  "excerpt":  "MoveOn Civic Action, Indivisible, Public Citizen, Movimiento Migrante DC, ACLU, Interfaith Alliance, FreeDC, and allied organizations, led thousands of advocates, faith leaders, and community members Tuesday evening outside the U.S. Customs..."
                                                              },
                                                              {
                                                                  "url":  "https://www.citizen.org/news/ice-out-for-good-coalition-announces-nationwide-weekend-of-action-demanding-accountability-after-ice-killing-of-renee-nicole-good/",
                                                                  "title":  "ICE Out For Good Coalition Announces Nationwide Weekend of Action ...",
                                                                  "source_domain":  "www.citizen.org",
                                                                  "excerpt":  "WASHINGTON, D.C. — A broad national coalition, including Indivisible, MoveOn Civic Action, the American Civil Liberties Union, Public Citizen, Voto Latino, United…"
                                                              },
                                                              {
                                                                  "url":  "https://www.theguardian.com/us-news/2026/jan/10/ice-out-for-good-protests",
                                                                  "title":  "More than 1,000 events planned in US after ICE shooting in ...",
                                                                  "source_domain":  "www.theguardian.com",
                                                                  "excerpt":  "ICE Out for Good vigils and rallies are being tracked online by Indivisible, the group behind the No Kings protests"
                                                              },
                                                              {
                                                                  "url":  "https://www.axios.com/2026/01/10/ice-protests-rally-photos",
                                                                  "title":  "In photos: \"ICE Out For Good\" protests rally nationwide",
                                                                  "source_domain":  "www.axios.com",
                                                                  "excerpt":  "Renee Nicole Good\u0027s death and a separate Border Patrol shooting in Portland have ignited widespread outrage."
                                                              }
                                                          ],
                                         "reasoning_short":  "Multiple sources confirm a coalition including Indivisible and the ACLU scheduled over 1,000 \u0027ICE Out For Good\u0027 events for the weekend of January 10-11, 2026.",
                                         "queries_used":  [
                                                              "Indivisible ACLU 1000 rallies ICE Out For Good January 2026",
                                                              "ICE Out For Good rallies nationwide",
                                                              "A coalition including Indivisible and the ACLU scheduled over 1,000 ICE Out For Good rallies nationwide for the weekend of January 10-11, 2026.",
                                                              "A coalition including Indivisible and the ACLU scheduled over 1,000 ICE Out For Good rallies nationwide for the weekend of January 10-11, 2026. official",
                                                              "A coalition including Indivisible and the ACLU scheduled over 1,000 ICE Out For Good rallies nationwide for the weekend of January 10-11, 2026. report"
                                                          ],
                                         "notes":  ""
                                     },
                                     {
                                         "id":  "c3",
                                         "claim":  "Minneapolis police arrested 29 people following a noise protest at the Hilton Canopy Hotel on the night of Friday, January 9, 2026.",
                                         "verdict":  "Supported",
                                         "confidence":  80,
                                         "key_evidence":  [
                                                              {
                                                                  "url":  "https://www.fox9.com/news/minneapolis-ice-shooting-30-detained-hilton-canopy-hotel-protests-escalate-overnight",
                                                                  "title":  "Minneapolis ICE shooting: 30 detained as Hilton Canopy Hotel protests ...",
                                                                  "source_domain":  "www.fox9.com",
                                                                  "excerpt":  "Minneapolis police say they detained and cited 30 people as anti-ICE protests escalated Friday night outside the Hilton Canopy Hotel in downtown Minneapolis."
                                                              },
                                                              {
                                                                  "url":  "https://www.startribune.com/minneapolis-ice-protest-friday-night-arrests-damage-no-injuries/601561757",
                                                                  "title":  "City: 30 arrests, some damage caused during raucous ICE protest ...",
                                                                  "source_domain":  "www.startribune.com",
                                                                  "excerpt":  "Protesters were staged outside a hotel where ICE agents are believed to be staying and made noise for hours."
                                                              },
                                                              {
                                                                  "url":  "https://dnyuz.com/2026/01/10/protesters-descend-on-minneapolis-hotel-where-they-believed-federal-agents-were-staying-after-deadly-ice-shooting/",
                                                                  "title":  "Protesters descend on Minneapolis hotel where they believed federal ...",
                                                                  "source_domain":  "dnyuz.com",
                                                                  "excerpt":  "Hundreds of rowdy anti-ICE protesters shouting curses descended on a Minneapolis hotel Friday night, where they believed federal agents were"
                                                              },
                                                              {
                                                                  "url":  "https://kstp.com/kstp-news/top-news/anti-ice-protests-continue-with-demonstrations-at-graduate-hotel-whipple-federal-building/",
                                                                  "title":  "Anti-ICE protests continue with demonstrations at Graduate hotel, ...",
                                                                  "source_domain":  "kstp.com",
                                                                  "excerpt":  "The event made for a noisy demonstration outside the hotel, the second large protest outside a Hilton-owned hotel in the Twin Cities in the past week. On Friday, at least 29 people were detained after a demonstration outside the Canopy Hote..."
                                                              },
                                                              {
                                                                  "url":  "https://www.reuters.com/world/us/fatal-ice-shooting-minneapolis-activist-sets-stage-national-protests-2026-01-10/",
                                                                  "title":  "Tens of thousands protest in Minneapolis over fatal ICE shooting ...",
                                                                  "source_domain":  "www.reuters.com",
                                                                  "excerpt":  "More than 200 law enforcement officers ... City of Minneapolis said in a statement. Police Chief Brian O’Hara said some in the crowd scrawled graffiti and damaged windows at the Depot Renaissance Hotel. He said the gathering at the Hilton C..."
                                                              },
                                                              {
                                                                  "url":  "https://www.visaverge.com/news/police-arrest-29-during-downtown-minneapolis-protests-outside-hotels/",
                                                                  "title":  "Police Arrest 29 During Downtown Minneapolis Protests Outside Hotels",
                                                                  "source_domain":  "www.visaverge.com",
                                                                  "excerpt":  "Police Arrest 29 During Downtown Minneapolis Protests Outside Hotels · Police declared the gathering an unlawful assembly at around 10:15 p.m., authorities said, and issued multiple orders for demonstrators to leave before officers moved to..."
                                                              }
                                                          ],
                                         "reasoning_short":  "Multiple reports, including from Reuters and KSTP, confirm 29 arrests following a noise protest at the Hilton Canopy Hotel on Friday, January 9, 2026.",
                                         "queries_used":  [
                                                              "Minneapolis police arrests Hilton Canopy Hotel January 9 2026",
                                                              "29 arrests Minneapolis protest Hilton Canopy",
                                                              "Minneapolis police arrested 29 people following a noise protest at the Hilton Canopy Hotel on the night of Friday, January 9, 2026.",
                                                              "Minneapolis police arrested 29 people following a noise protest at the Hilton Canopy Hotel on the night of Friday, January 9, 2026. official",
                                                              "Minneapolis police arrested 29 people following a noise protest at the Hilton Canopy Hotel on the night of Friday, January 9, 2026. report"
                                                          ],
                                         "notes":  ""
                                     },
                                     {
                                         "id":  "c4",
                                         "claim":  "Representatives Angie Craig, Kelly Morrison, and Ilhan Omar were denied entry to the regional ICE headquarters at the Whipple Federal Building on January 10, 2026.",
                                         "verdict":  "Supported",
                                         "confidence":  80,
                                         "key_evidence":  [
                                                              {
                                                                  "url":  "https://www.cbsnews.com/minnesota/news/omar-craig-morrison-denied-access-ice-facility-minneapolis/",
                                                                  "title":  "3 congressional lawmakers say they were denied access to ICE facility ...",
                                                                  "source_domain":  "www.cbsnews.com",
                                                                  "excerpt":  "Three Democratic lawmakers said they were denied access to the ICE facility at the Whipple Federal Building in Minneapolis on Saturday."
                                                              },
                                                              {
                                                                  "url":  "https://www.theguardian.com/us-news/2026/jan/10/ilhan-omar-house-members-ice-facility-minnesota",
                                                                  "title":  "Ilhan Omar and two other House members blocked from visiting ICE ...",
                                                                  "source_domain":  "www.theguardian.com",
                                                                  "excerpt":  "Democrats ejected even though judge ruled Congress members can’t be barred from visiting ICE facilities"
                                                              },
                                                              {
                                                                  "url":  "https://sahanjournal.com/immigration/omar-morrison-craig-denied-access-detention-facility/",
                                                                  "title":  "U.S. Rep. Omar, others denied access to ICE detention facility",
                                                                  "source_domain":  "sahanjournal.com",
                                                                  "excerpt":  "U.S Reps. Ilhan Omar, Kelly Morrison and Angie Craig were denied access to the Fort Snelling immigration detention facility at Fort Snelling on Saturday during a surprise visit."
                                                              },
                                                              {
                                                                  "url":  "https://www.politico.com/news/2026/01/10/minnesota-democrats-ice-00721211",
                                                                  "title":  "Day after Minneapolis shooting, Noem ordered new restriction on ...",
                                                                  "source_domain":  "www.politico.com",
                                                                  "excerpt":  "That order, put into effect Thursday ... visits to ICE facilities. That new policy appears to explain a conflict that unfolded Saturday, when three House Democrats from Minnesota were denied entry to a detention facility in the Whipple fede..."
                                                              },
                                                              {
                                                                  "url":  "https://www.bostonglobe.com/2026/01/19/nation/minneapolis-congress-access-ice-facilities/",
                                                                  "title":  "Judge refuses to block new DHS policy limiting Congress members’ ...",
                                                                  "source_domain":  "www.bostonglobe.com",
                                                                  "excerpt":  "The federal judge concluded that the Department of Homeland Security didn’t violate an earlier court order when it reimposed a seven-day notice requirement for congressional oversight visits."
                                                              },
                                                              {
                                                                  "url":  "https://thehill.com/homenews/state-watch/5682920-ice-facility-access-denied/",
                                                                  "title":  "Ilhan Omar, other Minnesota reps barred from ICE facility in ...",
                                                                  "source_domain":  "thehill.com",
                                                                  "excerpt":  "Three Minnesota Democratic congresswomen said that they were denied access to an Immigration and Customs Enforcement (ICE) processing center in Minneapolis on Saturday morning. In an intervie…"
                                                              }
                                                          ],
                                         "reasoning_short":  "Multiple reports confirm that Representatives Craig, Morrison, and Omar were denied entry to the ICE facility at the Whipple Federal Building on Saturday, January 10, 2026.",
                                         "queries_used":  [
                                                              "Angie Craig Ilhan Omar denied entry Whipple Federal Building January 10 2026",
                                                              "Minnesota Democrats denied entry ICE headquarters Minneapolis",
                                                              "Representatives Angie Craig, Kelly Morrison, and Ilhan Omar were denied entry to the regional ICE headquarters at the Whipple Federal Building on January 10, 2026.",
                                                              "Representatives Angie Craig, Kelly Morrison, and Ilhan Omar were denied entry to the regional ICE headquarters at the Whipple Federal Building on January 10, 2026. official",
                                                              "Representatives Angie Craig, Kelly Morrison, and Ilhan Omar were denied entry to the regional ICE headquarters at the Whipple Federal Building on January 10, 2026. report"
                                                          ],
                                         "notes":  ""
                                     }
                                 ],
                      "meta":  {
                                   "queries_count":  20,
                                   "runtime_ms":  145551
                               }
                  },
    "image_analysis":  {
                           "scores":  {
                                          "emotional":  2,
                                          "composition":  1,
                                          "symbolic":  2,
                                          "alignment":  0
                                      },
                           "bias_index":  0.417,
                           "category":  "mild",
                           "signals":  [
                                           "Hand-lettered \u0027SHE WAS GOOD\u0027 sign in foreground",
                                           "Large floral memorial for an individual",
                                           "Background crowd with \u0027ICE OUT\u0027 signs"
                                       ],
                           "limitations":  "The identity of the person memorialized and the specific protest location cannot be determined from visual evidence alone.",
                           "reasoning":  "The image emphasizes a personal memorial and political signage to create a narrative of loss and protest. While documenting a public event, the visual focus on emotive symbols and specific slogans directs the viewer\u0027s interpretation toward a particular sentiment."
                       },
    "image_context_used":  "Alt text: unknown Key figures: Renee Good (deceased), Ellison Montgomery (protester), Leah Greenberg (Indivisible co-executive director), Jacob Frey (Minneapolis Mayor), Brian O\u0027Hara (Police Chief), Angie Craig (U.S. Representative), Kelly Morrison (U.S. Representative), Ilhan Omar (U.S. Representative), Tricia McLaughlin (DHS spokesperson). Key events: Fatal shooting of Renee Good by ICE agent, tens of thousands protesting in Minneapolis, over 1,000 \"ICE Out\" rallies nationwide, clashes at hotels, denied access to ICE facility for Minnesota Democrats. Background: The protests are a response to the shooting of Renee Good by an ICE agent, highlighting ongoing tensions between federal immigrat...",
    "run_id":  "run_1768876319724_x83lk7"
};

function loadSampleArticle() {
  if (urlInput) {
    urlInput.value = "";
  }

  if (headlineInput) {
    headlineInput.value = "Tens of thousands protest in Minneapolis over fatal ICE shooting";
  }

  if (articleInput) {
    articleInput.value = "Minneapolis police estimate tens of thousands present at protests on Saturday Mayor urges protesters to remain peaceful and not \"take the bait\" from Trump Over 1,000 \"ICE Out\" rallies planned across U.S. Minnesota Democrats denied access to ICE facility outside Minneapolis MINNEAPOLIS, Jan 10 (Reuters) - Tens of thousands of people marched through Minneapolis on Saturday to decry the fatal shooting of a woman by a U.S. immigration agent, part of more than 1,000 rallies planned nationwide this weekend against the federal government's deportation drive. The massive turnout in Minneapolis despite a whipping, cold wind underscores how the fatal shooting of 37-year-old Renee Good by an Immigration and Customs Enforcement officer on Wednesday has struck a chord, fueling protests in major cities and some towns. Minnesota's Democratic leaders and the administration of President Donald Trump, a Republican, have offered starkly different accounts of the incident. Led by a team of Indigenous Mexican dancers, demonstrators in Minneapolis, which has a metropolitan population of 3.8 million, marched towards the residential street where Good was shot in her car. The boisterous crowd, which the Minneapolis Police Department estimated in the tens of thousands, chanted Good's name and slogans such as \"Abolish ICE\" and \"No justice, no peace -- get ICE off our streets.\" \"I'm insanely angry, completely heartbroken and devastated, and then just like longing and hoping that things get better,\" Ellison Montgomery, a 30-year-old protester, told Reuters. Minnesota officials have called the shooting unjustified, pointing to bystander video they say showed Good's vehicle turning away from the agent as he fired. The Department of Homeland Security, which oversees ICE, has maintained that the agent acted in self-defense because Good, a volunteer in a community network that monitors and records ICE operations in Minneapolis, drove forward in the direction of the agent who then shot her, after another agent had approached the driver's side and told her to get out of the car. The shooting on Wednesday came soon after some 2,000 federal officers were dispatched to the Minneapolis-St. Paul area in what DHS has called its largest operation ever, deepening a rift between the administration and Democratic leaders in the state. Federal-state tensions escalated further on Thursday when a U.S. Border Patrol agent in Portland, Oregon, shot and wounded a man and woman in their car after an attempted vehicle stop. Using language similar to its description of the Minneapolis incident, DHS said the driver had tried to \"weaponize\" his vehicle and run over agents. The two DHS-related shootings prompted a coalition of progressive and civil rights groups, including Indivisible and the American Civil Liberties Union, to plan more than 1,000 events under the banner \"ICE Out For Good\" on Saturday and Sunday. The rallies have been scheduled to end before nightfall to minimize the potential for violence. In Philadelphia, protesters chanted \"ICE has got to go\" and \"No fascist USA,\" as they marched from City Hall to a rally outside a federal detention facility, according to the local ABC affiliate. In Manhattan, several hundred people carried anti-ICE signs as they walked past an immigration court where agents have arrested migrants following their hearings. \"We demand justice for Renee, ICE out of our communities, and action from our elected leaders. Enough is enough,\" said Leah Greenberg, co-executive director of Indivisible. Minnesota became a major flashpoint in the administration's efforts to deport millions of immigrants months before the Good shooting, with Trump criticizing its Democratic leaders amid a massive welfare fraud scandal involving some members of the large Somali-American community there. Minneapolis Mayor Jacob Frey, a Democrat who has been critical of immigration agents and the shooting, told a press conference earlier on Saturday that the demonstrations have remained mostly peaceful and that anyone damaging property or engaging in unlawful activity would be arrested by police. \"We will not counter Donald Trump's chaos with our own brand of chaos,\" Frey said. \"He wants us to take the bait.\" More than 200 law enforcement officers were deployed Friday night to control protests that led to $6,000 in damage at the Depot Renaissance Hotel and failed attempts by some demonstrators to enter the Hilton Canopy Hotel, believed to house ICE agents, the City of Minneapolis said in a statement. Police Chief Brian O'Hara said some in the crowd scrawled graffiti and damaged windows at the Depot Renaissance Hotel. He said the gathering at the Hilton Canopy Hotel began as a \"noise protest\" but escalated as more than 1,000 demonstrators converged on the site, leading to 29 arrests. \"We initiated a plan and took our time to de-escalate the situation, issued multiple warnings, declaring an unlawful assembly, and ultimately then began to move in and disperse the crowd,\" O'Hara said. Three Minnesota congressional Democrats showed up at a regional ICE headquarters near Minneapolis on Saturday morning but were denied access. Legislators called the denial illegal. \"We made it clear to ICE and DHS that they were violating federal law,\" U.S. Representative Angie Craig told reporters as she stood outside the Whipple Federal Building in St. Paul with Representatives Kelly Morrison and Ilhan Omar. Federal law prohibits DHS from blocking members of Congress from entering ICE detention sites, but DHS has increasingly restricted such oversight visits, prompting confrontations with Democratic lawmakers. \"It is our job as members of Congress to make sure those detained are treated with humanity, because we are the damn United States of America,\" Craig said. Referencing the damage and protests at Minneapolis hotels overnight, DHS spokesperson Tricia McLaughlin said the congressional Democrats were denied entry to ensure \"the safety of detainees and staff, and in compliance with the agency's mandate.\" She said DHS policies require members of Congress to notify ICE at least seven days in advance of facility visits.";
  }

  if (analyzeBtn) {
    analyzeBtn.focus();
    analyzeBtn.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  updateUrlMode();
  loadDemoImage();
  stopLoadingProgress();
  setLoading(false);
  clearStatus();
  resetOutputs();
  renderVerification(SAMPLE_RESULTS.factcheck);
  renderImageAnalysis(SAMPLE_RESULTS.image_analysis);
  renderAnalysis(SAMPLE_RESULTS.prosecutor, SAMPLE_RESULTS.defender);
  renderSummary(SAMPLE_RESULTS.prosecutor, SAMPLE_RESULTS.defender, SAMPLE_RESULTS.judge, SAMPLE_RESULTS.factcheck, null);
}
function buildRequestBody() {
  var url = urlInput ? urlInput.value.trim() : "";
  var headline = headlineInput ? headlineInput.value.trim() : "";
  var article = articleInput ? articleInput.value.trim() : "";
  var payload = {};
  if (url) {
    payload.url = url;
  } else {
    payload.headline = headline;
    payload.article = article;
  }

  if (imagePayload) {
    payload.image = imagePayload;
  }

  return payload;
}

function getExtractUrl() {
  var api = API_URL || "";
  if (api.endsWith("/analyze")) {
    return api.slice(0, api.length - "/analyze".length) + "/extract-url";
  }
  return api.replace(/\/+$/, "") + "/extract-url";
}

function showErrorState(message) {
  clearStatus();
  stopLoadingProgress();
  if (verdictEl) {
    verdictEl.textContent = "Error";
    verdictEl.className = "verdict-chip verdict-unverified";
  }
  if (synthesisReasonEl) {
    synthesisReasonEl.textContent = message || "Analysis failed.";
    synthesisReasonEl.classList.remove("muted");
  }
  renderImageAnalysisEmpty();
  renderVerificationHostEmpty();
  renderAnalysisHostEmpty();
  setLoading(false);
}

async function fetchFromUrl() {
  var url = urlInput ? urlInput.value.trim() : "";
  if (!url) return;

  isUrlFetching = true;
  updateUrlMode();
  setStatus("Fetching URL...", "warn");

  try {
    var resp = await fetch(getExtractUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url })
    });
    var data = await resp.json();

    if (!resp.ok || !data) {
      setStatus("Server error while fetching URL.", "error", 1200);
      isUrlFetching = false;
      updateUrlMode();
      return;
    }

    if (data.status !== "ok") {
      setStatus("URL inaccessible or blocked.", "warn", 1200);
      isUrlFetching = false;
      updateUrlMode();
      return;
    }

    if (headlineInput) headlineInput.value = data.headline || "";
    if (articleInput) articleInput.value = data.article || "";
    if (urlInput) urlInput.value = "";
    isUrlFetching = false;
    updateUrlMode();
    setStatus("URL loaded.", "ok", 1200);
  } catch (err) {
    setStatus("Server error while fetching URL.", "error", 1200);
    isUrlFetching = false;
    updateUrlMode();
  }
}

async function analyze() {
  var headline = headlineInput ? headlineInput.value.trim() : "";
  var article = articleInput ? articleInput.value.trim() : "";
  var url = urlInput ? urlInput.value.trim() : "";

  if (url) {
    alert("Please fetch the URL and verify the headline/article before analyzing.");
    return;
  }

  if (!url && (!headline || !article)) {
    alert("Please enter a headline and article text, or provide a URL.");
    return;
  }

  setLoading(true);
  resetOutputs();
  renderVerificationHostEmpty();
  renderAnalysisHostEmpty();

  setStatus("Analyzing...");
  startLoadingProgress();
  try {
    var resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequestBody())
    });

    var data = await resp.json();

    if (!resp.ok) {
      showErrorState("Analysis failed.");
      return;
    }

    renderVerification(data.factcheck);
    renderImageAnalysis(data.image_analysis);
    renderAnalysis(data.prosecutor, data.defender);
    renderSummary(data.prosecutor, data.defender, data.judge, data.factcheck, data.synthesis_meta);

    clearStatus();
    stopLoadingProgress();
    setLoading(false);
  } catch (err) {
    showErrorState("Analysis failed.");
  }
}

function bindDom() {
  analyzeBtn = document.getElementById("analyzeBtn");
  fetchUrlBtn = document.getElementById("fetchUrlBtn");
  demoBtn = document.getElementById("demoBtn");
  clearBtn = document.getElementById("clearBtn");

  headlineInput = document.getElementById("headline");
  urlInput = document.getElementById("urlInput");
  articleInput = document.getElementById("article");

  visualUpload = document.getElementById("visualUpload");
  previewContainer = document.getElementById("previewContainer");
  previewImg = document.getElementById("previewImg");
  removeFileBtn = document.getElementById("removeFileBtn");

  statusEl = document.getElementById("status");
  loadingWrap = document.getElementById("loadingWrap");
  loadingFill = document.getElementById("loadingFill");

  verificationHost = document.getElementById("verificationHost");
  verifNav = document.getElementById("verifNav");
  prevClaim = document.getElementById("prevClaim");
  nextClaim = document.getElementById("nextClaim");
  claimIndicator = document.getElementById("claimIndicator");

  verdictEl = document.getElementById("verdict");
  pressureBar = document.getElementById("pressureBar");
  pressureLabel = document.getElementById("pressureLabel");
  countVerified = document.getElementById("countVerified");
  countDisproven = document.getElementById("countDisproven");
  countUnverified = document.getElementById("countUnverified");
  keyFactorEl = document.getElementById("keyFactor");
  synthesisReasonEl = document.getElementById("synthesisReason");

  cardHost = document.getElementById("cardHost");
  imageAnalysisHost = document.getElementById("imageAnalysisHost");

  return !!(
    analyzeBtn && demoBtn && clearBtn && fetchUrlBtn &&
    headlineInput && articleInput &&
    statusEl &&
    verificationHost && verifNav && prevClaim && nextClaim && claimIndicator &&
    verdictEl && pressureBar && pressureLabel && countVerified && countDisproven && countUnverified &&
    keyFactorEl && synthesisReasonEl && cardHost && imageAnalysisHost
  );
}

function init() {
  if (!bindDom()) {
    console.warn("BiasLens init: missing required DOM nodes.");
    return;
  }

  if (visualUpload) {
    visualUpload.addEventListener("change", function(e) {
      var file = e.target.files && e.target.files[0];
      if (!file) {
        imagePayload = null;
        return;
      }

      var reader = new FileReader();
      reader.onload = function(evt) {
        var dataUrl = String(evt.target.result || "");
        if (previewImg) previewImg.src = dataUrl;
        if (previewContainer) previewContainer.classList.add("active");

        var baseIndex = dataUrl.indexOf("base64,");
        if (baseIndex === -1) {
          imagePayload = null;
          return;
        }

        imagePayload = {
          mimeType: file.type || "image/jpeg",
          data: dataUrl.slice(baseIndex + 7)
        };
      };
      reader.readAsDataURL(file);
    });
  }

  if (removeFileBtn) {
    removeFileBtn.addEventListener("click", function() {
      if (visualUpload) visualUpload.value = "";
      if (previewImg) previewImg.src = "";
      if (previewContainer) previewContainer.classList.remove("active");
      imagePayload = null;
    });
  }

  if (prevClaim) {
    prevClaim.addEventListener("click", function() {
      if (verifyIdx > 0) renderVerificationCard(verifyIdx - 1);
    });
  }
  if (nextClaim) {
    nextClaim.addEventListener("click", function() {
      if (verifyIdx < verifyAvailable - 1) renderVerificationCard(verifyIdx + 1);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function() {
      if (headlineInput) headlineInput.value = "";
      if (urlInput) urlInput.value = "";
      if (articleInput) articleInput.value = "";
      if (visualUpload) visualUpload.value = "";
      if (previewImg) previewImg.src = "";
      if (previewContainer) previewContainer.classList.remove("active");
      imagePayload = null;
      resetOutputs();
      clearStatus();
      updateUrlMode();
    });
  }

  if (demoBtn) demoBtn.addEventListener("click", loadSampleArticle);
  if (fetchUrlBtn) fetchUrlBtn.addEventListener("click", fetchFromUrl);
  if (analyzeBtn) analyzeBtn.addEventListener("click", analyze);

  if (urlInput) {
    urlInput.addEventListener("input", updateUrlMode);
  }

  document.addEventListener("keydown", function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      analyze();
    }
  });

  document.addEventListener("click", function(e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var header = target.closest(".collapsible-header");
    if (!header) return;
    var content = header.nextElementSibling;
    if (!content) return;
    content.classList.toggle("open");
  });

  resetOutputs();
  clearStatus();
  updateUrlMode();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}


