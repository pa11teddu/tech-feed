import { HttpStatusError, parseRetryAfter, withRetry } from "./llm/errors";

/** Every embedding provider must return exactly this many dimensions (column is vector(1024)). */
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBED_BATCH_SIZE = 50;

export interface Embedder {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbedConfig {
  provider: "openai" | "voyage";
  model: string;
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface EmbeddingResponse {
  data?: { embedding: number[]; index?: number }[];
}

function assertDims(vectors: number[][]): number[][] {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`embedding has ${v.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
    }
  }
  return vectors;
}

/** OpenAI-compatible (Gemini/OpenAI) or Voyage embeddings, batched by 50. Used from Phase 2. */
export function createEmbedder(config: EmbedConfig): Embedder {
  const doFetch = config.fetchImpl ?? fetch;
  const isVoyage = config.provider === "voyage";
  const url = isVoyage
    ? "https://api.voyageai.com/v1/embeddings"
    : `${(config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, "")}/embeddings`;

  async function embedBatch(batch: string[]): Promise<number[][]> {
    return withRetry(async () => {
      const body = isVoyage
        ? { model: config.model, input: batch, output_dimension: EMBEDDING_DIMENSIONS }
        : { model: config.model, input: batch, dimensions: EMBEDDING_DIMENSIONS };
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        throw new HttpStatusError(res.status, `embeddings HTTP ${res.status}`, {
          retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
        });
      }
      const json = (await res.json()) as EmbeddingResponse;
      const rows = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return assertDims(rows.map((r) => r.embedding));
    });
  }

  return {
    name: config.provider,
    async embed(texts: string[]): Promise<number[][]> {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        out.push(...(await embedBatch(texts.slice(i, i + EMBED_BATCH_SIZE))));
      }
      return out;
    },
  };
}
