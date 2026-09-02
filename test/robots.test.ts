import { describe, expect, it } from "vitest";
import { isAllowedByRobots, parseRobotsTxt, EMPTY_ROBOTS } from "../src/utils/robots.js";

describe("parseRobotsTxt", () => {
  it("reads the wildcard group when no UniVerscan-specific group exists", () => {
    const rules = parseRobotsTxt(["User-agent: *", "Disallow: /admin", "Disallow: /internal"].join("\n"));
    expect(rules.loaded).toBe(true);
    expect(rules.disallow).toEqual(["/admin", "/internal"]);
  });

  it("prefers a group naming universcan over the wildcard group", () => {
    const body = [
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: universcan",
      "Disallow: /checkout/live",
    ].join("\n");
    const rules = parseRobotsTxt(body);
    expect(rules.disallow).toEqual(["/checkout/live"]);
    expect(isAllowedByRobots("/pricing", rules)).toBe(true);
  });

  it("applies a rule block to every user-agent listed above it", () => {
    const body = ["User-agent: googlebot", "User-agent: *", "Disallow: /private"].join("\n");
    const rules = parseRobotsTxt(body);
    expect(rules.disallow).toEqual(["/private"]);
  });

  it("collects sitemap declarations and ignores comments", () => {
    const body = [
      "# our robots file",
      "Sitemap: https://example.com/sitemap-a.xml",
      "User-agent: *   # everyone",
      "Disallow: /tmp",
      "Sitemap: https://example.com/sitemap-b.xml",
    ].join("\n");
    const rules = parseRobotsTxt(body);
    expect(rules.sitemaps).toEqual(["https://example.com/sitemap-a.xml", "https://example.com/sitemap-b.xml"]);
    expect(rules.disallow).toEqual(["/tmp"]);
  });

  it("treats an empty Disallow value as no restriction rather than as blocking everything", () => {
    const rules = parseRobotsTxt(["User-agent: *", "Disallow:"].join("\n"));
    expect(rules.disallow).toEqual([]);
    expect(isAllowedByRobots("/anything", rules)).toBe(true);
  });
});

describe("isAllowedByRobots", () => {
  it("allows everything when robots.txt could not be loaded", () => {
    expect(isAllowedByRobots("/admin", EMPTY_ROBOTS)).toBe(true);
  });

  it("blocks a path matching a disallow prefix", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /admin");
    expect(isAllowedByRobots("/admin", rules)).toBe(false);
    expect(isAllowedByRobots("/admin/users", rules)).toBe(false);
    expect(isAllowedByRobots("/administration-guide", rules)).toBe(false); // prefix match, per the spec
    expect(isAllowedByRobots("/public", rules)).toBe(true);
  });

  it("lets a longer Allow rule override a shorter Disallow", () => {
    const rules = parseRobotsTxt(["User-agent: *", "Disallow: /account", "Allow: /account/privacy"].join("\n"));
    expect(isAllowedByRobots("/account/settings", rules)).toBe(false);
    expect(isAllowedByRobots("/account/privacy", rules)).toBe(true);
  });

  it("supports the * wildcard and the $ end-anchor", () => {
    const rules = parseRobotsTxt(["User-agent: *", "Disallow: /*.pdf$", "Disallow: /search?*"].join("\n"));
    expect(isAllowedByRobots("/docs/terms.pdf", rules)).toBe(false);
    expect(isAllowedByRobots("/docs/terms.pdf.html", rules)).toBe(true);
    expect(isAllowedByRobots("/search?q=hello", rules)).toBe(false);
  });
});
