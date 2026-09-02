import { describe, expect, it } from "vitest";
import { PackLoader } from "../src/packs/PackLoader.js";
import { loadConfigFromObject } from "../src/config/loader.js";

describe("PackLoader", () => {
  it("only loads packs applicable to the configured jurisdictions, plus jurisdiction-agnostic packs", async () => {
    const loader = new PackLoader();
    const config = loadConfigFromObject({ target: { url: "https://example.com" }, jurisdictions: ["European Union"] });
    const packs = await loader.load(config);
    const ids = packs.map((p) => p.id).sort();

    expect(ids).toContain("eu-gdpr-eprivacy");
    expect(ids).toContain("wcag-accessibility"); // applicability() => true, always loaded
    expect(ids).not.toContain("us-ca-ccpa-cpra");
    expect(ids).not.toContain("jp-appi");
  });

  it("restricts to an explicit regulatoryPacks allowlist even if other packs would otherwise apply", async () => {
    const loader = new PackLoader();
    const config = loadConfigFromObject({
      target: { url: "https://example.com" },
      jurisdictions: ["European Union"],
      regulatoryPacks: ["eu-gdpr-eprivacy"],
    });
    const packs = await loader.load(config);
    expect(packs.map((p) => p.id)).toEqual(["eu-gdpr-eprivacy"]);
  });

  it("loads multiple jurisdiction packs when multiple jurisdictions are configured", async () => {
    const loader = new PackLoader();
    const config = loadConfigFromObject({
      target: { url: "https://example.com" },
      jurisdictions: ["European Union", "Brazil"],
    });
    const packs = await loader.load(config);
    const ids = packs.map((p) => p.id);
    expect(ids).toContain("eu-gdpr-eprivacy");
    expect(ids).toContain("br-lgpd");
  });
});
