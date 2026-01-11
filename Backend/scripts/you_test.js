const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

function parseArgs(argv) {
  var args = {
    query: "Minneapolis protest ICE shooting crowd estimate",
    count: "5",
    freshness: "month",
    livecrawl: "",
    livecrawlFormats: "",
    tries: "1",
    dump: false
  };

  for (var i = 2; i < argv.length; i++) {
    var arg = argv[i];
    if (arg === "--query" && argv[i + 1]) {
      args.query = argv[i + 1];
      i++;
    } else if (arg === "--count" && argv[i + 1]) {
      args.count = argv[i + 1];
      i++;
    } else if (arg === "--freshness" && argv[i + 1]) {
      args.freshness = argv[i + 1];
      i++;
    } else if (arg === "--livecrawl" && argv[i + 1]) {
      args.livecrawl = argv[i + 1];
      i++;
    } else if (arg === "--livecrawl-formats" && argv[i + 1]) {
      args.livecrawlFormats = argv[i + 1];
      i++;
    } else if (arg === "--tries" && argv[i + 1]) {
      args.tries = argv[i + 1];
      i++;
    } else if (arg === "--dump") {
      args.dump = true;
    }
  }

  return args;
}

function buildUrl(args) {
  var base = "https://api.you.com/v1/search";
  var params = new URLSearchParams();
  params.set("query", args.query);
  params.set("count", String(args.count));
  if (args.freshness) params.set("freshness", args.freshness);
  if (args.livecrawl) params.set("livecrawl", args.livecrawl);
  if (args.livecrawlFormats) params.set("livecrawl_formats", args.livecrawlFormats);
  return base + "?" + params.toString();
}

async function runOnce(args) {
  if (!process.env.YOU_API_KEY) {
    console.error("Missing YOU_API_KEY in Backend/.env");
    process.exit(1);
  }

  var url = buildUrl(args);
  console.log("Request URL:", url);

  var headers = {
    "X-API-Key": process.env.YOU_API_KEY,
    "Accept-Encoding": "identity",
    "User-Agent": "BiasLens/1.0"
  };

  var response = await fetch(url, { headers: headers });
  var reqId = response.headers.get("x-request-id");
  console.log("Status:", response.status, response.statusText);
  if (reqId) console.log("Header: x-request-id=" + reqId);
  console.log("Header: content-type=" + response.headers.get("content-type"));
  console.log("Header: content-encoding=" + response.headers.get("content-encoding"));

  var text = await response.text();
  console.log("Body length:", text.length);

  if (args.dump) {
    var outPath = path.join(__dirname, "you_test_response.txt");
    fs.writeFileSync(outPath, text, "utf8");
    console.log("Saved full response to:", outPath);
  }

  if (!response.ok) {
    console.log("Error body (first 600 chars):");
    console.log(text.slice(0, 600));
    return;
  }

  try {
    var json = JSON.parse(text);
    var results = [];
    if (json && json.results && Array.isArray(json.results.web)) {
      results = json.results.web;
    } else if (Array.isArray(json.results)) {
      results = json.results;
    }
    console.log("Parsed results count:", results.length);
    if (results.length) {
      console.log("First result sample:");
      console.log({
        url: results[0].url,
        title: results[0].title,
        description: results[0].description || results[0].snippet
      });
    }
  } catch (err) {
    console.log("JSON parse failed:", err.message);
    console.log("Raw response (first 600 chars):");
    console.log(text.slice(0, 600));
  }
}

async function run() {
  var args = parseArgs(process.argv);
  var tries = Math.max(1, parseInt(args.tries, 10) || 1);
  for (var i = 0; i < tries; i++) {
    if (i > 0) console.log("---- retry " + (i + 1) + " ----");
    await runOnce(args);
  }
}

run().catch(function(err) {
  console.error("Request failed:", err.message || err);
  process.exit(1);
});
