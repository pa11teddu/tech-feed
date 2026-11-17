import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "@/lib/url";

describe("canonicalizeUrl", () => {
  it("strips utm_* and click-id params", () => {
    expect(canonicalizeUrl("https://a.com/x?utm_source=rss&utm_medium=feed&id=3&fbclid=abc&gclid=z")).toBe(
      "https://a.com/x?id=3",
    );
  });

  it("drops fragments", () => {
    expect(canonicalizeUrl("https://a.com/x#section-2")).toBe("https://a.com/x");
  });

  it("lowercases the host but not the path", () => {
    expect(canonicalizeUrl("https://Blog.EXAMPLE.com/Some/Path")).toBe("https://blog.example.com/Some/Path");
  });

  it("removes default ports and trailing slashes (except root)", () => {
    expect(canonicalizeUrl("https://a.com:443/post/")).toBe("https://a.com/post");
    expect(canonicalizeUrl("http://a.com:80/")).toBe("http://a.com/");
  });

  it("sorts query params so equivalent URLs match", () => {
    expect(canonicalizeUrl("https://a.com/?b=2&a=1")).toBe(canonicalizeUrl("https://a.com/?a=1&b=2"));
  });

  it("resolves relative URLs against a base", () => {
    expect(canonicalizeUrl("/img/og.png", "https://a.com/posts/1")).toBe("https://a.com/img/og.png");
  });

  it("rejects non-http(s) and garbage", () => {
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("mailto:x@y.z")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });

  it("strips credentials", () => {
    expect(canonicalizeUrl("https://user:pass@a.com/x")).toBe("https://a.com/x");
  });
});
