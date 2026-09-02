import { describe, expect, it } from "vitest";
import { analyzeSetCookieHeaders, EXPECTED_HEADERS } from "../src/modules/security/SecurityHeaderScanner.js";

describe("analyzeSetCookieHeaders", () => {
  it("flags a session cookie with no Secure flag on an HTTPS page", () => {
    const issues = analyzeSetCookieHeaders(["sid=abc; Path=/; HttpOnly; SameSite=Lax"], true, "example.com");
    expect(issues.map((i) => i.problem)).toEqual(["not-secure-on-https"]);
  });

  it("does not raise the Secure issue for a plaintext page", () => {
    const issues = analyzeSetCookieHeaders(["sid=abc; Path=/; HttpOnly; SameSite=Lax"], false, "example.com");
    expect(issues).toEqual([]);
  });

  it("detects a SameSite attribute the server never sent, which the browser cookie API hides", () => {
    const issues = analyzeSetCookieHeaders(["prefs=dark; Path=/; Secure"], true, "example.com");
    expect(issues.map((i) => i.problem)).toEqual(["samesite-unset"]);
  });

  it("flags SameSite=None without Secure, which browsers reject outright", () => {
    const issues = analyzeSetCookieHeaders(["tracker=1; SameSite=None"], false, "example.com");
    expect(issues.map((i) => i.problem)).toContain("samesite-none-without-secure");
  });

  it("only asks for HttpOnly on cookies whose name looks like session or auth state", () => {
    const session = analyzeSetCookieHeaders(["PHPSESSID=x; Secure; SameSite=Lax"], true, "example.com");
    expect(session.map((i) => i.problem)).toContain("no-httponly");

    const analytics = analyzeSetCookieHeaders(["_ga=GA1.2.3; Secure; SameSite=Lax"], true, "example.com");
    expect(analytics.map((i) => i.problem)).not.toContain("no-httponly");
  });

  it("reads the declared Domain attribute when one is present", () => {
    const issues = analyzeSetCookieHeaders(["auth_token=x; Domain=.example.com; Secure"], true, "www.example.com");
    expect(issues.every((i) => i.domain === ".example.com")).toBe(true);
  });

  it("handles several Set-Cookie headers independently", () => {
    const issues = analyzeSetCookieHeaders(
      ["a=1; Secure; SameSite=Lax", "session_id=2; SameSite=Lax", "c=3; Secure"],
      true,
      "example.com"
    );
    expect(issues.map((i) => `${i.name}:${i.problem}`).sort()).toEqual([
      "c:samesite-unset",
      "session_id:no-httponly",
      "session_id:not-secure-on-https",
    ]);
  });

  it("ignores a malformed header rather than throwing", () => {
    expect(analyzeSetCookieHeaders(["", "   ", "=novalue"], true, "example.com")).toEqual([]);
  });
});

describe("EXPECTED_HEADERS", () => {
  it("covers the transport and browser-side protections the security pack reports on", () => {
    expect([...EXPECTED_HEADERS]).toEqual([
      "strict-transport-security",
      "content-security-policy",
      "x-content-type-options",
      "referrer-policy",
    ]);
  });
});
