const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const controlBoard = require("./config/controlBoard");
const genai = require("@google/genai");
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const YOU_CONTENTS_URL = "https://ydc-index.io/v1/contents";
const URL_EXTRACT_MODEL = "gemini-2.5-flash-lite";
const REQUEST_TIMEOUT_MS = 25000;
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
    REQUEST_TIMEOUT_MS,
    "You.com contents"
  );

  var text = await response.text();
  if (!response.ok) {
    throw new Error("You.com contents error " + response.status + ": " + text);
  }

  return parseStrictJsonOrThrow(text, "You.com contents");
}

const GoogleGenAI = genai.GoogleGenAI;
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

async function cleanArticleWithGemini(rawHtml, rawTitle, url) {
  var prompt = applyTemplate(controlBoard.URL_CLEAN_PROMPT_TEMPLATE, {
    URL: url,
    HTML: rawHtml,
    TITLE: rawTitle,
    HEADLINE: rawTitle,
    ARTICLE: ""
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
    REQUEST_TIMEOUT_MS,
    "URL extract clean"
  );

  return parseStrictJsonOrThrow(response.text, "URL Extract Clean");
}

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
      var cleaned = await cleanArticleWithGemini(rawArticle, rawHeadline, url);
      if (cleaned && cleaned.headline) headline = String(cleaned.headline).trim();
      if (cleaned && cleaned.article) article = String(cleaned.article).trim();
    } catch (cleanErr) {
      console.warn("[URL Extract] clean failed, using raw", cleanErr.message || cleanErr);
    }

    var status = "ok";
    var error = "";
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

app.listen(3002, function() {
  console.log("URL extractor test server running on http://localhost:3002");
});
