// server.js (CommonJS, explicit)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const genai = require("@google/genai");
const claimPicker = require("./agents/claimPicker");
const factChecker = require("./agents/factChecker");
const controlBoard = require("./config/controlBoard");

// Load environment variables
dotenv.config();

// App setup
const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// Gemini client
const GoogleGenAI = genai.GoogleGenAI;
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Model choice (Gemini 3 Flash)
const MODEL_NAME = "gemini-3-flash-preview";
const URL_EXTRACT_MODEL = "gemini-2.5-flash-lite";
const YOU_CONTENTS_URL = "https://ydc-index.io/v1/contents";
const URL_EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "article", "image_context"],
  properties: {
    headline: { type: "string", minLength: 4, maxLength: 300 },
    article: { type: "string", minLength: 50, maxLength: 20000 },
    image_context: { type: "string", minLength: 20, maxLength: 1200 }
  }
};
const BIAS_AGENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["position", "evidence"],
  properties: {
    position: { type: "string", enum: ["biased"] },
    evidence: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "reason"],
        properties: {
          quote: { type: "string", minLength: 1, maxLength: 500 },
          reason: { type: "string", minLength: 8, maxLength: 400 }
        }
      }
    }
  }
};
const NEUTRALITY_AGENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["position", "rebuttals"],
  properties: {
    position: { type: "string", enum: ["neutral"] },
    rebuttals: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prosecutor_quote", "counter_quote", "reason"],
        properties: {
          prosecutor_quote: { type: "string", minLength: 1, maxLength: 500 },
          counter_quote: { type: "string", minLength: 1, maxLength: 500 },
          reason: { type: "string", minLength: 8, maxLength: 400 }
        }
      }
    }
  }
};
const JUDGE_AGENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["winner", "reason", "key_factor", "persuasion_index"],
  properties: {
    winner: { type: "string", enum: ["biased", "neutral"] },
    reason: { type: "string", minLength: 20, maxLength: 600 },
    key_factor: { type: "string", minLength: 4, maxLength: 80 },
    persuasion_index: { type: "integer", minimum: 0, maximum: 100 }
  }
};
const IMAGE_ANALYZER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scores", "bias_index", "category", "signals", "limitations", "reasoning"],
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["emotional", "composition", "symbolic", "alignment"],
      properties: {
        emotional: { type: "integer", minimum: 0, maximum: 3 },
        composition: { type: "integer", minimum: 0, maximum: 3 },
        symbolic: { type: "integer", minimum: 0, maximum: 3 },
        alignment: { type: "integer", minimum: 0, maximum: 3 }
      }
    },
    bias_index: { type: "number", minimum: 0, maximum: 1 },
    category: { type: "string", enum: ["neutral", "mild", "strong", "manipulative"] },
    signals: { type: "array", items: { type: "string" }, maxItems: 4 },
    limitations: { type: "string", minLength: 4, maxLength: 240 },
    reasoning: { type: "string", minLength: 20, maxLength: 320 }
  }
};

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

function applyTemplate(template, vars) {
  return String(template).replace(/\{\{([A-Z0-9_]+)\}\}/g, function(match, key) {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return match;
  });
}

function withTimeout(promise, ms, label) {
  var timeoutId;
  var timeoutPromise = new Promise(function(_, reject) {
    timeoutId = setTimeout(function() {
      var err = new Error((label || "Request") + " timed out after " + ms + "ms");
      err.name = "TimeoutError";
      reject(err);
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(function() {
    clearTimeout(timeoutId);
  });
}

async function fetchUrlContents(url) {
  var apiKey = process.env.YOU_API_KEY;
  if (!apiKey) {
    throw new Error("Missing YOU_API_KEY");
  }

  var response = await withTimeout(
    fetch(YOU_CONTENTS_URL, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        urls: [url],
        format: "html"
      })
    }),
    25000,
    "You.com contents"
  );

  var text = await response.text();
  if (!response.ok) {
    throw new Error("You.com contents error " + response.status + ": " + text);
  }

  return parseStrictJsonOrThrow(text, "You.com contents");
}

async function cleanArticleWithGemini(options) {
  var opts = options || {};
  var rawHtml = typeof opts.html === "string" ? opts.html : "";
  var rawTitle = typeof opts.title === "string" ? opts.title : "";
  var rawUrl = typeof opts.url === "string" ? opts.url : "";
  var rawHeadline = typeof opts.headline === "string" ? opts.headline : "";
  var rawArticle = typeof opts.article === "string" ? opts.article : "";

  var prompt = applyTemplate(controlBoard.URL_CLEAN_PROMPT_TEMPLATE, {
    URL: rawUrl,
    HTML: rawHtml,
    TITLE: rawTitle,
    HEADLINE: rawHeadline,
    ARTICLE: rawArticle
  });

  var response = await withTimeout(
    ai.models.generateContent({
      model: URL_EXTRACT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: URL_EXTRACT_SCHEMA
      }
    }),
    25000,
    "URL extract clean"
  );

  return parseStrictJsonOrThrow(response.text, "URL Extract Clean");
}

function buildCurrentContext() {
  var now = new Date();
  var timezone = "UTC";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch (err) {
    timezone = "UTC";
  }
  var day = "";
  try {
    day = now.toLocaleDateString("en-US", { weekday: "long" });
  } catch (err) {
    day = "";
  }
  var local = "";
  try {
    local = now.toLocaleString("en-US", { hour12: false });
  } catch (err) {
    local = now.toISOString();
  }
  return {
    currentDatetime: local,
    currentIso: now.toISOString(),
    currentTimezone: timezone,
    currentDay: day
  };
}

function normalizeImageContext(value) {
  var context = typeof value === "string" ? value.trim() : "";
  if (!context) {
    context = "Alt text: unknown. Key figures: unknown. Key events: unknown. Background: unknown.";
  }
  if (context.length > 700) {
    context = context.slice(0, 700) + "...";
  }
  return context;
}

function normalizeImagePayload(image) {
  if (!image || typeof image !== "object") return null;
  var mimeType = typeof image.mimeType === "string" ? image.mimeType : "";
  var data = typeof image.data === "string" ? image.data : "";
  if (!mimeType || !data) return null;
  return { mimeType: mimeType, data: data };
}

async function runImageAnalysis(ai, model, imagePayload, imageContext) {
  var prompt = applyTemplate(controlBoard.IMAGE_ANALYZER_PROMPT, {
    IMAGE_CONTEXT: imageContext || "unknown"
  });

  var response = await ai.models.generateContent({
    model: model,
    contents: [
      {
        inlineData: {
          mimeType: imagePayload.mimeType,
          data: imagePayload.data
        }
      },
      { text: prompt }
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: IMAGE_ANALYZER_SCHEMA
    }
  });

  return parseStrictJsonOrThrow(response.text, "Image Analyzer");
}

// Route
app.post("/analyze", async function (req, res) {
  var headline = typeof req.body.headline === "string" ? req.body.headline : "";
  var article = typeof req.body.article === "string" ? req.body.article : "";
  var url = typeof req.body.url === "string" ? req.body.url : "";
  var imagePayload = normalizeImagePayload(req.body.image);
  var runId = req.body.run_id || ("run_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));

  var hasUrl = url.trim() !== "";
  var hasHeadline = headline.trim() !== "";
  var hasArticle = article.trim() !== "";

  if (!hasUrl && (!hasHeadline || !hasArticle)) {
    res.status(400).json({ error: "Missing headline/article or URL" });
    return;
  }

  var imageContextUsed = "";
  try {
    if (hasHeadline || hasArticle) {
      var contextResult = await cleanArticleWithGemini({
        html: "",
        title: headline,
        url: url,
        headline: headline,
        article: article
      });
      if (contextResult && contextResult.image_context) {
        imageContextUsed = normalizeImageContext(contextResult.image_context);
      }
    }
  } catch (ctxErr) {
    console.warn("[URL Clean] context failed", ctxErr && ctxErr.message ? ctxErr.message : ctxErr);
  }
  if (!imageContextUsed) {
    imageContextUsed = normalizeImageContext("");
  }

  try {
    var imageAnalysis = null;
    if (imagePayload) {
      try {
        imageAnalysis = await runImageAnalysis(ai, MODEL_NAME, imagePayload, imageContextUsed);
      } catch (imgErr) {
        console.warn("Image Analyzer failed:", imgErr.message || imgErr);
        imageAnalysis = null;
      }
    }

    var imageContextNote = imageAnalysis
      ? "IMAGE ANALYSIS (from Image Analyzer): " + JSON.stringify(imageAnalysis)
      : "IMAGE ANALYSIS: none provided.";

    // ---------------------------
    // AGENT 1: BIAS AGENT
    // ---------------------------
    var prosecutorPrompt = applyTemplate(controlBoard.BIAS_AGENT_PROMPT_TEMPLATE, {
      IMAGE_CONTEXT: imageContextNote,
      HEADLINE: headline,
      ARTICLE: article
    });

    var prosecutorResponse = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prosecutorPrompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: BIAS_AGENT_SCHEMA
      }
    });

    var prosecutorText = prosecutorResponse.text;
    var prosecutorJSON = parseStrictJsonOrThrow(prosecutorText, "Bias Agent");
    // ---------------------------
    // AGENT 2: NEUTRALITY AGENT
    // ---------------------------
var defenderPrompt = applyTemplate(controlBoard.NEUTRALITY_AGENT_PROMPT_TEMPLATE, {
  IMAGE_CONTEXT: imageContextNote,
  HEADLINE: headline,
  ARTICLE: article,
  BIAS_OUTPUT: JSON.stringify(prosecutorJSON)
});

    var defenderResponse = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: defenderPrompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: NEUTRALITY_AGENT_SCHEMA
      }
    });

    var defenderText = defenderResponse.text;
    var defenderJSON = parseStrictJsonOrThrow(defenderText, "Neutrality Agent");
    // ---------------------------
    // AGENT 3: JUDGE AGENT
    // ---------------------------
var judgePrompt = applyTemplate(controlBoard.JUDGE_AGENT_PROMPT_TEMPLATE, {
  IMAGE_CONTEXT: imageContextNote,
  BIAS_OUTPUT: JSON.stringify(prosecutorJSON),
  NEUTRAL_OUTPUT: JSON.stringify(defenderJSON),
  PERSUASION_GUIDE: controlBoard.PERSUASION_INDEX_GUIDE
});

    var judgeResponse = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: judgePrompt,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: JUDGE_AGENT_SCHEMA
      }
    });

    var judgeText = judgeResponse.text;
    var judgeJSON = parseStrictJsonOrThrow(judgeText, "Judge Agent");
    var steps = [];
    if (imageAnalysis) steps.push("Image Analyzer completed");
    steps.push("Bias Agent completed");
    steps.push("Neutrality Agent completed");
    steps.push("Judge Agent completed");

    var factcheck = {
      source_match: { status: "skipped", canonical_url: "" },
      claims: [],
      meta: { queries_count: 0, runtime_ms: 0 }
    };

    try {
      var timeContext = buildCurrentContext();
      var claimOutput = await claimPicker.pickClaims({
        ai: ai,
        model: MODEL_NAME,
        headline: headline,
        article: article,
        claimLimit: controlBoard.CLAIM_LIMIT,
        currentDatetime: timeContext.currentDatetime,
        currentIso: timeContext.currentIso,
        currentTimezone: timeContext.currentTimezone,
        currentDay: timeContext.currentDay
      });

      factcheck = await factChecker.runFactCheck({
        ai: ai,
        model: MODEL_NAME,
        headline: headline,
        article: article,
        claims: claimOutput.claims || [],
        freshness: req.body.freshness || process.env.FACTCHECK_FRESHNESS || controlBoard.FRESHNESS_DEFAULT
      });

      steps.push("Fact Checker completed");
    } catch (factErr) {
      console.error("FactCheck error:", factErr);
      factcheck = {
        source_match: { status: "skipped", canonical_url: "" },
        claims: [],
        meta: { queries_count: 0, runtime_ms: 0, error: "factcheck_failed" }
      };
      steps.push("Fact Checker failed");
    }

    // Send result
    res.json({
      steps: steps,
      prosecutor: prosecutorJSON,
      defender: defenderJSON,
      judge: judgeJSON,
      factcheck: factcheck,
      image_analysis: imageAnalysis,
      image_context_used: imagePayload ? imageContextUsed : undefined,
      run_id: runId
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

app.post("/extract-url", async function(req, res) {
  var url = typeof req.body.url === "string" ? req.body.url.trim() : "";
  if (!url) {
    res.status(400).json({ status: "error", error: "Missing url" });
    return;
  }

  console.log("[URL Extract] start", url);

  try {
    var contents = await fetchUrlContents(url);
    var item = Array.isArray(contents) ? contents[0] : null;
    var rawHeadline = item && item.title ? String(item.title).trim() : "";
    var rawArticle = item && item.html ? String(item.html).trim() : "";

    var headline = rawHeadline;
    var article = rawArticle;
    try {
      var cleaned = await cleanArticleWithGemini({ html: rawArticle, title: rawHeadline, url: url, headline: rawHeadline, article: rawArticle });
      if (cleaned && cleaned.headline) headline = String(cleaned.headline).trim();
      if (cleaned && cleaned.article) article = String(cleaned.article).trim();
    } catch (cleanErr) {
      console.warn("[URL Extract] clean failed, using raw", cleanErr.message || cleanErr);
    }

    var status = "ok";
    var error = "";
    console.log("[URL Extract] response received", url);

    if (!headline || article.length < 200) {
      status = "inaccessible";
      error = "insufficient_content";
    }

    console.log("[URL Extract] done", status, "len=" + article.length);
    res.json({
      status: status,
      headline: headline,
      article: article,
      error: error
    });
  } catch (err) {
    if (err && err.name === "TimeoutError") {
      console.error(err.message);
      res.status(504).json({ status: "timeout", error: err.message });
      return;
    }
    console.error(err);
    console.log("[URL Extract] failed");
    res.status(500).json({ status: "error", error: "URL extract failed" });
  }
});

// Start server
app.listen(3000, function () {
  console.log("Server running on http://localhost:3000");
});
