import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { serveStaticDirectory, type StartedApplication } from "../src/modules/source/AppRunner.js";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

describe("serveStaticDirectory path containment", () => {
  let dir: string;
  let app: StartedApplication | null = null;

  afterEach(async () => {
    if (app) await app.stop();
    app = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("does not serve files from a sibling directory that merely shares a string prefix with the root", async () => {
    dir = mkdtempSync(join(tmpdir(), "universcan-approot-"));
    const siteRoot = join(dir, "site");
    const siblingSecret = join(dir, "site-internal");
    mkdirSync(siteRoot, { recursive: true });
    mkdirSync(siblingSecret, { recursive: true });
    writeFileSync(join(siteRoot, "index.html"), "<html><body>public</body></html>");
    writeFileSync(join(siblingSecret, "secret.json"), JSON.stringify({ secret: "do-not-serve" }));

    const port = await getFreePort();
    app = serveStaticDirectory(siteRoot, port);
    const response = await fetch(new URL("../site-internal/secret.json", app.url));
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toContain("do-not-serve");
  });

  it("serves index.html for the root when it is contained in repoPath", async () => {
    dir = mkdtempSync(join(tmpdir(), "universcan-approot-"));
    writeFileSync(join(dir, "index.html"), "<html><body>hello</body></html>");
    const port = await getFreePort();
    app = serveStaticDirectory(dir, port);
    const response = await fetch(app.url);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("hello");
  });
});
