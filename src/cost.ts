import type { TokenUsage } from "./score-recall";

/** Claude Opus 5 list price, USD per million tokens. */
export const OPUS_5_INPUT_USD_PER_MTOK = 5;
export const OPUS_5_OUTPUT_USD_PER_MTOK = 25;

export interface SessionCostEstimate {
  usd: number;
  input_tokens: number;
  output_tokens: number;
  assumptions: string;
}

/**
 * Estimates what one check-in costs to operate (OR-10).
 *
 * Speech synthesis and transcription run on the laptop at $0, so the only metered
 * step is scoring. One check-in is one or two scoring calls; at list price that is
 * about a cent, which is what makes a check-in for forty employees a rounding error
 * next to the price of the banger it measures.
 */
export function estimateSessionCost(usages: TokenUsage[]): SessionCostEstimate {
  const input = usages.reduce((sum, u) => sum + u.input_tokens, 0);
  const output = usages.reduce((sum, u) => sum + u.output_tokens, 0);
  const usd = (input * OPUS_5_INPUT_USD_PER_MTOK + output * OPUS_5_OUTPUT_USD_PER_MTOK) / 1_000_000;
  return {
    usd: Number(usd.toFixed(4)),
    input_tokens: input,
    output_tokens: output,
    assumptions: "local speech + local Whisper at $0; scoring at Claude Opus 5 list price ($5 in / $25 out per MTok)",
  };
}
