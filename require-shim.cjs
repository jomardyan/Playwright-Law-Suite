/**
 * Reached only when a CommonJS consumer calls require("universcan").
 *
 * Without this, Node reports ERR_PACKAGE_PATH_NOT_EXPORTED / 'No "exports"
 * main defined', which reads like a broken package rather than a deliberate
 * ESM-only one. This turns that into an instruction.
 */
throw new Error(
  [
    "universcan is an ES module and cannot be loaded with require().",
    "",
    "From CommonJS, use a dynamic import:",
    "  const { ScanEngine } = await import('universcan');",
    "",
    "Or call the CLI as a subprocess, which has no module-system constraint:",
    "  npx universcan scan --url https://example.com --format json",
  ].join("\n")
);
