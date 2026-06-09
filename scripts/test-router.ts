import { routeQueryWithFallback, logRoutingDecision } from "../lib/query-router";

const testQuestions = [
  // SQL questions (counts, aggregations, trends)
  "How many 311 noise complaints were filed in Brooklyn in 2023?",
  "What was the total number of taxi pickups by borough last month?",
  "Which community board received the most 311 complaints in the last year?",
  "What's the average trip distance for taxi rides originating in Manhattan?",
  "How many NYPD collisions occurred in Queens in 2023?",
  "What percentage of 311 complaints were resolved within 30 days?",
  "Which borough had the highest taxi pickup density per capita?",
  "How many unique taxi drivers operated in NYC last year?",
  "What was the month-over-month change in 311 complaint volume?",
  "How many taxi zones are in each borough?",

  // RAG questions (documents, policy, narrative)
  "What does the Mayor's Management Report say about DSNY response times?",
  "Why did the community board oppose the North Brooklyn rezoning?",
  "What policies does the MMR outline for reducing traffic fatalities?",
  "What were the main concerns raised by residents in Community Board minutes?",
  "How has the city's approach to zoning evolved according to government documents?",
  "What are the environmental impact concerns mentioned in ULURP filings?",
  "What recommendations did the Mayor's Management Report make about transit?",
  "How did community boards respond to the proposed rezoning?",
  "What historical context does the MMR provide about sanitation services?",
  "What are the stated goals for affordable housing in Community Board minutes?",

  // HYBRID questions (data + context)
  "Did 311 noise complaints spike in Bushwick after the 2022 rezoning, and what were residents saying?",
  "How does the NYPD collision rate in Brooklyn compare to what the Mayor's Management Report says the target was?",
  "Which community boards have the highest 311 complaint density, and what are residents saying about it?",
  "What trends do we see in taxi pickups across boroughs, and how does that relate to zoning changes?",
  "Are there more 311 complaints in rezoned areas, and what do Community Board minutes say about resident satisfaction?",
  "How has collision data changed since the traffic safety initiatives mentioned in the MMR?",
  "What's the relationship between 311 complaint volume and what Community Boards documented about service quality?",
  "Do taxi trip patterns reflect the transportation goals outlined in the Mayor's Management Report?",
  "How do NYPD collision hotspots overlap with areas discussed in Community Board minutes?",
  "What does the data show about sanitation efficiency, and how does that compare to MMR targets?",
];

async function main() {
  console.log(`Testing router on ${testQuestions.length} questions...\n`);
  console.log(
    "Question".padEnd(65) +
      "Route".padEnd(10) +
      "Confidence".padEnd(12) +
      "Override".padEnd(10) +
      "Latency"
  );
  console.log("─".repeat(115));

  const results: { route: string; confidence: string; count: number }[] = [];

  for (const q of testQuestions) {
    const decision = await routeQueryWithFallback(q);
    logRoutingDecision(q, decision).catch(console.error);

    console.log(
      q.slice(0, 63).padEnd(65) +
        decision.route.padEnd(10) +
        decision.confidence.padEnd(12) +
        (decision.overridden ? "yes" : "no").padEnd(10) +
        `${decision.latency_ms}ms`
    );

    const key = `${decision.route}-${decision.confidence}`;
    const existing = results.find((r) => r.route === key);
    if (existing) {
      existing.count++;
    } else {
      results.push({
        route: key,
        confidence: decision.confidence,
        count: 1,
      });
    }
  }

  console.log("\n" + "─".repeat(115));
  console.log("\nRoute distribution:");
  const routeCounts = new Map<string, number>();
  for (const q of testQuestions) {
    const decision = await routeQueryWithFallback(q);
    const count = routeCounts.get(decision.route) || 0;
    routeCounts.set(decision.route, count + 1);
  }

  for (const [route, count] of routeCounts) {
    const pct = ((count / testQuestions.length) * 100).toFixed(1);
    console.log(`  ${route}: ${count} (${pct}%)`);
  }

  process.exit(0);
}

main().catch(console.error);
