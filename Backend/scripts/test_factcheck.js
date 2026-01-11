const factChecker = require("../agents/factChecker");

async function run() {
  process.env.DRY_RUN = "1";

  var claims = [
    {
      id: "c1",
      claim: "More than 1,000 rallies were planned nationwide.",
      claim_type: "government",
      entities: ["United States"],
      time_scope: "Saturday",
      recommended_queries: ["more than 1,000 rallies planned nationwide"]
    },
    {
      id: "c2",
      claim: "Some 2,000 federal officers were dispatched to the Minneapolis-St. Paul area.",
      claim_type: "security",
      entities: ["Minneapolis-St. Paul"],
      time_scope: "Wednesday",
      recommended_queries: ["2,000 federal officers dispatched Minneapolis-St. Paul"]
    },
    {
      id: "c3",
      claim: "Federal law prohibits DHS from blocking members of Congress from entering ICE detention sites.",
      claim_type: "legal",
      entities: ["DHS", "ICE"],
      time_scope: "current law",
      recommended_queries: ["federal law Congress access ICE detention sites"]
    },
    {
      id: "c4",
      claim: "More than 200 law enforcement officers were deployed Friday night to control protests.",
      claim_type: "security",
      entities: ["Minneapolis"],
      time_scope: "Friday night",
      recommended_queries: ["more than 200 law enforcement officers deployed Friday night protests"]
    }
  ];

  var output = await factChecker.runFactCheck({
    claims: claims,
    headline: "Tens of thousands protest in Minneapolis over fatal ICE shooting",
    allowlistStrictness: "strict",
    freshness: "month",
    sourceHint: "off",
    logger: { log: function(){}, warn: function(){} }
  });

  console.log(JSON.stringify(output, null, 2));
}

run().catch(function(err) {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
