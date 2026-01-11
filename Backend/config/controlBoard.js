const CLAIM_LIMIT = 4;
const RESULTS_PER_CLAIM = 12;
const FRESHNESS_DEFAULT = "month";
const FADE_MIN_MS = 1000;
const FADE_MAX_MS = 2000;
const CLAIM_PICKER_THINKING_LEVEL = "high";

const MAX_RUN_QUERIES = 90;
const MAX_QUERIES_PER_CLAIM = 3;
const VERIFICATION_TIMEOUT_MS = 240000;

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const ALLOWLIST_VERSION = "v1";

const ALLOWLIST_STRICTNESS_DEFAULT = "strict";
const SOURCE_MATCH_DEFAULT = "off";
const YOU_SEARCH_API_URL = "https://api.you.com/v1/search";

const ALLOWED_SOURCE_TLDS = [".gov", ".edu", ".org"];

const TOP_NEWS_DOMAINS = [
  "nytimes.com",
  "washingtonpost.com",
  "wsj.com",
  "cnn.com",
  "foxnews.com",
  "nbcnews.com",
  "cbsnews.com",
  "abcnews.go.com",
  "apnews.com",
  "npr.org"
];

const BASE_TIER1 = [
  "congress.gov",
  "senate.gov",
  "house.gov",
  "govinfo.gov",
  "whitehouse.gov",
  "justice.gov",
  "dhs.gov",
  "state.gov",
  "fbi.gov",
  "bls.gov",
  "census.gov",
  "cdc.gov",
  "supremecourt.gov",
  "uscourts.gov"
];

const BASE_TIER2 = [
  "un.org",
  "who.int",
  "imf.org",
  "worldbank.org",
  "oecd.org"
];

const BASE_TIER3 = [
  "nature.com",
  "sciencedirect.com",
  "nejm.org",
  "jamanetwork.com",
  "thelancet.com",
  "pnas.org",
  "bmj.com"
];

const BASE_TIER4 = [
  "amnesty.org",
  "hrw.org",
  "icrc.org",
  "opensecrets.org",
  "openstates.org",
  "ballotpedia.org",
  "propublica.org"
];

const TRUSTED_DOMAIN_ALLOWLIST = {
  default: {
    tier1: BASE_TIER1,
    tier2: BASE_TIER2,
    tier3: BASE_TIER3,
    tier3_wildcards: [".edu"],
    tier4: BASE_TIER4
  },
  health: {
    tier1: BASE_TIER1.concat(["nih.gov", "cms.gov", "clinicaltrials.gov"]),
    tier2: BASE_TIER2,
    tier3: BASE_TIER3,
    tier3_wildcards: [".edu"],
    tier4: BASE_TIER4
  },
  economy: {
    tier1: BASE_TIER1.concat(["treasury.gov", "usaspending.gov", "gao.gov"]),
    tier2: BASE_TIER2,
    tier3: BASE_TIER3,
    tier3_wildcards: [".edu"],
    tier4: BASE_TIER4
  },
  legal: {
    tier1: BASE_TIER1.concat(["gao.gov"]),
    tier2: BASE_TIER2,
    tier3: BASE_TIER3,
    tier3_wildcards: [".edu"],
    tier4: BASE_TIER4
  },
  security: {
    tier1: BASE_TIER1.concat(["defense.gov", "dni.gov"]),
    tier2: BASE_TIER2,
    tier3: BASE_TIER3,
    tier3_wildcards: [".edu"],
    tier4: BASE_TIER4
  },
  international: {
    tier1: BASE_TIER1,
    tier2: BASE_TIER2,
    tier3: BASE_TIER3,
    tier3_wildcards: [".edu"],
    tier4: BASE_TIER4
  },
  science: {
    tier1: BASE_TIER1,
    tier2: BASE_TIER2,
    tier3: BASE_TIER3,
    tier3_wildcards: [".edu"],
    tier4: BASE_TIER4
  }
};

const CLAIM_PICKER_PROMPT_TEMPLATE =
  "You are a Claim Picker agent.\n\n" +
  "Current context:\n" +
  "- Date/time (local): {{CURRENT_DATETIME}}\n" +
  "- Date/time (ISO): {{CURRENT_ISO}}\n" +
  "- Timezone: {{CURRENT_TIMEZONE}}\n" +
  "- Day of week: {{CURRENT_DAY}}\n\n" +
  "Use high-reasoning internally but return JSON only.\n\n" +
  "Goal: extract the most verifiable and binary claims from the article.\n" +
  "A claim must be checkable using external sources\n\n" +
  "Choose claims that are:\n" +
  "- Specific (names, dates, numbers, official actions, votes, filings, sanctions, arrests, policy changes)\n" +
  "- Binary-checkable (true/false style)\n" +
  "- High-impact (core facts the story depends on)\n\n" +
  "Avoid:\n" +
  "- Pure opinions, emotions, motives, predictions, and vague generalizations\n" +
  "- Claims that require reading the author's mind (\"X wants\", \"X intends\") unless explicitly quoted by an official source\n" +
  "- Claims that are too broad to verify (\"China dominates\" without a concrete metric)\n\n" +
  "IMPORTANT SELECTION RULES:\n" +
  "- Prefer claims that include at least one of: a number, a date/time window (often not stated explicitly many articles will say \"earlier this week\"), a named institution/agency/company, or a named document/event.\n" +
  "- If the article is breaking news and hard to verify, still pick claims that could be verified (votes, meetings, filings, official statements, published reports).\n" +
  "- Do NOT repeat the same claim phrased differently.\n\n" +
  "QUERY RULES (recommended_queries):\n" +
  "- Provide 2 queries per claim.\n" +
  "- Query 1 = precise (include names + date + key action)\n" +
  "- Query 2 = broader fallback (remove date, keep names + action)\n" +
  "- Do not use quotes unless the phrase is unique.\n" +
  "- Keep queries short and searchable.\n\n" +
  "Return JSON only, no markdown. The first character must be { and the last must be }.\n\n" +
  "Return JSON in this exact shape:\n" +
  "{\n" +
  "  \"claims\": [\n" +
  "    {\n" +
  "      \"id\": \"c1\",\n" +
  "      \"claim\": \"short, precise claim\",\n" +
  "      \"claim_type\": \"government|health|economy|legal|security|international|science|education|other\",\n" +
  "      \"entities\": [\"entity1\", \"entity2\"],\n" +
  "      \"time_scope\": \"date or time period\",\n" +
  "      \"recommended_queries\": [\"query 1\", \"query 2\"]\n" +
  "    }\n" +
  "  ]\n" +
  "}\n\n" +
  "Constraints:\n" +
  "- Output between 3 and {{CLAIM_LIMIT}} claims.\n" +
  "- Hard cap is {{CLAIM_LIMIT}}.\n" +
  "- Each claim must be stand-alone and verifiable.\n" +
  "- Each claim must be a single sentence.\n\n" +
  "HEADLINE:\n" +
  "{{HEADLINE}}\n\n" +
  "ARTICLE:\n" +
  "{{ARTICLE}}";

const FACTCHECK_VERDICT_PROMPT_TEMPLATE =
  "You are a Fact Checking evaluator.\n\n" +
  "Task: given ONE claim and provided search results, decide:\n" +
  "- Supported (evidence directly affirms the core claim)\n" +
  "- Contradicted (evidence directly denies the core claim or states the opposite)\n" +
  "- Unverified (evidence is missing, vague, mixed, or only partially related)\n\n" +
  "STRICT EVIDENCE RULES:\n" +
  "- Use ONLY the provided search results. Do NOT use external knowledge.\n" +
  "- Do NOT guess missing numbers/dates.\n" +
  "- Do NOT treat a similar topic as proof of this specific claim.\n\n" +
  "HOW TO DECIDE:\n" +
  "SUPPORTED if at least one source explicitly confirms the core event/action AND the key details match.\n" +
  "CONTRADICTED if a source explicitly disputes the event/action OR reverses the direction (e.g., says it did NOT happen).\n" +
  "UNVERIFIED if:\n" +
  "- sources mention related context but not the claim,\n" +
  "- sources confirm the event but not the critical detail (date/count/name),\n" +
  "- sources are too unclear to establish the claim.\n\n" +
  "DIRECTNESS SCORE (0.0 to 1.0):\n" +
  "- 1.0 = evidence explicitly states the claim with matching key details\n" +
  "- 0.7 = evidence confirms the core event/action but misses ONE key detail (exact count OR exact date)\n" +
  "- 0.4 = evidence is about the same topic/entity but does not confirm the event/action\n" +
  "- 0.0 = no relevant evidence\n\n" +
  "SOURCE USE RULES:\n" +
  "- Prefer sources from the allowed list first.\n" +
  "- Ignore social media, forums, user-generated sites, and personal blogs.\n" +
  "- If the claim is breaking news: allow major news sources if they provide primary quotes, documents, or direct reporting.\n\n" +
  "Return JSON only, no markdown. The first character must be { and the last must be }.\n\n" +
  "Return JSON in this exact shape:\n" +
  "{\n" +
  "  \"verdict\": \"Supported|Contradicted|Unverified\",\n" +
  "  \"directness\": 0.0,\n" +
  "  \"reasoning_short\": \"1-2 sentence justification (required, minimum 12 characters)\"\n" +
  "}\n\n" +
  "ALLOWED SOURCE LIST:\n" +
  "{{ALLOWED_SOURCES}}\n\n" +
  "CLAIM:\n" +
  "{{CLAIM}}\n\n" +
  "FULL SEARCH RESULTS:\n" +
  "{{RAW_RESULTS}}";

module.exports = {
  CLAIM_LIMIT,
  RESULTS_PER_CLAIM,
  FRESHNESS_DEFAULT,
  FADE_MIN_MS,
  FADE_MAX_MS,
  MAX_RUN_QUERIES,
  MAX_QUERIES_PER_CLAIM,
  VERIFICATION_TIMEOUT_MS,
  CACHE_TTL_MS,
  CACHE_MAX_ENTRIES,
  ALLOWLIST_VERSION,
  ALLOWLIST_STRICTNESS_DEFAULT,
  SOURCE_MATCH_DEFAULT,
  YOU_SEARCH_API_URL,
  ALLOWED_SOURCE_TLDS,
  TOP_NEWS_DOMAINS,
  TRUSTED_DOMAIN_ALLOWLIST,
  CLAIM_PICKER_PROMPT_TEMPLATE,
  FACTCHECK_VERDICT_PROMPT_TEMPLATE
};
