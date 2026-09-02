import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactDeep } from "../utils/redact.js";
import type { Evidence } from "./types.js";

let counter = 0;
function nextId(): string {
  counter += 1;
  return `ev_${Date.now()}_${counter}`;
}

/**
 * Collects reproducible evidence for findings. Binary payloads (screenshots)
 * are written to disk under outputDir/evidence and referenced by path;
 * structured payloads are redacted and kept inline unless they are large.
 */
export class EvidenceStore {
  private readonly outputDir: string;
  private readonly evidenceDir: string;
  private initialized = false;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    this.evidenceDir = join(outputDir, "evidence");
  }

  private ensureDir(): void {
    if (this.initialized) return;
    mkdirSync(this.evidenceDir, { recursive: true });
    this.initialized = true;
  }

  note(description: string, data?: unknown): Evidence {
    return { type: "note", description, data: data !== undefined ? redactDeep(data) : undefined };
  }

  domFragment(description: string, html: string, sourceFile?: string): Evidence {
    return { type: "dom-fragment", description, data: redactDeep(html), sourceFile };
  }

  requestLog(description: string, requests: unknown[]): Evidence {
    return { type: "request-log", description, data: redactDeep(requests) };
  }

  cookieSnapshot(description: string, cookies: unknown[]): Evidence {
    return { type: "cookie-snapshot", description, data: redactDeep(cookies) };
  }

  storageSnapshot(description: string, keys: unknown): Evidence {
    return { type: "storage-snapshot", description, data: redactDeep(keys) };
  }

  accessibilityResult(description: string, result: unknown): Evidence {
    return { type: "accessibility-result", description, data: redactDeep(result) };
  }

  consentSequence(description: string, sequence: unknown): Evidence {
    return { type: "consent-sequence", description, data: redactDeep(sequence) };
  }

  sourceReference(description: string, sourceFile: string, sourceLine: number, snippet?: string): Evidence {
    return { type: "source-reference", description, sourceFile, sourceLine, data: snippet ? redactDeep(snippet) : undefined };
  }

  /** Persists a screenshot buffer to disk and returns an Evidence pointer to it. */
  screenshot(description: string, buffer: Buffer): Evidence {
    this.ensureDir();
    const filename = `${nextId()}.png`;
    writeFileSync(join(this.evidenceDir, filename), buffer);
    return { type: "screenshot", description, data: { path: join("evidence", filename) } };
  }
}
