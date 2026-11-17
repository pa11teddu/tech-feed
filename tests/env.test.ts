import { describe, expect, it } from "vitest";
import { EnvError, loadPipelineEnv } from "@/lib/env";

describe("pipeline env", () => {
  it("applies defaults, including for empty strings from unset Actions variables", () => {
    const env = loadPipelineEnv({ db: false, llm: true }, { MAX_PER_STREAM_PER_RUN: "", LLM_BASE_URL: "" });
    expect(env).toMatchObject({
      LLM_PROVIDER: "copilot",
      MAX_PER_STREAM_PER_RUN: 3,
      MIN_IMPORTANCE: 5,
      MAX_LLM_CALLS_PER_RUN: 40,
      MAX_RUN_USD: 0.5,
      MAX_INPUT_CHARS: 18000,
      CLUSTER_THRESHOLD: 0.82,
      APP_TIMEZONE: "America/Los_Angeles",
    });
    expect(env.MODEL_CLASSIFY).toBeTruthy();
    expect(env.MODEL_WRITE).toBeTruthy();
  });

  it("fails fast with a clear message when required vars are missing", () => {
    expect(() => loadPipelineEnv({ db: true, llm: false }, {})).toThrow(/SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => loadPipelineEnv({ db: false, llm: true }, { LLM_PROVIDER: "anthropic" })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() => loadPipelineEnv({ db: false, llm: false }, { LLM_PROVIDER: "gpt" })).toThrow(EnvError);
  });

  it("lets env override model IDs", () => {
    const env = loadPipelineEnv({ db: false, llm: false }, { MODEL_CLASSIFY: "a", MODEL_WRITE: "b" });
    expect([env.MODEL_CLASSIFY, env.MODEL_WRITE]).toEqual(["a", "b"]);
  });
});
