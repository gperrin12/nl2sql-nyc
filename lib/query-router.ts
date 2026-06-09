import Anthropic from "@anthropic-ai/sdk";
import { Pool } from "pg";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const db = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  max: 3,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Route = "SQL" | "RAG" | "HYBRID";
export type Confidence = "high" | "medium" | "low";

export interface RouteDecision {
  route: Route;
  confidence: Confidence;
  reasoning: string;
  latency_ms: number;
  overridden: boolean;
}

// ---------------------------------------------------------------------------
// Router system prompt
// ---------------------------------------------------------------------------

const ROUTER_SYSTEM_PROMPT = `You are a query router for an NYC civic intelligence system.

Classify the incoming question into exactly one of three categories:

SQL: Questions answerable from structured tables in Athena — counts, trends,
     comparisons, rankings, aggregations over 311 complaints, taxi trips, NYPD
     collision data, census demographics, subway ridership, or taxi zones.

RAG: Questions answerable from government documents — policy context, narrative,
     community response, historical explanations, or content from the Mayor's
     Management Report, Community Board minutes, or ULURP filings.

HYBRID: Questions that require BOTH structured data AND document context to answer
        well. The data alone would be incomplete; the documents alone would miss
        the numbers.

Few-shot examples:

Question: "How many 311 noise complaints were filed in Brooklyn in 2023?"
{"route": "SQL", "confidence": "high", "reasoning": "Pure count query over 311 data — no document context needed."}

Question: "What does the Mayor's Management Report say about DSNY response time targets?"
{"route": "RAG", "confidence": "high", "reasoning": "Answer lives entirely in MMR document — no structured data query needed."}

Question: "Did 311 complaints spike in Bushwick after the 2022 rezoning, and what were residents saying about it?"
{"route": "HYBRID", "confidence": "high", "reasoning": "Spike requires SQL over 311 data; resident response requires RAG over Community Board minutes."}

Respond with JSON only — no prose, no code fences, no commentary.
Schema: {"route": "SQL"|"RAG"|"HYBRID", "confidence": "high"|"medium"|"low", "reasoning": "one sentence"}`;

// ---------------------------------------------------------------------------
// routeQuery: single-stage LLM classification
// ---------------------------------------------------------------------------

export async function routeQuery(question: string): Promise<RouteDecision> {
  const startMs = Date.now();

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 128,
      system: ROUTER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: question }],
    });

    const responseText =
      response.content[0].type === "text" ? response.content[0].text : "";

    const cleanedText = responseText
      .replace(/^```json\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();

    const parsed = JSON.parse(cleanedText);

    const route = (parsed.route?.toUpperCase() || "") as Route;
    const confidence = (parsed.confidence?.toLowerCase() || "") as Confidence;
    const reasoning = parsed.reasoning || "";

    if (!["SQL", "RAG", "HYBRID"].includes(route)) {
      return {
        route: "HYBRID",
        confidence: "low",
        reasoning: "parse error — defaulting to HYBRID",
        latency_ms: Date.now() - startMs,
        overridden: false,
      };
    }

    if (!["high", "medium", "low"].includes(confidence)) {
      return {
        route: "HYBRID",
        confidence: "low",
        reasoning: "parse error — defaulting to HYBRID",
        latency_ms: Date.now() - startMs,
        overridden: false,
      };
    }

    return {
      route,
      confidence,
      reasoning,
      latency_ms: Date.now() - startMs,
      overridden: false,
    };
  } catch (err) {
    console.error("Router error:", err);
    return {
      route: "HYBRID",
      confidence: "low",
      reasoning: "parse error — defaulting to HYBRID",
      latency_ms: Date.now() - startMs,
      overridden: false,
    };
  }
}

// ---------------------------------------------------------------------------
// routeQueryWithFallback: two-stage router with confidence override
// ---------------------------------------------------------------------------

export async function routeQueryWithFallback(
  question: string
): Promise<RouteDecision> {
  const decision = await routeQuery(question);

  if (decision.confidence === "low") {
    return {
      ...decision,
      route: "HYBRID",
      reasoning: `${decision.reasoning} [overridden to HYBRID: low confidence]`,
      overridden: true,
    };
  }

  return decision;
}

// ---------------------------------------------------------------------------
// logRoutingDecision: fire-and-forget insert to routing_log
// ---------------------------------------------------------------------------

export async function logRoutingDecision(
  question: string,
  decision: RouteDecision,
  modelUsed: string = "claude-haiku-4-5"
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO nl2sql.routing_log
         (question, route, confidence, reasoning, model_used, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        question,
        decision.route,
        decision.confidence,
        decision.reasoning,
        modelUsed,
        decision.latency_ms,
      ]
    );
  } catch (err) {
    console.error("routing_log insert failed:", err);
  }
}
