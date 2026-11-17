import { describe, expect, it } from "vitest";
import { validateLinks } from "@/lib/links";

const inputs = ["https://status.example.net/incidents/1", "https://blog.example.com/post?id=7"];

describe("validateLinks", () => {
  it("keeps links whose URL is one of the story's inputs", () => {
    const { kept, dropped } = validateLinks([{ title: "Report", url: inputs[0]! }], inputs);
    expect(kept).toEqual([{ title: "Report", url: inputs[0] }]);
    expect(dropped).toEqual([]);
  });

  it("drops foreign links (hallucination guard)", () => {
    const { kept, dropped } = validateLinks(
      [
        { title: "Real", url: inputs[1]! },
        { title: "Invented", url: "https://evil.example.com/x" },
      ],
      inputs,
    );
    expect(kept.map((l) => l.url)).toEqual([inputs[1]]);
    expect(dropped.map((l) => l.url)).toEqual(["https://evil.example.com/x"]);
  });

  it("matches canonically (tracking params, fragment, trailing slash, host case)", () => {
    const { kept } = validateLinks(
      [{ title: "Same", url: "https://STATUS.example.net/incidents/1/?utm_source=x#top" }],
      inputs,
    );
    expect(kept).toEqual([{ title: "Same", url: inputs[0] }]);
  });

  it("rejects near-miss URLs", () => {
    const { kept } = validateLinks([{ title: "Other id", url: "https://blog.example.com/post?id=8" }], inputs);
    expect(kept).toEqual([]);
  });

  it("dedupes repeated links", () => {
    const { kept } = validateLinks(
      [
        { title: "A", url: inputs[0]! },
        { title: "B", url: `${inputs[0]}#again` },
      ],
      inputs,
    );
    expect(kept).toHaveLength(1);
  });

  it("returns nothing when every link is foreign, so the post is rejected", () => {
    expect(validateLinks([{ title: "x", url: "https://nope.example/" }], inputs).kept).toEqual([]);
  });
});
