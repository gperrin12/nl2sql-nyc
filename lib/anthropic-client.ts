import Anthropic from "@anthropic-ai/sdk";

/** Read API key at call time so script loadEnvFile() runs before first request. */
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local or export it in your shell."
    );
  }
  return new Anthropic({ apiKey });
}
