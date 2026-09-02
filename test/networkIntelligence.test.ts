import { describe, expect, it } from "vitest";
import { NetworkIntelligence } from "../src/modules/network/NetworkIntelligence.js";
import type { CapturedState } from "../src/engine/types.js";

function makeState(consentState: CapturedState["consentState"], domains: string[]): CapturedState {
  return {
    consentState,
    url: "https://example.com/",
    cookies: [],
    localStorageKeys: [],
    sessionStorageKeys: [],
    thirdPartyRequests: domains.map((domain) => ({
      url: `https://${domain}/x.js`,
      domain,
      resourceType: "script",
      timestamp: new Date().toISOString(),
    })),
  };
}

describe("NetworkIntelligence.build", () => {
  it("classifies observed third-party domains and excludes the first-party origin", () => {
    const intel = new NetworkIntelligence();
    const state = makeState("before-consent", ["example.com", "www.google-analytics.com", "connect.facebook.net"]);
    const records = intel.build("https://example.com/", [state]);

    expect(records.find((r) => r.domain === "example.com")).toBeUndefined();
    const analytics = records.find((r) => r.domain === "www.google-analytics.com");
    expect(analytics?.category).toBe("analytics");
    expect(analytics?.consentState).toBe("before-consent");
    const advertising = records.find((r) => r.domain === "connect.facebook.net");
    expect(advertising?.category).toBe("advertising");
  });

  it("keeps separate records for the same domain across different consent states", () => {
    const intel = new NetworkIntelligence();
    const before = makeState("before-consent", ["www.google-analytics.com"]);
    const rejected = makeState("reject-all", ["www.google-analytics.com"]);
    const records = intel.build("https://example.com/", [before, rejected]);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.consentState).sort()).toEqual(["before-consent", "reject-all"]);
  });
});

describe("NetworkIntelligence.merge", () => {
  it("deduplicates by domain + consent state across multiple pages", () => {
    const intel = new NetworkIntelligence();
    const pageA = intel.build("https://example.com/a", [makeState("before-consent", ["tracker.example"])]);
    const pageB = intel.build("https://example.com/b", [makeState("before-consent", ["tracker.example"])]);
    const merged = intel.merge([pageA, pageB]);
    expect(merged).toHaveLength(1);
  });
});
