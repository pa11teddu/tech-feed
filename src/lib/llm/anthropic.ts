import Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, LlmProvider, RawCompletion } from "../llm";
import { HttpStatusError, looksLikeQuotaExhausted, parseRetryAfter } from "./errors";

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    // Retries are handled by withRetry so 429 handling is uniform across providers.
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: 120_000 });
  }

  async complete(req: CompletionRequest): Promise<RawCompletion> {
    try {
      const msg = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      });
      const text = msg.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
      return { text, tokensIn: msg.usage.input_tokens, tokensOut: msg.usage.output_tokens };
    } catch (err) {
      if (err instanceof Anthropic.APIError && typeof err.status === "number") {
        const retryAfter = err.headers instanceof Headers ? err.headers.get("retry-after") : null;
        throw new HttpStatusError(err.status, `Anthropic ${err.status}: ${err.message}`, {
          retryAfterMs: parseRetryAfter(retryAfter),
          quotaExhausted: err.status === 429 && looksLikeQuotaExhausted(err.message),
        });
      }
      throw err;
    }
  }
}
