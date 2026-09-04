import { describe, expect, it } from "vitest";
import { mkdtempSync, chmodSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MINIMUM_NODE_MAJOR,
  checkCaBundle,
  checkNodeVersion,
  checkOutputDirectory,
  checkPacks,
  checkProxy,
  checkSandbox,
  overallStatus,
  type CheckResult,
} from "../src/cli/doctor.js";
import { loadConfigFromObject } from "../src/config/loader.js";
import { parseRobotsTxt, type TextFetcher } from "../src/utils/robots.js";
import { fetchRobotsTxt } from "../src/utils/robots.js";

describe("checkNodeVersion", () => {
  it("accepts an even-numbered LTS release", () => {
    expect(checkNodeVersion("v20.11.0").status).toBe("ok");
    expect(checkNodeVersion("v22.0.0").status).toBe("ok");
  });

  it("fails below the supported floor", () => {
    const result = checkNodeVersion("v16.20.0");
    expect(result.status).toBe("fail");
    expect(result.hint).toContain(String(MINIMUM_NODE_MAJOR));
  });

  it("warns on a non-LTS odd release rather than failing it", () => {
    expect(checkNodeVersion("v21.6.0").status).toBe("warn");
  });

  it("does not throw on an unparsable version", () => {
    expect(checkNodeVersion("not-a-version").status).toBe("warn");
  });

  /**
   * These drifted once: engines.node moved to >=20 while this floor stayed at
   * 18, so doctor called a Node 18 environment healthy when npm would refuse
   * to install into it.
   */
  it("uses the same floor as engines.node, so doctor cannot pass what npm rejects", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8")
    ) as { engines: { node: string } };
    const declared = Number.parseInt(pkg.engines.node.match(/(\d+)/)?.[1] ?? "", 10);
    expect(declared).toBe(MINIMUM_NODE_MAJOR);
  });
});

describe("checkSandbox", () => {
  it("is satisfied when not running as root", () => {
    expect(checkSandbox(() => 1000, {}).status).toBe("ok");
  });

  it("warns as root, because the sandbox is silently given up", () => {
    const result = checkSandbox(() => 0, {});
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("--no-sandbox");
  });

  it("fails when root is combined with an explicit opt-out, which cannot start", () => {
    const result = checkSandbox(() => 0, { UNIVERSCAN_NO_SANDBOX: "0" });
    expect(result.status).toBe("fail");
  });

  it("copes with a platform that has no getuid, such as Windows", () => {
    expect(checkSandbox(null, {}).status).toBe("ok");
  });
});

describe("checkProxy", () => {
  const config = loadConfigFromObject({});

  it("is quiet when no proxy exists anywhere", () => {
    expect(checkProxy(config, {}).status).toBe("ok");
  });

  it("warns when the environment has a proxy the browser will not use", () => {
    // The dangerous case: Node's fetch and the browser disagree about the
    // network, so the crawl and the scan see different sites.
    const result = checkProxy(config, { HTTPS_PROXY: "http://proxy.corp:8080" });
    expect(result.status).toBe("warn");
    expect(result.hint).toContain("browser.proxy.server");
  });

  it("accepts a proxy configured for the browser", () => {
    const proxied = loadConfigFromObject({ browser: { proxy: { server: "http://proxy.corp:8080" } } });
    expect(checkProxy(proxied, { HTTPS_PROXY: "http://proxy.corp:8080" }).status).toBe("ok");
  });

  it("reads the lower-case env spellings too", () => {
    expect(checkProxy(config, { https_proxy: "http://p:1" }).status).toBe("warn");
    expect(checkProxy(config, { http_proxy: "http://p:1" }).status).toBe("warn");
  });
});

describe("checkCaBundle", () => {
  it("accepts an extra CA bundle", () => {
    expect(checkCaBundle({ NODE_EXTRA_CA_CERTS: "/etc/ssl/corp.pem" }).status).toBe("ok");
  });

  it("fails a process-wide disabling of certificate verification", () => {
    const result = checkCaBundle({ NODE_TLS_REJECT_UNAUTHORIZED: "0" });
    expect(result.status).toBe("fail");
    expect(result.hint).toContain("NODE_EXTRA_CA_CERTS");
  });

  it("is satisfied by the default trust store", () => {
    expect(checkCaBundle({}).status).toBe("ok");
  });

  it("still fails when verification is disabled AND a CA bundle is configured", () => {
    // The reassuring condition must not hide the dangerous one.
    const result = checkCaBundle({
      NODE_EXTRA_CA_CERTS: "/etc/ssl/corp.pem",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    });
    expect(result.status).toBe("fail");
  });
});

describe("checkOutputDirectory", () => {
  it("accepts a directory that does not exist yet", async () => {
    const result = await checkOutputDirectory(join(tmpdir(), `universcan-absent-${Date.now()}`));
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("will be created");
  });

  it("fails an existing directory that cannot be written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "universcan-ro-"));
    try {
      chmodSync(dir, 0o500);
      const result = await checkOutputDirectory(dir);
      // A test run as root can write regardless of mode, so only assert the
      // failure where the permission actually bites.
      if (typeof process.getuid === "function" && process.getuid() !== 0) {
        expect(result.status).toBe("fail");
        expect(result.hint).toContain("permissions");
      } else {
        expect(result.status).toBe("ok");
      }
    } finally {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("checkPacks", () => {
  it("warns when the configuration selects nothing", async () => {
    const result = await checkPacks(loadConfigFromObject({ jurisdictions: [], regulatoryPacks: ["nope"] }));
    expect(result.status).toBe("warn");
  });

  it("reports how many packs and rules a real scope brings in", async () => {
    const result = await checkPacks(loadConfigFromObject({ jurisdictions: ["European Union"] }));
    expect(result.status).toBe("ok");
    expect(result.detail).toMatch(/\d+ of \d+ pack\(s\) apply/);
  });
});

describe("overallStatus", () => {
  const result = (status: CheckResult["status"]): CheckResult => ({ name: "x", status, detail: "" });

  it("reports the worst status present", () => {
    expect(overallStatus([result("ok"), result("ok")])).toBe("ok");
    expect(overallStatus([result("ok"), result("warn")])).toBe("warn");
    expect(overallStatus([result("warn"), result("fail")])).toBe("fail");
  });

  it("treats an empty set as ok", () => {
    expect(overallStatus([])).toBe("ok");
  });
});

describe("robots.txt fetching is injectable", () => {
  it("uses the supplied fetcher rather than Node's global fetch", async () => {
    // This is what lets robots.txt travel the browser's network path, so a
    // proxied environment does not have the crawler and the scanner
    // disagreeing about what the internet looks like.
    const seen: string[] = [];
    const fetcher: TextFetcher = async (url) => {
      seen.push(url);
      return { ok: true, body: "User-agent: *\nDisallow: /admin" };
    };

    const rules = await fetchRobotsTxt("https://example.com/some/page", fetcher);

    expect(seen).toEqual(["https://example.com/robots.txt"]);
    expect(rules.disallow).toEqual(["/admin"]);
  });

  it("treats a non-ok response as no restrictions, not as blanket denial", async () => {
    const rules = await fetchRobotsTxt("https://example.com", async () => ({ ok: false, body: "" }));
    expect(rules.loaded).toBe(false);
    expect(parseRobotsTxt("").loaded).toBe(true); // sanity: parse itself still works
  });

  it("survives a fetcher that throws", async () => {
    const rules = await fetchRobotsTxt("https://example.com", async () => {
      throw new Error("proxy refused");
    });
    expect(rules.loaded).toBe(false);
  });
});
