import type { UniVerscanConfig } from "../config/schema.js";
import type { RegulatoryPack } from "../engine/types.js";
import { logger } from "../utils/logger.js";

import { euGdprEprivacyPack } from "./eu-gdpr/pack.js";
import { wcagAccessibilityPack } from "./wcag-accessibility/pack.js";
import { usCcpaCpraPack } from "./us-ccpa/pack.js";
import { ukGdprPecrPack } from "./uk-gdpr-pecr/pack.js";
import { auPrivacyAccessibilityPack } from "./au-privacy-accessibility/pack.js";
import { brLgpdPack } from "./br-lgpd/pack.js";
import { caPipedaPack } from "./ca-pipeda/pack.js";
import { jpAppiPack } from "./jp-appi/pack.js";
import { euAccessibilityActPack } from "./eu-accessibility-act/pack.js";
import { euAiActPack } from "./eu-ai-act/pack.js";
import { euConsumerRightsPack } from "./eu-consumer-rights/pack.js";
import { usStatePrivacyPack } from "./us-state-privacy/pack.js";
import { inDpdpPack } from "./in-dpdp/pack.js";
import { globalDataSecurityPack } from "./global-data-security/pack.js";

/**
 * The engine never contains country-specific legal logic; it only knows how
 * to load and execute packs. Built-in packs are registered here; additional
 * packs can be dropped into src/packs/<pack-id>/pack.ts and registered the
 * same way, or loaded dynamically via config.customRulesPaths.
 */
const BUILT_IN_PACKS: RegulatoryPack[] = [
  euGdprEprivacyPack,
  wcagAccessibilityPack,
  usCcpaCpraPack,
  ukGdprPecrPack,
  auPrivacyAccessibilityPack,
  brLgpdPack,
  caPipedaPack,
  jpAppiPack,
  euAccessibilityActPack,
  euAiActPack,
  euConsumerRightsPack,
  usStatePrivacyPack,
  inDpdpPack,
  globalDataSecurityPack,
];

export class PackLoader {
  async load(config: UniVerscanConfig): Promise<RegulatoryPack[]> {
    const custom = await this.loadCustomPacks(config.customRulesPaths ?? []);
    const candidates = [...BUILT_IN_PACKS, ...custom];

    const explicit = config.regulatoryPacks ?? [];
    const filtered = candidates.filter((pack) => {
      if (explicit.length > 0 && !explicit.includes(pack.id)) return false;
      return pack.applicability(config);
    });

    logger.info(`Loaded ${filtered.length} applicable regulatory pack(s): ${filtered.map((p) => p.id).join(", ") || "none"}`);
    return filtered;
  }

  private async loadCustomPacks(paths: string[]): Promise<RegulatoryPack[]> {
    const packs: RegulatoryPack[] = [];
    for (const path of paths) {
      try {
        const mod = (await import(path)) as { default?: RegulatoryPack; pack?: RegulatoryPack };
        const pack = mod.default ?? mod.pack;
        if (pack) packs.push(pack);
        else logger.warn(`Custom rules path ${path} did not export a 'default' or 'pack' RegulatoryPack`);
      } catch (error) {
        logger.error(`Failed to load custom regulatory pack from ${path}`, error);
      }
    }
    return packs;
  }

  listBuiltIn(): RegulatoryPack[] {
    return BUILT_IN_PACKS;
  }
}
