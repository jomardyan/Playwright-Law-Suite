import { describe, expect, it } from "vitest";
import { applyExceptions } from "../src/engine/ExceptionFilter.js";
import { loadConfigFromObject } from "../src/config/loader.js";
import type { Finding } from "../src/engine/types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "gdpr-eprivacy-tracking-before-consent",
    packId: "eu-gdpr-eprivacy",
    regulation: "GDPR",
    jurisdiction: "European Union",
    requirement: "No non-essential tracking before consent.",
    status: "violation",
    severity: "critical",
    confidence: "high",
    automationLevel: "fully-automated",
    observedBehavior: "Analytics request before consent.",
    expectedBehavior: "No such request.",
    evidence: [],
    ...overrides,
  };
}

describe("applyExceptions", () => {
  it("moves a matching finding into suppressedFindings rather than deleting it", () => {
    const config = loadConfigFromObject({
      ignoredFindings: [
        {
          ruleId: "gdpr-eprivacy-tracking-before-consent",
          reason: "Legal has accepted this pending the CMP migration in Q3.",
          approvedBy: "dpo@example.com",
        },
      ],
    });

    const result = applyExceptions([finding()], config);

    expect(result.findings).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].reason).toContain("CMP migration");
    expect(result.suppressed[0].approvedBy).toBe("dpo@example.com");
    expect(result.suppressed[0].finding.ruleId).toBe("gdpr-eprivacy-tracking-before-consent");
  });

  it("rejects an exception with no reason, so a rule cannot be silently disabled", () => {
    const config = loadConfigFromObject({
      ignoredFindings: [{ ruleId: "gdpr-eprivacy-tracking-before-consent", reason: "   " }],
    });

    const result = applyExceptions([finding()], config);

    expect(result.findings).toHaveLength(1);
    expect(result.suppressed).toHaveLength(0);
  });

  it("stops applying an exception once it has expired", () => {
    const config = loadConfigFromObject({
      ignoredFindings: [
        {
          ruleId: "gdpr-eprivacy-tracking-before-consent",
          reason: "Temporary acceptance during migration.",
          expires: "2024-01-01",
        },
      ],
    });

    const result = applyExceptions([finding()], config, new Date("2026-09-02T00:00:00Z"));

    expect(result.findings).toHaveLength(1);
    expect(result.suppressed).toHaveLength(0);
  });

  it("still applies an exception whose expiry is in the future", () => {
    const config = loadConfigFromObject({
      ignoredFindings: [
        {
          ruleId: "gdpr-eprivacy-tracking-before-consent",
          reason: "Accepted until the vendor ships the fix.",
          expires: "2030-01-01",
        },
      ],
    });

    const result = applyExceptions([finding()], config, new Date("2026-09-02T00:00:00Z"));

    expect(result.suppressed).toHaveLength(1);
  });

  it("never suppresses a not-evaluated finding: an exception accepts a risk, it does not hide a coverage gap", () => {
    const config = loadConfigFromObject({
      ignoredFindings: [
        { ruleId: "gdpr-eprivacy-tracking-before-consent", reason: "Accepted by the risk owner." },
      ],
    });

    const result = applyExceptions([finding({ status: "not-evaluated" })], config);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].status).toBe("not-evaluated");
    expect(result.suppressed).toHaveLength(0);
  });

  it("leaves non-matching findings untouched", () => {
    const config = loadConfigFromObject({
      ignoredFindings: [{ ruleId: "some-other-rule", reason: "Accepted." }],
    });

    const result = applyExceptions([finding()], config);

    expect(result.findings).toHaveLength(1);
    expect(result.suppressed).toHaveLength(0);
  });

  it("is a no-op when the config declares no exceptions", () => {
    const config = loadConfigFromObject({});
    const input = [finding()];
    const result = applyExceptions(input, config);
    expect(result.findings).toBe(input);
    expect(result.suppressed).toEqual([]);
  });
});
