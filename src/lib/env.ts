import { z } from "zod";

const intWithDefault = (def: number, min = 0) =>
  z.coerce.number().int().min(min).default(def);
const numWithDefault = (def: number) => z.coerce.number().min(0).default(def);
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

export const LLM_PROVIDERS = ["copilot", "openai", "anthropic"] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

/** Default model IDs per provider. They are config, overridable via env. */
const DEFAULT_MODELS: Record<LlmProviderName, { classify: string; write: string }> = {
  copilot: { classify: "claude-haiku-4.5", write: "claude-haiku-4.5" },
  openai: { classify: "gemini-3.5-flash-lite", write: "gemini-3.5-flash" },
  anthropic: { classify: "claude-haiku-5-5", write: "claude-sonnet-5-5" },
};

const pipelineSchema = z
  .object({
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("copilot"),
    MODEL_CLASSIFY: optionalString,
    MODEL_WRITE: optionalString,
    COPILOT_BIN: z.string().default("copilot"),
    COPILOT_TIMEOUT_MS: intWithDefault(180_000, 10_000),
    LLM_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com/v1beta/openai"),
    LLM_API_KEY: optionalString,
    ANTHROPIC_API_KEY: optionalString,
    EMBEDDING_PROVIDER: z.enum(["openai", "voyage"]).default("openai"),
    EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
    EMBEDDING_BASE_URL: optionalString,
    EMBEDDING_API_KEY: optionalString,
    VOYAGE_API_KEY: optionalString,
    SUPABASE_URL: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    OWNER_EMAIL: optionalString,
    MAX_PER_STREAM_PER_RUN: intWithDefault(3, 1),
    MIN_IMPORTANCE: intWithDefault(5, 1),
    MAX_LLM_CALLS_PER_RUN: intWithDefault(40, 1),
    MAX_RUN_USD: numWithDefault(0.5),
    MAX_INPUT_CHARS: intWithDefault(18_000, 2_000),
    CLUSTER_THRESHOLD: numWithDefault(0.82),
    DEVTOOLS_REPOS: optionalString,
    APP_TIMEZONE: z.string().default("America/Los_Angeles"),
  })
  .transform((env) => ({
    ...env,
    MODEL_CLASSIFY: env.MODEL_CLASSIFY ?? DEFAULT_MODELS[env.LLM_PROVIDER].classify,
    MODEL_WRITE: env.MODEL_WRITE ?? DEFAULT_MODELS[env.LLM_PROVIDER].write,
  }));

export type PipelineEnv = z.infer<typeof pipelineSchema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
}

export interface PipelineEnvNeeds {
  db: boolean;
  llm: boolean;
}

export function loadPipelineEnv(
  needs: PipelineEnvNeeds,
  source: Record<string, string | undefined> = process.env,
): PipelineEnv {
  // Unset GitHub Actions variables arrive as "", which must mean "use the default".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = pipelineSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new EnvError(`Invalid environment:\n${formatIssues(parsed.error)}\nSee .env.example.`);
  }
  const env = parsed.data;
  const missing: string[] = [];
  if (needs.db) {
    if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (needs.llm) {
    if (env.LLM_PROVIDER === "openai" && !env.LLM_API_KEY) missing.push("LLM_API_KEY");
    if (env.LLM_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  }
  if (missing.length > 0) {
    throw new EnvError(
      `Missing required environment variables: ${missing.join(", ")}.\n` +
        `Set them in .env.local (local) or as GitHub Actions secrets. See docs/SETUP.md.`,
    );
  }
  return env;
}

const webSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type WebEnv = z.infer<typeof webSchema>;

/**
 * Next.js only inlines NEXT_PUBLIC_* vars when referenced literally, so they
 * are read explicitly here rather than passing `process.env` through.
 */
export function loadWebEnv(): WebEnv {
  const parsed = webSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) {
    throw new EnvError(
      `Supabase web env is missing or invalid:\n${formatIssues(parsed.error)}\n` +
        `Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see docs/SETUP.md).`,
    );
  }
  return parsed.data;
}

/**
 * Dev-only mock data mode for UI previews and screenshots. It can never be
 * enabled in a production build.
 */
export function isMockMode(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.MOCK_DATA === "1";
}

/** Server-only: used to prefill the login email field. */
export function ownerEmailHint(): string {
  return process.env.OWNER_EMAIL ?? "";
}
