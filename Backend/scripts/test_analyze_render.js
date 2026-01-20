const dotenv = require("dotenv");
const fs = require("fs");

dotenv.config();

function parseArgs(argv) {
  var args = { };
  for (var i = 2; i < argv.length; i += 1) {
    var token = argv[i];
    if (!token.startsWith("--")) continue;
    var key = token.slice(2);
    var next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function readFileIfPath(value) {
  if (!value) return "";
  if (fs.existsSync(value)) {
    return fs.readFileSync(value, "utf8");
  }
  return value;
}

async function run() {
  var args = parseArgs(process.argv);
  var endpoint = args.url || "https://news-bias-analyzer.onrender.com/analyze";
  var headline = readFileIfPath(args.headline || "Tens of thousands protest in Minneapolis over fatal ICE shooting");
  var article = readFileIfPath(args.article || "Minneapolis police estimate tens of thousands present at protests on Saturday Mayor urges protesters to remain peaceful and not \"take the bait\" from Trump Over 1,000 \"ICE Out\" rallies planned across U.S. Minnesota Democrats denied access to ICE facility outside Minneapolis MINNEAPOLIS, Jan 10 (Reuters) - Tens of thousands of people marched through Minneapolis on Saturday to decry the fatal shooting of a woman by a U.S. immigration agent, part of more than 1,000 rallies planned nationwide this weekend against the federal government's deportation drive. The massive turnout in Minneapolis despite a whipping, cold wind underscores how the fatal shooting of 37-year-old Renee Good by an Immigration and Customs Enforcement officer on Wednesday has struck a chord, fueling protests in major cities and some towns. Minnesota's Democratic leaders and the administration of President Donald Trump, a Republican, have offered starkly different accounts of the incident. Led by a team of Indigenous Mexican dancers, demonstrators in Minneapolis, which has a metropolitan population of 3.8 million, marched towards the residential street where Good was shot in her car. The boisterous crowd, which the Minneapolis Police Department estimated in the tens of thousands, chanted Good's name and slogans such as \"Abolish ICE\" and \"No justice, no peace -- get ICE off our streets.\" \"I'm insanely angry, completely heartbroken and devastated, and then just like longing and hoping that things get better,\" Ellison Montgomery, a 30-year-old protester, told Reuters. Minnesota officials have called the shooting unjustified, pointing to bystander video they say showed Good's vehicle turning away from the agent as he fired. The Department of Homeland Security, which oversees ICE, has maintained that the agent acted in self-defense because Good, a volunteer in a community network that monitors and records ICE operations in Minneapolis, drove forward in the direction of the agent who then shot her, after another agent had approached the driver's side and told her to get out of the car. The shooting on Wednesday came soon after some 2,000 federal officers were dispatched to the Minneapolis-St. Paul area in what DHS has called its largest operation ever, deepening a rift between the administration and Democratic leaders in the state. Federal-state tensions escalated further on Thursday when a U.S. Border Patrol agent in Portland, Oregon, shot and wounded a man and woman in their car after an attempted vehicle stop. Using language similar to its description of the Minneapolis incident, DHS said the driver had tried to \"weaponize\" his vehicle and run over agents. The two DHS-related shootings prompted a coalition of progressive and civil rights groups, including Indivisible and the American Civil Liberties Union, to plan more than 1,000 events under the banner \"ICE Out For Good\" on Saturday and Sunday. The rallies have been scheduled to end before nightfall to minimize the potential for violence. In Philadelphia, protesters chanted \"ICE has got to go\" and \"No fascist USA,\" as they marched from City Hall to a rally outside a federal detention facility, according to the local ABC affiliate. In Manhattan, several hundred people carried anti-ICE signs as they walked past an immigration court where agents have arrested migrants following their hearings. \"We demand justice for Renee, ICE out of our communities, and action from our elected leaders. Enough is enough,\" said Leah Greenberg, co-executive director of Indivisible. Minnesota became a major flashpoint in the administration's efforts to deport millions of immigrants months before the Good shooting, with Trump criticizing its Democratic leaders amid a massive welfare fraud scandal involving some members of the large Somali-American community there. Minneapolis Mayor Jacob Frey, a Democrat who has been critical of immigration agents and the shooting, told a press conference earlier on Saturday that the demonstrations have remained mostly peaceful and that anyone damaging property or engaging in unlawful activity would be arrested by police. \"We will not counter Donald Trump's chaos with our own brand of chaos,\" Frey said. \"He wants us to take the bait.\" More than 200 law enforcement officers were deployed Friday night to control protests that led to $6,000 in damage at the Depot Renaissance Hotel and failed attempts by some demonstrators to enter the Hilton Canopy Hotel, believed to house ICE agents, the City of Minneapolis said in a statement. Police Chief Brian O'Hara said some in the crowd scrawled graffiti and damaged windows at the Depot Renaissance Hotel. He said the gathering at the Hilton Canopy Hotel began as a \"noise protest\" but escalated as more than 1,000 demonstrators converged on the site, leading to 29 arrests. \"We initiated a plan and took our time to de-escalate the situation, issued multiple warnings, declaring an unlawful assembly, and ultimately then began to move in and disperse the crowd,\" O'Hara said. Three Minnesota congressional Democrats showed up at a regional ICE headquarters near Minneapolis on Saturday morning but were denied access. Legislators called the denial illegal. \"We made it clear to ICE and DHS that they were violating federal law,\" U.S. Representative Angie Craig told reporters as she stood outside the Whipple Federal Building in St. Paul with Representatives Kelly Morrison and Ilhan Omar. Federal law prohibits DHS from blocking members of Congress from entering ICE detention sites, but DHS has increasingly restricted such oversight visits, prompting confrontations with Democratic lawmakers. \"It is our job as members of Congress to make sure those detained are treated with humanity, because we are the damn United States of America,\" Craig said. Referencing the damage and protests at Minneapolis hotels overnight, DHS spokesperson Tricia McLaughlin said the congressional Democrats were denied entry to ensure \"the safety of detainees and staff, and in compliance with the agency's mandate.\" She said DHS policies require members of Congress to notify ICE at least seven days in advance of facility visits.");

  var payload = {
    headline: String(headline || "").trim(),
    article: String(article || "").trim()
  };

  console.log("Request URL:", endpoint);
  console.log("Request payload:\n", JSON.stringify(payload, null, 2));

  var start = Date.now();
  var resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  var elapsed = Date.now() - start;

  console.log("Status:", resp.status, resp.statusText);
  console.log("Elapsed ms:", elapsed);

  var raw = await resp.text();
  console.log("Raw response (first 2000 chars):\n", raw.slice(0, 2000));

  try {
    var parsed = JSON.parse(raw);
    console.log("Parsed JSON:\n", JSON.stringify(parsed, null, 2));
  } catch (err) {
    console.error("JSON parse failed:", err && err.message ? err.message : err);
  }
}

run().catch(function(err) {
  console.error("Test failed:", err && err.message ? err.message : err);
  process.exit(1);
});
