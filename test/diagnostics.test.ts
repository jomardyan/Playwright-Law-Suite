import { describe, expect, it } from "vitest";
import { editDistance, explainError, suggest, validateScope } from "../src/cli/diagnostics.js";
import { loadConfigFromObject } from "../src/config/loader.js";
import { PackLoader } from "../src/packs/PackLoader.js";

const ALL_PACKS = new PackLoader().listBuiltIn();

async function problemsFor(partial: Parameters<typeof loadConfigFromObject>[0]) {
  const config = loadConfigFromObject({ target: { url: "https://example.com" }, ...partial });
  const applicable = await new PackLoader().load(config);
  return validateScope(config, ALL_PACKS, applicable);
}

describe("editDistance", () => {
  it("is zero for identical strings", () => {
    expect(editDistance("scan", "scan")).toBe(0);
  });

  it("counts single-character edits", () => {
    expect(editDistance("scna", "scan")).toBe(2); // transposition = two edits
    expect(editDistance("scan", "scans")).toBe(1);
  });

  it("bails out early past the limit rather than computing a large distance", () => {
    expect(editDistance("a", "a-very-different-string", 3)).toBeGreaterThan(3);
  });
});

describe("suggest", () => {
  it("ranks a prefix of the candidate first", () => {
    expect(suggest("eu-gdpr", ALL_PACKS.map((p) => p.id))[0]).toBe("eu-gdpr-eprivacy");
  });

  it("finds a close misspelling", () => {
    expect(suggest("wcag-accesibility", ALL_PACKS.map((p) => p.id))).toContain("wcag-accessibility");
  });

  it("returns nothing for input unlike any candidate", () => {
    expect(suggest("zzzzzzzzzzzz", ["alpha", "beta"])).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    expect(suggest("   ", ["alpha"])).toEqual([]);
  });

  it("caps the number of suggestions", () => {
    expect(suggest("eu", ALL_PACKS.map((p) => p.id), 2)).toHaveLength(2);
  });
});

describe("validateScope", () => {
  it("passes a well-formed scope with no complaints", async () => {
    expect(await problemsFor({ jurisdictions: ["European Union"] })).toEqual([]);
  });

  it("errors on a pack id that does not exist, and suggests the real one", async () => {
    const problems = await problemsFor({ jurisdictions: ["European Union"], regulatoryPacks: ["eu-gdpr"] });
    const notFound = problems.find((p) => p.message.includes("No regulatory pack is called"));
    expect(notFound?.severity).toBe("error");
    expect(notFound?.hint).toContain("eu-gdpr-eprivacy");
  });

  it("errors when the configuration would load no packs at all", async () => {
    const problems = await problemsFor({ jurisdictions: ["European Union"], regulatoryPacks: ["nope"] });
    expect(problems.some((p) => p.severity === "error" && p.message.includes("loads no regulatory packs"))).toBe(true);
  });

  it("warns about a jurisdiction no pack recognises", async () => {
    const problems = await problemsFor({ jurisdictions: ["Germany"] });
    const warning = problems.find((p) => p.message.includes("'Germany'"));
    expect(warning?.severity).toBe("warning");
  });

  it("points a country name at the regional pack that covers it", async () => {
    const problems = await problemsFor({ jurisdictions: ["Germany"] });
    expect(problems.find((p) => p.message.includes("'Germany'"))?.hint).toContain("European Union");

    const uk = await problemsFor({ jurisdictions: ["Britain"] });
    expect(uk.find((p) => p.message.includes("'Britain'"))?.hint).toContain("United Kingdom");
  });

  it("does not warn about spellings the packs really do accept", async () => {
    // Jurisdiction-agnostic packs match anything, so an earlier version of
    // this check saw every misspelling as recognised. These two must stay
    // quiet because a jurisdiction-specific pack genuinely matches them.
    for (const jurisdiction of ["California", "United States", "Japan", "India"]) {
      const problems = await problemsFor({ jurisdictions: [jurisdiction] });
      expect(problems.filter((p) => p.message.includes(`'${jurisdiction}'`))).toEqual([]);
    }
  });

  it("warns even when the accessibility and security packs would still run", async () => {
    // Those two load for any scan, so "some packs loaded" must not be taken
    // as evidence that the jurisdiction was understood.
    const problems = await problemsFor({ jurisdictions: ["Freedonia"] });
    expect(problems.some((p) => p.message.includes("'Freedonia'"))).toBe(true);
  });
});

describe("explainError", () => {
  it("explains malformed JSON with a concrete thing to check", () => {
    const explained = explainError(new SyntaxError("Unexpected token '}' is not valid JSON"));
    expect(explained?.message).toContain("not valid JSON");
    expect(explained?.hint).toContain("trailing comma");
  });

  it("explains a missing file and names it", () => {
    const explained = explainError(new Error("ENOENT: no such file or directory, open '/tmp/nope.json'"));
    expect(explained?.message).toContain("/tmp/nope.json");
  });

  it("explains a missing browser with the install command", () => {
    const explained = explainError(new Error("browserType.launch: Executable doesn't exist at /x/chrome"));
    expect(explained?.hint).toContain("playwright install");
  });

  it("explains DNS, connection and TLS failures separately", () => {
    expect(explainError(new Error("net::ERR_NAME_NOT_RESOLVED"))?.message).toContain("could not be resolved");
    expect(explainError(new Error("net::ERR_CONNECTION_REFUSED"))?.message).toContain("refused");
    expect(explainError(new Error("net::ERR_CERT_AUTHORITY_INVALID"))?.hint).toContain("does not disable TLS");
  });

  it("explains a timeout", () => {
    expect(explainError(new Error("Timeout 30000ms exceeded"))?.message).toContain("did not respond in time");
  });

  it("returns null for an unrecognised error, so the original is not hidden", () => {
    expect(explainError(new Error("something entirely unexpected"))).toBeNull();
  });
});
