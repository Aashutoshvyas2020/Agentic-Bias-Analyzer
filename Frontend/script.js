// script.js — vanilla JS with agent-step streaming

var btn = document.getElementById("analyzeBtn");
var statusEl = document.getElementById("status");

var prosecutorPanel = document.querySelector("#prosecutor .content");
var defenderPanel = document.querySelector("#defender .content");
var judgePanel = document.querySelector("#judge .content");

var API_URL = "https://news-bias-analyzer.onrender.com/analyze";

function setLoading(isLoading, message) {
  if (isLoading) {
    btn.disabled = true;
    statusEl.textContent = message || "Analyzing...";
  } else {
    btn.disabled = false;
    statusEl.textContent = "";
  }
}

function escapeHTML(s) {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clearPanels() {
  prosecutorPanel.innerHTML = "";
  defenderPanel.innerHTML = "";
  judgePanel.innerHTML = "";
}

function timestampHTML() {
  return "<div style='font-size:12px;color:#666;'>Completed at " +
    new Date().toLocaleTimeString() +
    "</div><hr/>";
}

// ---------- RENDERERS ----------

function renderProsecutor(prosecutor) {
  if (!prosecutor || !Array.isArray(prosecutor.evidence)) {
    prosecutorPanel.innerHTML = "<div>Invalid prosecutor output.</div>";
    return;
  }

  var html = timestampHTML();
  html += "<div><b>Position:</b> " + escapeHTML(prosecutor.position) + "</div><hr/>";

  for (var i = 0; i < prosecutor.evidence.length; i++) {
    var item = prosecutor.evidence[i];
    html += '<div class="quote">"' + escapeHTML(item.quote) + '"</div>';
    html += '<div class="reason">' + escapeHTML(item.reason) + "</div>";
    if (i !== prosecutor.evidence.length - 1) html += "<hr/>";
  }

  prosecutorPanel.innerHTML = html;
}

function renderDefender(defender) {
  if (!defender || !Array.isArray(defender.rebuttals)) {
    defenderPanel.innerHTML = "<div>Invalid defender output.</div>";
    return;
  }

  var html = timestampHTML();
  html += "<div><b>Position:</b> " + escapeHTML(defender.position) + "</div><hr/>";

  for (var i = 0; i < defender.rebuttals.length; i++) {
    var item = defender.rebuttals[i];
    html += "<div><b>Prosecutor Quote</b></div>";
    html += '<div class="quote">"' + escapeHTML(item.prosecutor_quote) + '"</div>';
    html += "<div><b>Counter Quote</b></div>";
    html += '<div class="quote">"' + escapeHTML(item.counter_quote) + '"</div>';
    html += "<div><b>Reason</b></div>";
    html += '<div class="reason">' + escapeHTML(item.reason) + "</div>";
    if (i !== defender.rebuttals.length - 1) html += "<hr/>";
  }

  defenderPanel.innerHTML = html;
}

function renderJudge(judge) {
  if (!judge) {
    judgePanel.innerHTML = "<div>Invalid judge output.</div>";
    return;
  }

  var html = "<div style='font-size:12px;letter-spacing:.08em;color:#c8b26a;'>FINAL VERDICT</div>";
  html += timestampHTML();
  html += "<div style='font-size:20px;font-weight:700;letter-spacing:.1em;'>" + escapeHTML(judge.winner.toUpperCase()) + "</div><hr/>";
  html += "<div><b>Reason:</b></div>";
  html += '<div class="reason">' + escapeHTML(judge.reason) + "</div><hr/>";
  html += "<div><b>Key Factor:</b></div>";
  html += '<div class="reason">' + escapeHTML(judge.key_factor) + "</div>";

  judgePanel.innerHTML = html;

    // ---- Framing Pressure Meter ----
  var meter = document.getElementById("pressureMeter");
  var bar = document.getElementById("pressureBar");
  var label = document.getElementById("pressureLabel");

  if (meter && window.__lastProsecutor && window.__lastDefender) {
    var score = computeFramingPressure(window.__lastProsecutor, window.__lastDefender, judge);
    meter.style.display = "block";
    bar.style.width = score + "%";
    label.textContent = score + "% narrative pressure";
  }
}

// ---------- MAIN ACTION ----------

async function analyze() {
  var headline = document.getElementById("headline").value.trim();
  var article = document.getElementById("article").value.trim();

  if (!headline || !article) {
    alert("Please paste both headline and article text.");
    return;
  }

  clearPanels();
  setLoading(true, "Running agents…");

  // Live courtroom activity immediately
  var arena = document.getElementById("arenaContent");
  arena.innerHTML =
    "<div style='letter-spacing:.18em;font-size:11px;color:#CFCFCF'>COURT SESSION OPENED</div>" +
    "<div id='thinking' class='reason'>Prosecution preparing brief…</div>";

  var dots = 0;
  var thinkLoop = setInterval(function () {
    var el = document.getElementById("thinking");
    if (el) {
      el.textContent = "Analyzing narrative structure" + ".".repeat(dots % 4);
      dots++;
    }
  }, 350);

  try {
    var response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headline, article })
    });

    var data = await response.json();
    window.__lastProsecutor = data.prosecutor;
    window.__lastDefender = data.defender;

    clearInterval(thinkLoop); // STOP fake activity

    if (!response.ok) {
      prosecutorPanel.innerHTML =
        "<div><b>Error:</b> " + escapeHTML(data.error || "Request failed") + "</div>";
      setLoading(false, "");
      return;
    }

    renderProsecutor(data.prosecutor);
    renderDefender(data.defender);
    renderArena(data.prosecutor, data.defender);
    renderJudge(data.judge);
    setLoading(false, "");

  } catch (err) {
    clearInterval(thinkLoop);
    prosecutorPanel.innerHTML =
      "<div><b>Error:</b> Backend Error! Check input is longer than 150 words</div>";
    setLoading(false, "");
  }
}

btn.addEventListener("click", function () {
  analyze();
});

function computeFramingPressure(prosecutor, defender, judge) {
  var base = 50;

  var pCount = (prosecutor && prosecutor.evidence) ? prosecutor.evidence.length : 0;
  var dCount = (defender && defender.rebuttals) ? defender.rebuttals.length : 0;

  // Each prosecutorial flag adds pressure
  base += pCount * 6;     // +6 per flag

  // Each substantive rebuttal reduces pressure
  base -= dCount * 4;     // -4 per rebuttal

  // Judge nudge
  if (judge && judge.winner === "biased") base += 10;
  if (judge && judge.winner === "neutral") base -= 10;

  // Clamp 0–100
  if (base < 0) base = 0;
  if (base > 100) base = 100;

  return Math.round(base);
}

function renderArena(prosecutor, defender) {
  var arena = document.getElementById("arenaContent");
  if (!arena || !prosecutor || !defender) return;

  var html = "";

  for (var i = 0; i < prosecutor.evidence.length; i++) {
    var p = prosecutor.evidence[i];

    html += "<div style='margin-bottom:18px;'>";
    html += "<div style='color:#F1F1F1; letter-spacing:.12em; font-size:11px;'>PROSECUTOR</div>";
    html += '<div class="quote">"' + escapeHTML(p.quote) + '"</div>';
    html += '<div class="reason">' + escapeHTML(p.reason) + "</div>";

    // find matching defender rebuttal
    var rebuttal = null;
    for (var j = 0; j < defender.rebuttals.length; j++) {
      if (defender.rebuttals[j].prosecutor_quote === p.quote) {
        rebuttal = defender.rebuttals[j];
        break;
      }
    }

    if (rebuttal) {
      html += "<div style='margin-top:10px;color:#CFCFCF; letter-spacing:.12em; font-size:11px;'>DEFENSE</div>";
      html += '<div class="quote">"' + escapeHTML(rebuttal.counter_quote) + '"</div>';
      html += '<div class="reason">' + escapeHTML(rebuttal.reason) + "</div>";
    } else {
      html += "<div style='margin-top:10px;color:#777; font-size:11px;'>No rebuttal provided.</div>";
    }

    html += "</div><hr/>";
  }

  arena.innerHTML = html;
}
var DEMO_ARTICLE = {
  headline: "US Senate votes to curb military action in Venezuela, Trump says oversight could last years.  [Link to article: https://www.reuters.com/world/americas/trump-says-us-oversight-venezuela-could-last-years-2026-01-08/]",
  article: `US Senate advances war powers resolution
Trump to host oil company bosses at White House on Friday
US president to meet opposition leader Machado next week
Asked if oversight would last a year, Trump says: 'I would say much longer'
Venezuela releases political prisoners in gesture of peace
WASHINGTON, Jan 8 (Reuters) - The U.S. Senate voted on Thursday to advance a resolution that would bar President Donald Trump from taking further military action against Venezuela without congressional authorization, even as Trump said U.S. oversight of the troubled nation could last years.
The Senate voted 52 to 47 on a procedural measure to advance the war powers resolution, as a handful of Trump's fellow Republicans voted with every Democrat in favor of moving ahead toward a final vote on the matter.
The Reuters Tariff Watch newsletter is your daily guide to the latest global trade and tariff news. Sign up here.
Trump told the New York Times in an interview published on Thursday that the U.S. could oversee Venezuela and control its oil revenue for years.
He also appeared to lift a threat of military action against Venezuela's neighbor, Colombia. Trump invited Colombia's leftist leader, whom he had previously called a "sick man," to visit Washington.
"Only time will tell" how long the United States will oversee Venezuela, Trump said. When asked by the newspaper if it would be three months, six months, a year or longer, Trump said: "I would say much longer."
"We will rebuild it in a very profitable way," Trump said of Venezuela, where he sent troops to seize President Nicolas Maduro in a night raid on Saturday.
Trump added that the U.S. was "getting along very well" with the government of interim President Delcy Rodriguez, a longstanding Maduro loyalist who had served as the ousted leader's vice president.
POLITICAL PRISONERS FREED
Venezuela's top lawmaker, Jorge Rodriguez, said on Thursday that a significant number of foreign and Venezuelan prisoners would be freed during the day.
The releases, a repeated demand of the country's political opposition, are a gesture of peace, Rodriguez said, adding the action was unilateral and not agreed upon with any other party.
Top opposition leader Maria Corina Machado's movement, as well as other opposition figures and human rights groups, have demanded the release of political prisoners since the U.S. capture of Maduro.
Local rights group Foro Penal estimates there are 863 political prisoners in the country, including political figures, human rights activists, protesters arrested after the disputed 2024 election and journalists.

Item 1 of 4 U.S. President Donald Trump speaks as Secretary of State Marco Rubio and Secretary of Defense Pete Hegseth look on during a press conference following a U.S. strike on Venezuela where President Nicolas Maduro and his wife, Cilia Flores, were captured, from Trump's Mar-a-Lago club in Palm Beach, Florida, U.S., January 3, 2026. REUTERS/Jonathan Ernst/File Photo
[1/4]U.S. President Donald Trump speaks as Secretary of State Marco Rubio and Secretary of Defense Pete Hegseth look on during a press conference following a U.S. strike on Venezuela where President Nicolas Maduro and his wife, Cilia Flores, were captured, from Trump's Mar-a-Lago club in Palm Beach,... Purchase Licensing Rights, opens new tab Read more


The White House did not respond to a request for comment on the planned prisoner release.
In an interview on Thursday with Fox News Channel's "Hannity," Trump said he planned to meet with Machado when she visits Washington next week.
The Times reported Trump declined to answer questions about why he had decided not to give power in Venezuela to the opposition, which Washington had previously considered the legitimate winner of the 2024 election.
The Senate measure faces a steep climb to become law. It would need to be passed by the House of Representatives - which is also controlled by Trump's Republicans. If both chambers pass the resolution, each would need to secure a two-thirds majority to override a likely Trump veto. Still, Thursday's vote marked a rare sign of congressional Republican pushback against the Trump White House.
"Republicans should be ashamed of the Senators that just voted with Democrats in attempting to take away our Powers to fight and defend the United States of America," Trump said in a social media post.
COLOMBIA THREAT APPEARS TO DISSIPATE
In a post on social media, Trump said: "It was a great honor to speak with the President of Colombia, Gustavo Petro, who called to explain the situation of drugs and other disagreements that we have had. I appreciated his call and tone, and look forward to meeting him in the near future."
Petro described the call, his first with Trump, as cordial.
Trump on Tuesday unveiled a plan to refine and sell up to 50 million barrels of Venezuelan oil that had been stuck in Venezuela under a U.S. blockade.
Venezuela, with the world's biggest proven oil reserves, has become impoverished in recent decades, with 8 million people fleeing abroad in one of the world's biggest migration crises.
Washington and the Venezuelan opposition have long blamed corruption, mismanagement and brutality by the ruling Socialist Party. Maduro blamed the economic damage on U.S. sanctions.
Trump is scheduled to meet with the heads of major oil companies at the White House on Friday to discuss ways of raising Venezuela's oil production. Representatives from the top three U.S. oil companies, Exxon Mobil (XOM.N), opens new tab, ConocoPhillips (COP.N), opens new tab and Chevron (CVX.N), opens new tab, would be present, according to a source familiar with the planning. Trump told Fox News on Thursday that oil companies will spend at least $100 billion in Venezuela.
The companies, all of which have experience in Venezuela, have declined to comment.
Reporting by Reuters bureaux; Writing by Peter Graff and James Oliphant; Editing by Scott Malone, Ros Russell, Rod Nickel
`
};

document.getElementById("demoBtn").addEventListener("click", function () {
  document.getElementById("headline").value = DEMO_ARTICLE.headline;
  document.getElementById("article").value = DEMO_ARTICLE.article;
});