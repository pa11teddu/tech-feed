import { describe, expect, it } from "vitest";
import {
  classifyResponseSchema,
  countSentences,
  countWords,
  generatedPostSchema,
  longestQuoteWords,
} from "@/lib/schema";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

const valid = {
  headline: "Cloud provider explains 47-minute control plane outage",
  tldr: "A DNS change broke the control plane. Workloads stayed up.",
  body_md: `## What happened\n\n${words(300)}`,
  takeaways: ["Stage DNS changes.", "Separate control and data planes."],
  links: [{ title: "Incident report", url: "https://status.example.net/incidents/1" }],
};

describe("generatedPostSchema", () => {
  it("accepts a valid post", () => {
    expect(generatedPostSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a headline over 90 characters", () => {
    expect(generatedPostSchema.safeParse({ ...valid, headline: "x".repeat(91) }).success).toBe(false);
  });

  it("rejects a tldr longer than two sentences", () => {
    const r = generatedPostSchema.safeParse({ ...valid, tldr: "One thing. Two things. Three things." });
    expect(r.success).toBe(false);
  });

  it("enforces the 250-600 word body range", () => {
    expect(generatedPostSchema.safeParse({ ...valid, body_md: words(249) }).success).toBe(false);
    expect(generatedPostSchema.safeParse({ ...valid, body_md: words(250) }).success).toBe(true);
    expect(generatedPostSchema.safeParse({ ...valid, body_md: words(600) }).success).toBe(true);
    expect(generatedPostSchema.safeParse({ ...valid, body_md: words(601) }).success).toBe(false);
  });

  it("requires 2-5 takeaways and at least one link", () => {
    expect(generatedPostSchema.safeParse({ ...valid, takeaways: ["only one"] }).success).toBe(false);
    expect(generatedPostSchema.safeParse({ ...valid, takeaways: Array(6).fill("same point") }).success).toBe(false);
    expect(generatedPostSchema.safeParse({ ...valid, links: [] }).success).toBe(false);
    expect(generatedPostSchema.safeParse({ ...valid, links: [{ title: "x", url: "not a url" }] }).success).toBe(false);
  });

  it("rejects quotes longer than 15 words", () => {
    const longQuote = `"${words(16)}"`;
    const r = generatedPostSchema.safeParse({ ...valid, body_md: `${valid.body_md}\n\nThey said ${longQuote}.` });
    expect(r.success).toBe(false);
    const okQuote = `"${words(15)}"`;
    expect(generatedPostSchema.safeParse({ ...valid, body_md: `${valid.body_md} ${okQuote}` }).success).toBe(true);
  });
});

describe("classifyResponseSchema", () => {
  it("accepts valid results", () => {
    const r = classifyResponseSchema.safeParse({
      results: [{ id: "a", stream: "outages", importance: 8, is_noise: false }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown streams and out-of-range importance", () => {
    expect(
      classifyResponseSchema.safeParse({ results: [{ id: "a", stream: "sports", importance: 5, is_noise: false }] }).success,
    ).toBe(false);
    expect(
      classifyResponseSchema.safeParse({ results: [{ id: "a", stream: "ai-ml", importance: 11, is_noise: false }] }).success,
    ).toBe(false);
    expect(
      classifyResponseSchema.safeParse({ results: [{ id: "a", stream: "ai-ml", importance: 7.5, is_noise: false }] }).success,
    ).toBe(false);
  });
});

describe("text helpers", () => {
  it("counts words ignoring markdown syntax", () => {
    expect(countWords("## Heading\n\n- one **two** three")).toBe(4);
  });
  it("counts sentences", () => {
    expect(countSentences("First. Second!")).toBe(2);
    expect(countSentences("Version 2.5 shipped today.")).toBe(1);
  });
  it("measures the longest quote", () => {
    expect(longestQuoteWords('a "one two three" b “four five”')).toBe(3);
  });
});
