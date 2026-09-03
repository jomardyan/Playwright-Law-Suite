import { describe, expect, it } from "vitest";
import {
  analyzeSetCookieHeaders,
  EXPECTED_HEADERS,
  SESSION_COOKIE_PATTERN,
} from "../src/modules/security/SecurityHeaderScanner.js";

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

describe("analyzeSetCookieHeaders: precision", () => {
  it("marks session-carrying cookies so a missing Secure flag can be weighed separately", () => {
    const issues = analyzeSetCookieHeaders(
      ["sessionid=abc; Path=/; SameSite=Lax", "theme=dark; Path=/; SameSite=Lax"],
      true,
      "shop.example"
    );
    expect(issues.find((i) => i.name === "sessionid" && i.problem === "not-secure-on-https")?.sessionLike).toBe(true);
    expect(issues.find((i) => i.name === "theme" && i.problem === "not-secure-on-https")?.sessionLike).toBe(false);
  });

  it("reports a cookie whose __Host- prefix the browser will silently reject", () => {
    // The developer believes the cookie is locked to this host; because the
    // conditions are unmet the browser drops it, and the protection they
    // think they have does not exist.
    const issues = analyzeSetCookieHeaders(
      ["__Host-session=abc; Secure; Path=/account; HttpOnly; SameSite=Lax"],
      true,
      "shop.example"
    );
    expect(issues.some((i) => i.problem === "prefix-requirements-unmet")).toBe(true);
  });

  it("accepts a correctly formed __Host- cookie", () => {
    const issues = analyzeSetCookieHeaders(
      ["__Host-session=abc; Secure; Path=/; HttpOnly; SameSite=Lax"],
      true,
      "shop.example"
    );
    expect(issues.some((i) => i.problem === "prefix-requirements-unmet")).toBe(false);
  });

  it("reports a __Secure- cookie that is not actually Secure", () => {
    const issues = analyzeSetCookieHeaders(["__Secure-token=abc; Path=/; SameSite=Lax"], true, "shop.example");
    expect(issues.some((i) => i.problem === "prefix-requirements-unmet")).toBe(true);
  });

  it("reports one issue per cookie and problem when a response repeats a Set-Cookie", () => {
    const issues = analyzeSetCookieHeaders(
      ["sessionid=abc; Path=/; SameSite=Lax", "sessionid=def; Path=/; SameSite=Lax"],
      true,
      "shop.example"
    );
    expect(issues.filter((i) => i.name === "sessionid" && i.problem === "not-secure-on-https")).toHaveLength(1);
  });
});

describe("SESSION_COOKIE_PATTERN", () => {
  it("recognises the session cookie names frameworks actually ship", () => {
    for (const name of [
      "sessionid",
      "SESSIONID",
      "session_id",
      "PHPSESSID",
      "JSESSIONID",
      "connect.sid",
      "laravel_session",
      "auth_token",
      "access_token",
      "refresh_token",
      "csrftoken",
      "XSRF-TOKEN",
      "jwt",
      "remember_me",
    ]) {
      expect(SESSION_COOKIE_PATTERN.test(name), name).toBe(true);
    }
  });

  it("does not treat ordinary cookies as credentials", () => {
    for (const name of ["theme", "locale", "cart", "aside", "logintime", "consent", "_ga", "visitor_country"]) {
      expect(SESSION_COOKIE_PATTERN.test(name), name).toBe(false);
    }
  });
});
