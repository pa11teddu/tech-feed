import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompletionRequest, LlmProvider, RawCompletion } from "../llm";
import { estimateTokens } from "../pricing";
import { HttpStatusError, looksLikeQuotaExhausted } from "./errors";

export interface CopilotOptions {
  bin: string;
  timeoutMs: number;
}

/** Env vars never passed to the Copilot child process. */
const SECRET_ENV = ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "LLM_API_KEY", "EMBEDDING_API_KEY", "VOYAGE_API_KEY"];

interface CopilotEvent {
  type?: string;
  data?: {
    content?: string;
    outputTokens?: number;
    totalPremiumRequests?: number;
    message?: string;
  };
  usage?: { premiumRequests?: number };
  exitCode?: number;
}

export interface ParsedCopilotOutput {
  text: string;
  tokensOut: number;
  premiumRequests: number;
  error?: string;
}

/** Parses `copilot --output-format json` JSONL output. */
export function parseCopilotJsonl(stdout: string): ParsedCopilotOutput {
  let text = "";
  let tokensOut = 0;
  let premium = 0;
  let error: string | undefined;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: CopilotEvent;
    try {
      event = JSON.parse(trimmed) as CopilotEvent;
    } catch {
      continue;
    }
    switch (event.type) {
      case "assistant.message":
        if (event.data?.content) text = event.data.content;
        tokensOut += event.data?.outputTokens ?? 0;
        break;
      case "session.usage_checkpoint":
        premium = Math.max(premium, event.data?.totalPremiumRequests ?? 0);
        break;
      case "result":
        premium = Math.max(premium, event.usage?.premiumRequests ?? 0);
        break;
      case "session.error":
        error = event.data?.message ?? "copilot session error";
        break;
    }
  }
  return { text, tokensOut, premiumRequests: premium, error };
}

/**
 * Calls the GitHub Copilot CLI in non-interactive mode with every tool
 * disabled, so the model can only answer. Auth comes from the CLI's own login
 * locally, or COPILOT_GITHUB_TOKEN (fine-grained PAT with "Copilot Requests") in CI.
 */
export class CopilotProvider implements LlmProvider {
  readonly name = "copilot" as const;
  private readonly workdir: string;

  constructor(private readonly opts: CopilotOptions) {
    this.workdir = join(tmpdir(), "tech-feed-copilot");
    mkdirSync(this.workdir, { recursive: true });
  }

  complete(req: CompletionRequest): Promise<RawCompletion> {
    const prompt =
      `<instructions>\n${req.system}\n</instructions>\n\n${req.user}\n\n` +
      `Respond with a single JSON object only. No prose, no code fences, no tool use.`;
    const args = [
      "-p", prompt,
      "--model", req.model,
      "--output-format", "json",
      "--stream", "off",
      "--available-tools=",
      "--disable-builtin-mcps",
      "--no-custom-instructions",
      "--no-ask-user",
      "--no-auto-update",
      "--no-color",
      "-C", this.workdir,
    ];
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of SECRET_ENV) delete env[key];

    return new Promise((resolve, reject) => {
      execFile(
        this.opts.bin,
        args,
        { env, timeout: this.opts.timeoutMs, maxBuffer: 32 * 1024 * 1024, cwd: this.workdir },
        (err, stdout, stderr) => {
          const parsed = parseCopilotJsonl(stdout);
          const failure = err || parsed.error || !parsed.text;
          if (failure) {
            const detail = `${parsed.error ?? ""} ${stderr} ${err?.message ?? ""}`.trim().slice(0, 500);
            const rateLimited = /rate.?limit|429|too many requests|quota/i.test(detail);
            reject(
              new HttpStatusError(rateLimited ? 429 : 503, `copilot CLI failed: ${detail || "empty reply"}`, {
                quotaExhausted: rateLimited && looksLikeQuotaExhausted(detail),
              }),
            );
            return;
          }
          resolve({
            text: parsed.text,
            tokensIn: estimateTokens(prompt.length),
            tokensOut: parsed.tokensOut,
            premiumRequests: parsed.premiumRequests,
          });
        },
      );
    });
  }
}
