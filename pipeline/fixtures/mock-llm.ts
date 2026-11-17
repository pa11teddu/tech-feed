import type { CompletionRequest, LlmProvider, RawCompletion } from "@/lib/llm";

/**
 * Deterministic fake LLM for fixture tests. Reads ids/urls out of the prompt
 * (the same <source> blocks a real model sees) and returns canned JSON.
 * - The first classify call returns malformed text (exercises the retry).
 * - Titles containing "Webinar" are noise.
 * - Titles containing "Malformed output trigger" always get invalid JSON on write.
 * - Every post also includes a foreign link, which validation must drop.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = "mock" as const;
  calls: CompletionRequest[] = [];
  private classifyCalls = 0;

  async complete(req: CompletionRequest): Promise<RawCompletion> {
    this.calls.push(req);
    const text = req.user.includes("Write one post") ? this.write(req.user) : this.classify(req.user);
    return { text, tokensIn: Math.ceil(req.user.length / 4), tokensOut: Math.ceil(text.length / 4) };
  }

  private classify(prompt: string): string {
    this.classifyCalls++;
    if (this.classifyCalls === 1) return "Sure! Here are the classifications you asked for.";
    const re = /<source id="([^"]+)" stream_hint="([^"]+)">\nTitle: ([^\n]*)/g;
    const results = [...prompt.matchAll(re)].map(([, id, hint, title]) => ({
      id,
      stream: hint === "unknown" ? "ai-ml" : hint,
      importance: title?.includes("Sparse") ? 9 : 7,
      is_noise: Boolean(title?.includes("Webinar")),
    }));
    return "```json\n" + JSON.stringify({ results }) + "\n```";
  }

  private write(prompt: string): string {
    if (prompt.includes("Malformed output trigger")) return "{ this is not valid json";
    const urls = [...prompt.matchAll(/<source url="([^"]+)">\nTitle: ([^\n]*)/g)];
    const title = urls[0]?.[2] ?? "Story";
    const para =
      "The source describes a concrete engineering change and reports measured results. " +
      "It explains the motivation, the design trade-offs, and the limits the authors acknowledge. ";
    const body = ["## What happened", para.repeat(5), "## Why it matters", para.repeat(5), "## Caveats", para.repeat(4)].join(
      "\n\n",
    );
    return JSON.stringify({
      headline: `Explained: ${title}`.slice(0, 90),
      tldr: `A summary of ${title.toLowerCase()}. Details and caveats are below.`,
      body_md: body,
      takeaways: ["The change is measurable.", "Caveats remain; test before adopting."],
      links: [
        ...urls.map(([, url, t]) => ({ title: t, url })),
        { title: "Invented reference", url: "https://evil.example.com/not-a-source" },
      ],
    });
  }
}
