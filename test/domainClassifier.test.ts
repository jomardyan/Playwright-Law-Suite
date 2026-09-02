import { describe, expect, it } from "vitest";
import { classifyDomain, extractDomain } from "../src/utils/domainClassifier.js";

describe("classifyDomain", () => {
  it("classifies known analytics domains", () => {
    expect(classifyDomain("www.google-analytics.com").category).toBe("analytics");
    expect(classifyDomain("region1.google-analytics.com").category).toBe("analytics");
  });

  it("classifies known advertising domains", () => {
    expect(classifyDomain("stats.g.doubleclick.net").category).toBe("advertising");
    expect(classifyDomain("connect.facebook.net").category).toBe("advertising");
  });

  it("classifies known payment domains", () => {
    expect(classifyDomain("js.stripe.com").category).toBe("payment");
  });

  it("falls back to unknown-third-party for unrecognized domains", () => {
    expect(classifyDomain("totally-unknown-vendor.example").category).toBe("unknown-third-party");
  });
});

describe("extractDomain", () => {
  it("extracts hostname from a full URL", () => {
    expect(extractDomain("https://www.example.com/path?x=1")).toBe("www.example.com");
  });

  it("returns the input unchanged when it is not a valid URL", () => {
    expect(extractDomain("not-a-url")).toBe("not-a-url");
  });
});
