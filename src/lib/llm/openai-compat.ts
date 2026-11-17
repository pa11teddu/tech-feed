import type { CompletionRequest, LlmProvider, RawCompletion } from "../llm";
import { HttpStatusError, looksLikeQuotaExhausted, parseRetryAfter } from "./errors";

export interface OpenAiCompatOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Any OpenAI-compatible chat endpoint via plain fetch (Gemini's OpenAI
 * endpoint by default; Groq, OpenRouter, etc. by changing LLM_BASE_URL).
 * This replaces the retired GitHub Models endpoint.
 */
export class OpenAiCompatProvider implements LlmProvider {
  readonly name = "openai" as const;
  constructor(private readonly opts: OpenAiCompatOptions) {}

  async complete(req: CompletionRequest): Promise<RawCompletion> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        max_tokens: req.maxTokens,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      throw new HttpStatusError(res.status, `LLM HTTP ${res.status}: ${body}`, {
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
        quotaExhausted: res.status === 429 && looksLikeQuotaExhausted(body),
      });
    }
    const json = (await res.json()) as ChatResponse;
    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
    };
  }
}
