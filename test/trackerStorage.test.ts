import { describe, expect, it } from "vitest";
import { classifyStorageKey, findTrackingStorage, isConsentRecordKey } from "../src/utils/trackerStorage.js";

describe("classifyStorageKey", () => {
  it("recognises the first-party analytics identifiers a server-side tag writes", () => {
    expect(classifyStorageKey("_ga", "cookie")).toMatchObject({ category: "analytics", service: "Google Analytics" });
    expect(classifyStorageKey("_ga_ABC123XYZ", "cookie")?.category).toBe("analytics");
    expect(classifyStorageKey("_gid", "cookie")?.category).toBe("analytics");
  });

  it("recognises advertising and session-recording identifiers", () => {
    expect(classifyStorageKey("_fbp", "cookie")?.service).toBe("Meta Pixel");
    expect(classifyStorageKey("_gcl_au", "cookie")?.category).toBe("advertising");
    expect(classifyStorageKey("_clck", "cookie")?.category).toBe("session-recording");
    expect(classifyStorageKey("_hjSessionUser_1234", "cookie")?.service).toBe("Hotjar");
  });

  it("recognises identifiers held in web storage, not only cookies", () => {
    expect(classifyStorageKey("ajs_anonymous_id", "localStorage")).toMatchObject({
      mechanism: "localStorage",
      service: "Segment",
    });
    expect(classifyStorageKey("_vwo_uuid_v2", "sessionStorage")?.category).toBe("ab-testing");
  });

  it("returns null for ordinary first-party keys rather than guessing", () => {
    for (const key of ["session", "csrf_token", "locale", "theme", "cart_id", "language", "id", "fr", "UID"]) {
      expect(classifyStorageKey(key, "cookie"), key).toBeNull();
    }
  });

  it("does not treat the consent record itself as tracking", () => {
    // The cookie exists because the site implemented consent; calling it a
    // pre-consent tracker would invert the finding.
    for (const key of ["OptanonConsent", "CookieConsent", "euconsent-v2", "didomi_token", "cookie_notice_accepted"]) {
      expect(isConsentRecordKey(key), key).toBe(true);
      expect(classifyStorageKey(key, "cookie"), key).toBeNull();
    }
  });

  it("anchors patterns so unrelated names containing a tracker substring do not match", () => {
    expect(classifyStorageKey("organisation", "cookie")).toBeNull();
    expect(classifyStorageKey("my_gid_preference", "cookie")).toBeNull();
    expect(classifyStorageKey("language", "cookie")).toBeNull();
  });
});

describe("findTrackingStorage", () => {
  it("collects tracking identifiers across cookies and both web stores", () => {
    const found = findTrackingStorage({
      cookies: [{ name: "_ga" }, { name: "sessionid" }, { name: "_fbp" }],
      localStorageKeys: ["ajs_anonymous_id", "cart"],
      sessionStorageKeys: ["_uetsid"],
    });

    expect(found.map((entry) => entry.key).sort()).toEqual(["_fbp", "_ga", "_uetsid", "ajs_anonymous_id"]);
    expect(found.find((entry) => entry.key === "_uetsid")?.mechanism).toBe("sessionStorage");
  });

  it("returns nothing for a page that stores only what it needs", () => {
    expect(
      findTrackingStorage({
        cookies: [{ name: "sessionid" }, { name: "csrftoken" }, { name: "OptanonConsent" }],
        localStorageKeys: ["theme"],
        sessionStorageKeys: [],
      })
    ).toEqual([]);
  });

  it("deduplicates a key seen more than once in the same mechanism", () => {
    const found = findTrackingStorage({
      cookies: [{ name: "_ga" }, { name: "_ga" }],
      localStorageKeys: [],
      sessionStorageKeys: [],
    });
    expect(found).toHaveLength(1);
  });
});
