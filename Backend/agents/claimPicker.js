const {
  CLAIM_LIMIT,
  CLAIM_PICKER_PROMPT_TEMPLATE,
  CLAIM_PICKER_THINKING_LEVEL
} = require("../config/controlBoard");
const CLAIM_PICKER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "claim", "claim_type", "entities", "time_scope", "recommended_queries"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 20 },
          claim: { type: "string", minLength: 8, maxLength: 220 },
          claim_type: {
            type: "string",
            enum: ["government", "health", "economy", "legal", "security", "international", "science", "education", "other"]
          },
          entities: { type: "array", items: { type: "string" } },
          time_scope: { type: "string" },
          recommended_queries: { type: "array", items: { type: "string" }, minItems: 1 }
        }
      }
    }
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

function fillTemplate(template, values) {
  return template
    .replace(/\{\{CLAIM_LIMIT\}\}/g, String(values.claimLimit))
    .replace(/\{\{HEADLINE\}\}/g, values.headline || "")
    .replace(/\{\{ARTICLE\}\}/g, values.article || "")
    .replace(/\{\{CURRENT_DATETIME\}\}/g, values.currentDatetime || "")
    .replace(/\{\{CURRENT_ISO\}\}/g, values.currentIso || "")
    .replace(/\{\{CURRENT_TIMEZONE\}\}/g, values.currentTimezone || "")
    .replace(/\{\{CURRENT_DAY\}\}/g, values.currentDay || "");
}

function normalizeClaimType(claimType) {
  var allowed = {
    government: true,
    health: true,
    economy: true,
    legal: true,
    security: true,
    international: true,
    science: true,
    education: true,
    other: true
  };
  if (!claimType || !allowed[String(claimType).toLowerCase()]) return "other";
  return String(claimType).toLowerCase();
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(function(item) { return String(item).trim(); }).filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
}

async function pickClaims(opts) {
  var ai = opts.ai;
  var model = opts.model;
  var headline = opts.headline;
  var article = opts.article;
  var limit = opts.claimLimit || CLAIM_LIMIT;

  var prompt = fillTemplate(CLAIM_PICKER_PROMPT_TEMPLATE, {
    claimLimit: limit,
    headline: headline,
    article: article,
    currentDatetime: opts.currentDatetime,
    currentIso: opts.currentIso,
    currentTimezone: opts.currentTimezone,
    currentDay: opts.currentDay
  });

  var response = await ai.models.generateContent({
    model: model,
    contents: prompt,
    config: {
      thinkingLevel: CLAIM_PICKER_THINKING_LEVEL,
      responseMimeType: "application/json",
      responseJsonSchema: CLAIM_PICKER_SCHEMA
    }
  });

  var text = response.text;
  var json = parseStrictJsonOrThrow(text, "Claim Picker");
  var claims = Array.isArray(json.claims) ? json.claims : [];

  var normalized = [];
  for (var i = 0; i < claims.length; i++) {
    var item = claims[i] || {};
    if (!item.claim || typeof item.claim !== "string") continue;
    normalized.push({
      id: item.id ? String(item.id) : ("c" + (normalized.length + 1)),
      claim: String(item.claim).trim(),
      claim_type: normalizeClaimType(item.claim_type),
      entities: normalizeArray(item.entities),
      time_scope: item.time_scope ? String(item.time_scope) : "",
      recommended_queries: normalizeArray(item.recommended_queries)
    });
    if (normalized.length >= limit) break;
  }

  if (!normalized.length) {
    return { claims: [] };
  }

  for (var j = 0; j < normalized.length; j++) {
    if (!normalized[j].recommended_queries.length) {
      normalized[j].recommended_queries = [normalized[j].claim];
    }
  }

  return { claims: normalized };
}

module.exports = {
  pickClaims
};
