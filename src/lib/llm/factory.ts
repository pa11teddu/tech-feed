import type { PipelineEnv } from "../env";
import { LlmClient, type LlmProvider } from "../llm";
import { AnthropicProvider } from "./anthropic";
import { CopilotProvider } from "./copilot";
import { OpenAiCompatProvider } from "./openai-compat";

export function createProvider(env: PipelineEnv): LlmProvider {
  switch (env.LLM_PROVIDER) {
    case "copilot":
      return new CopilotProvider({ bin: env.COPILOT_BIN, timeoutMs: env.COPILOT_TIMEOUT_MS });
    case "openai":
      return new OpenAiCompatProvider({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY ?? "" });
    case "anthropic":
      return new AnthropicProvider(env.ANTHROPIC_API_KEY ?? "");
  }
}

export function createLlmClient(env: PipelineEnv, provider: LlmProvider = createProvider(env)): LlmClient {
  return new LlmClient({
    provider,
    models: { classify: env.MODEL_CLASSIFY, write: env.MODEL_WRITE },
    maxCalls: env.MAX_LLM_CALLS_PER_RUN,
    maxRunUsd: env.LLM_PROVIDER === "anthropic" ? env.MAX_RUN_USD : undefined,
  });
}
