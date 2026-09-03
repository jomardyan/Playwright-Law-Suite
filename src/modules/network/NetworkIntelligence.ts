import { classifyDomain, isSameSite, normalizeHost } from "../../utils/domainClassifier.js";
import type { CapturedState, ThirdPartyServiceRecord } from "../../engine/types.js";

/**
 * Builds the third-party service inventory: one record per domain, keyed to
 * the first page/consent-state it was observed under, classified via the
 * static domain map. This is the "privacy technology inventory" the spec
 * calls for - a practical map of what talks to the outside world and when.
 *
 * "Third party" is decided on the registrable domain, not the literal
 * hostname: `cdn.example.com` serving `www.example.com` is the same operator,
 * and listing it as an external recipient of personal data both overstates
 * the transfer surface and buries the recipients that are genuinely external.
 */
export class NetworkIntelligence {
  build(pageUrl: string, states: CapturedState[]): ThirdPartyServiceRecord[] {
    const pageHost = (() => {
      try {
        return normalizeHost(new URL(pageUrl).hostname);
      } catch {
        return normalizeHost(pageUrl);
      }
    })();

    const seen = new Map<string, ThirdPartyServiceRecord>();

    for (const state of states) {
      for (const request of state.thirdPartyRequests) {
        if (isSameSite(request.domain, pageHost)) continue;
        const key = `${request.domain}|${state.consentState}`;
        if (seen.has(key)) continue;
        const classification = classifyDomain(request.domain);
        seen.set(key, {
          domain: request.domain,
          category: classification.category,
          firstObservedOnPage: pageUrl,
          firstObservedAt: request.timestamp,
          consentState: state.consentState,
          requestType: request.resourceType,
        });
      }
    }

    return Array.from(seen.values());
  }

  merge(records: ThirdPartyServiceRecord[][]): ThirdPartyServiceRecord[] {
    const merged = new Map<string, ThirdPartyServiceRecord>();
    for (const list of records) {
      for (const record of list) {
        const key = `${record.domain}|${record.consentState}`;
        if (!merged.has(key)) merged.set(key, record);
      }
    }
    return Array.from(merged.values());
  }
}
