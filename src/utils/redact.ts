const PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "credit-card", regex: /\b(?:\d[ -]*?){13,19}\b/g },
  { name: "jwt-or-session-token", regex: /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "bearer-token", regex: /Bearer\s+[A-Za-z0-9._-]+/gi },
  { name: "phone", regex: /\+?\d[\d ()-]{8,}\d/g },
];

/**
 * Redacts likely personal data / secrets from strings that are about to be
 * embedded in a report. This is heuristic, not a guarantee: evidence
 * collection must still avoid capturing raw form submissions or credentials
 * wherever possible.
 */
export function redactSensitive(input: string): string {
  let output = input;
  for (const { name, regex } of PATTERNS) {
    output = output.replace(regex, `[REDACTED:${name}]`);
  }
  return output;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === "string") {
    return redactSensitive(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|authorization|cookie|api[_-]?key/i.test(key)) {
        out[key] = "[REDACTED:sensitive-field]";
      } else {
        out[key] = redactDeep(val);
      }
    }
    return out as unknown as T;
  }
  return value;
}
