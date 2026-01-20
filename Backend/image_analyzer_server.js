const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const genai = require("@google/genai");
const controlBoard = require("./config/controlBoard");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const GoogleGenAI = genai.GoogleGenAI;
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const MODEL_NAME = "gemini-3-pro-preview";
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

function applyTemplate(template, vars) {
  return String(template).replace(/\{\{([A-Z0-9_]+)\}\}/g, function(match, key) {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return match;
  });
}

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

function normalizeImagePayload(image) {
  if (!image || typeof image !== "object") return null;
  var mimeType = typeof image.mimeType === "string" ? image.mimeType : "";
  var data = typeof image.data === "string" ? image.data : "";
  if (!mimeType || !data) return null;
  return { mimeType: mimeType, data: data };
}

async function runImageAnalysis(imagePayload) {
  var prompt = applyTemplate(controlBoard.IMAGE_ANALYZER_PROMPT, { IMAGE_CONTEXT: "unknown" });

  var response = await ai.models.generateContent({
    model: MODEL_NAME,
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

app.post("/analyze-image", async function(req, res) {
  var imagePayload = normalizeImagePayload(req.body.image);
  if (!imagePayload) {
    res.status(400).json({ error: "Missing image payload" });
    return;
  }

  try {
    var result = await runImageAnalysis(imagePayload);
    res.json({ image_analysis: result });
  } catch (err) {
    if (err && err.name === "InvalidModelJSON") {
      res.status(502).json({ error: "Model did not return strict JSON", details: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Image analysis failed" });
  }
});

app.listen(3001, function() {
  console.log("Image analyzer test server running on http://localhost:3001");
});
