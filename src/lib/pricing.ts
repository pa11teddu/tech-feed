/**
 * Cost estimates. Anthropic prices are USD per million tokens; update them if
 * Anthropic changes its price list. Copilot is billed per premium request.
 */
export interface TokenPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const ANTHROPIC_PRICES: Record<string, TokenPrice> = {
  "claude-haiku-5-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-sonnet-5-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-opus-5-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
};

/** Fallback for unknown Anthropic models: assume Sonnet-class pricing (conservative). */
const UNKNOWN_ANTHROPIC: TokenPrice = { inputPerMTok: 3, outputPerMTok: 15 };

/** Published price of an additional Copilot premium request. */
export const COPILOT_USD_PER_PREMIUM_REQUEST = 0.04;

export function anthropicCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price = ANTHROPIC_PRICES[model] ?? UNKNOWN_ANTHROPIC;
  return (tokensIn * price.inputPerMTok + tokensOut * price.outputPerMTok) / 1_000_000;
}

export function copilotCostUsd(premiumRequests: number): number {
  return premiumRequests * COPILOT_USD_PER_PREMIUM_REQUEST;
}

/** Rough token estimate when a provider does not report input tokens. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
