"use client";

import { useState } from "react";

/**
 * The only client component on the site. A landing page for a CLI lives or
 * dies on how fast someone can get the install command into their terminal.
 *
 * navigator.clipboard is unavailable on insecure origins and can be blocked
 * by permissions policy, so the failure path is visible rather than silent.
 */
export default function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  const label =
    state === "copied" ? "Copied" : state === "failed" ? "Press Ctrl+C" : "Copy";

  return (
    <button
      type="button"
      className="copy"
      onClick={copy}
      data-state={state}
      aria-label={state === "copied" ? "Copied to clipboard" : "Copy to clipboard"}
    >
      {state === "copied" ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect
            x="5.5"
            y="5.5"
            width="8"
            height="8"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M10.5 3.5H4A1.5 1.5 0 002.5 5v6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
}
