import { describe, expect, it } from "vitest";
import {
  classifyDomain,
  extractDomain,
  extractHttpHost,
  getRegistrableDomain,
  isNonEssentialTrackingCategory,
  isSameSite,
} from "../src/utils/domainClassifier.js";

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

describe("getRegistrableDomain", () => {
  it("reduces a host to its registrable domain", () => {
    expect(getRegistrableDomain("cdn.shop.example.com")).toBe("example.com");
    expect(getRegistrableDomain("www.example.com")).toBe("example.com");
    expect(getRegistrableDomain("example.com")).toBe("example.com");
  });

  it("handles multi-label public suffixes", () => {
    expect(getRegistrableDomain("static.assets.example.co.uk")).toBe("example.co.uk");
    expect(getRegistrableDomain("shop.example.com.au")).toBe("example.com.au");
    expect(getRegistrableDomain("www.example.co.jp")).toBe("example.co.jp");
  });

  it("treats each subdomain of a hosting suffix as its own site", () => {
    expect(getRegistrableDomain("alice.github.io")).toBe("alice.github.io");
    expect(getRegistrableDomain("my-shop.myshopify.com")).toBe("my-shop.myshopify.com");
  });

  it("leaves IP literals and single-label hosts alone", () => {
    expect(getRegistrableDomain("127.0.0.1")).toBe("127.0.0.1");
    expect(getRegistrableDomain("localhost")).toBe("localhost");
  });
});

describe("isSameSite", () => {
  it("treats a site's own subdomains as first-party", () => {
    // Reporting `cdn.example.com` as a third-party recipient of personal data
    // is the false positive this exists to stop.
    expect(isSameSite("cdn.example.com", "www.example.com")).toBe(true);
    expect(isSameSite("api.example.co.uk", "shop.example.co.uk")).toBe(true);
  });

  it("keeps genuinely external hosts external", () => {
    expect(isSameSite("www.google-analytics.com", "www.example.com")).toBe(false);
    expect(isSameSite("evil-example.com", "example.com")).toBe(false);
  });

  it("ignores case, trailing dots and ports", () => {
    expect(isSameSite("WWW.Example.com.", "example.com:8443")).toBe(true);
  });
});

describe("extractHttpHost", () => {
  it("returns the host of an http(s) URL", () => {
    expect(extractHttpHost("https://Www.Example.com:443/a")).toBe("www.example.com");
  });

  it("returns null for schemes that never reach a third party", () => {
    // These used to be recorded as "domains" whose name was the whole payload,
    // inflating the recipient count in every cross-border transfer finding.
    expect(extractHttpHost("data:image/png;base64,iVBORw0KGgo=")).toBeNull();
    expect(extractHttpHost("blob:https://example.com/1234")).toBeNull();
    expect(extractHttpHost("about:blank")).toBeNull();
    expect(extractHttpHost("chrome-extension://abc/script.js")).toBeNull();
  });
});

describe("tracker categories", () => {
  it("classifies the tracking services a consent rule needs to see", () => {
    expect(classifyDomain("bat.bing.com").category).toBe("advertising");
    expect(classifyDomain("static.criteo.net").category).toBe("advertising");
    expect(classifyDomain("snap.licdn.com").category).toBe("advertising");
    expect(classifyDomain("cdn.mouseflow.com").category).toBe("session-recording");
    expect(classifyDomain("dev.visualwebsiteoptimizer.com").category).toBe("ab-testing");
    expect(classifyDomain("static.klaviyo.com").category).toBe("marketing-automation");
    expect(classifyDomain("api.fpjs.io").category).toBe("fingerprinting");
    expect(classifyDomain("rlcdn.com").category).toBe("data-broker");
    expect(classifyDomain("cdn.matomo.cloud").category).toBe("analytics");
  });

  it("recognises consent platforms, which are never trackers themselves", () => {
    for (const host of ["cdn.cookielaw.org", "app.usercentrics.eu", "sdk.privacy-center.org.didomi.io", "cdn.cookieyes.com"]) {
      const category = classifyDomain(host).category;
      expect(isNonEssentialTrackingCategory(category), `${host} -> ${category}`).toBe(false);
    }
    expect(classifyDomain("cdn.cookielaw.org").service).toBe("OneTrust");
  });

  it("keeps infrastructure out of the non-essential set", () => {
    for (const host of ["js.stripe.com", "cdnjs.cloudflare.com", "fonts.gstatic.com", "o1.ingest.sentry.io", "www.recaptcha.net"]) {
      expect(isNonEssentialTrackingCategory(classifyDomain(host).category), host).toBe(false);
    }
  });

  it("prefers the more specific pattern when a host matches two", () => {
    expect(classifyDomain("ads.linkedin.com").category).toBe("advertising");
    expect(classifyDomain("www.linkedin.com").category).toBe("social-plugin");
  });
});
