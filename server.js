// server.js (CommonJS, explicit)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const genai = require("@google/genai");

// Load environment variables
dotenv.config();

// App setup
const app = express();
app.use(cors());
app.use(express.json());

// Gemini client
const GoogleGenAI = genai.GoogleGenAI;
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Model choice (Gemini 3 Flash)
const MODEL_NAME = "gemini-3-flash-preview";

// Helper: safe JSON parse with clear debug info (NO extractJSON)
function parseStrictJsonOrThrow(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    var message =
      label + " returned invalid JSON.\n\n" +
      "Raw output starts with: " + String(text).slice(0, 120) + "\n\n" +
      "Full raw output:\n" + String(text);

    var e = new Error(message);
    e.name = "InvalidModelJSON";
    e.raw = text;
    throw e;
  }
}

// Route
app.post("/analyze", async function (req, res) {
  var headline = req.body.headline;
  var article = req.body.article;

  if (headline === undefined || article === undefined || headline === "" || article === "") {
    res.status(400).json({ error: "Missing headline or article" });
    return;
  }

  try {
    // ---------------------------
    // AGENT 1: BIAS PROSECUTOR
    // ---------------------------
    var prosecutorPrompt =
      "You are a Bias Prosecutor Agent.\n\n" +
      "Your task is to argue that the given news article is rhetorically biased.\n\n" +
      "IMPORTANT RULES (NON-NEGOTIABLE):\n" +
      "- Output MUST be raw JSON only.\n" +
      "- Do NOT use markdown.\n" +
      "- Do NOT use ``` or code blocks.\n" +
      "- Do NOT add any text before or after the JSON.\n" +
      "- The very first character of your response MUST be {.\n" +
      "- The very last character of your response MUST be }.\n\n" +
      "You must rely ONLY on direct quotes from the provided text.\n" +
      "Every claim MUST include an exact quote.\n" +
      "Reasons must be linguistic or framing-based (word choice, emphasis, omission).\n" +
      "Do NOT reference politics, ideology, or external facts.\n\n" +
      "Return the JSON in EXACTLY this format:\n" +
      "{\n" +
      '  "position": "biased",\n' +
      '  "evidence": [\n' +
      "    {\n" +
      '      "quote": "exact quote from the text",\n' +
      '      "reason": "why this quote demonstrates bias"\n' +
      "    }\n" +
      "  ]\n" +
      "}\n\n" +
      "Constraints:\n" +
      "- Maximum 5 evidence items.\n" +
      "- Quotes must be verbatim.\n\n" +
      "HEADLINE:\n" +
      headline +
      "\n\nARTICLE:\n" +
      article;

    var prosecutorResponse = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prosecutorPrompt
    });

    var prosecutorText = prosecutorResponse.text;
    var prosecutorJSON = parseStrictJsonOrThrow(prosecutorText, "Bias Prosecutor");

    // ---------------------------
    // AGENT 2: NEUTRALITY DEFENDER
    // ---------------------------
var defenderPrompt =
  "You are a Neutrality Defender Agent.\n\n" +
  "Your task is to argue that the given news article is neutral or balanced.\n\n" +
  "IMPORTANT RULES (NON-NEGOTIABLE):\n" +
  "- Output MUST be raw JSON only.\n" +
  "- Do NOT use markdown.\n" +
  "- Do NOT use ``` or code blocks.\n" +
  "- Do NOT add any text before or after the JSON.\n" +
  "- The very first character of your response MUST be {.\n" +
  "- The very last character of your response MUST be }.\n\n" +
  "You must directly rebut the Bias Prosecutor’s claims.\n" +
  "You must rely ONLY on direct quotes from the provided text.\n" +
  "Every rebuttal MUST include an exact counter-quote.\n\n" +
  "CRITICAL CONSTRAINT:\n" +
  "An article is NOT neutral if attribution or counter-quotes are minimal, buried, or outweighed\n" +
  "by repeated emotionally loaded language or framing.\n\n" +
  "You may ONLY argue neutrality if the counter-quotes meaningfully balance the overall tone\n" +
  "and emphasis of the article, not merely by existing.\n\n" +
  "Do NOT reference politics, ideology, or external facts.\n\n" +
  "Return the JSON in EXACTLY this format:\n" +
  "{\n" +
  '  "position": "neutral",\n' +
  '  "rebuttals": [\n' +
  "    {\n" +
  '      "prosecutor_quote": "quote from prosecutor evidence",\n' +
  '      "counter_quote": "exact quote from the article/headline",\n' +
  '      "reason": "why this counter-quote meaningfully weakens the bias claim"\n' +
  "    }\n" +
  "  ]\n" +
  "}\n\n" +
  "Constraints:\n" +
  "- Maximum 5 rebuttals.\n" +
  "- Counter-quotes must be verbatim.\n\n" +
  "HEADLINE:\n" +
  headline +
  "\n\nARTICLE:\n" +
  article +
  "\n\nBIAS PROSECUTOR OUTPUT:\n" +
  JSON.stringify(prosecutorJSON);

    var defenderResponse = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: defenderPrompt
    });

    var defenderText = defenderResponse.text;
    var defenderJSON = parseStrictJsonOrThrow(defenderText, "Neutrality Defender");

    // ---------------------------
    // AGENT 3: JUDGE
    // ---------------------------
var judgePrompt =
  "You are the Judge Agent.\n\n" +
  "Your task is to evaluate which side argued better: Bias Prosecutor or Neutrality Defender.\n\n" +
  "IMPORTANT RULES (NON-NEGOTIABLE):\n" +
  "- Output MUST be raw JSON only.\n" +
  "- Do NOT use markdown.\n" +
  "- Do NOT use ``` or code blocks.\n" +
  "- Do NOT add any text before or after the JSON.\n" +
  "- The very first character of your response MUST be {.\n" +
  "- The very last character of your response MUST be }.\n\n" +
  "You do NOT decide objective truth.\n" +
  "You ONLY judge argument quality and evidence.\n\n" +
  "EVALUATION CRITERIA (ALL MUST BE CONSIDERED):\n" +
  "1) Quantity and repetition of emotionally loaded language\n" +
  "2) Placement and prominence of counter-quotes\n" +
  "3) Whether balance is substantive or merely procedural\n\n" +
  "CRITICAL RULE:\n" +
  "If emotionally loaded language appears repeatedly while counter-perspectives are brief,\n" +
  "isolated, or relegated to attribution, this counts AGAINST neutrality.\n\n" +
  "You must explain why the LOSING side’s strongest evidence was insufficient.\n\n" +
  "Return the JSON in EXACTLY this format:\n" +
  "{\n" +
  '  "winner": "biased",\n' +
  '  "reason": "2–3 sentences explaining why this side argued better",\n' +
  '  "key_factor": "short descriptive phrase (2–6 words)"\n' +
  "}\n\n" +
  'Constraints:\n' +
  '- winner MUST be exactly "biased" or "neutral".\n' +
  "- key_factor must NOT be a single letter or placeholder.\n\n" +
  "BIAS PROSECUTOR OUTPUT:\n" +
  JSON.stringify(prosecutorJSON) +
  "\n\nNEUTRALITY DEFENDER OUTPUT:\n" +
  JSON.stringify(defenderJSON);

    var judgeResponse = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: judgePrompt
    });

    var judgeText = judgeResponse.text;
    var judgeJSON = parseStrictJsonOrThrow(judgeText, "Judge");

    // Send result
res.json({
  steps: [
    "Bias Prosecutor completed",
    "Neutrality Defender completed",
    "Judge completed"
  ],
  prosecutor: prosecutorJSON,
  defender: defenderJSON,
  judge: judgeJSON
});

  } catch (error) {
    // If we fail because JSON is invalid, include raw output for debugging
    if (error && error.name === "InvalidModelJSON") {
      res.status(502).json({
        error: "Model did not return strict JSON",
        details: error.message
      });
      return;
    }

    console.error(error);
    res.status(500).json({ error: "Analysis failed" });
  }
});

// Start server
app.listen(3000, function () {
  console.log("Server running on http://localhost:3000");
});
