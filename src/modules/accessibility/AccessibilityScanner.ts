import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import type { AxeResults, Result as AxeResultItem, NodeResult as AxeNodeResult } from "axe-core";
import type { UniVerscanConfig } from "../../config/schema.js";

const STANDARD_TAGS: Record<UniVerscanConfig["accessibility"]["standard"], string[]> = {
  wcag2a: ["wcag2a"],
  wcag2aa: ["wcag2a", "wcag2aa"],
  wcag21aa: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
  wcag22aa: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  wcag22aaa: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "wcag2aaa"],
};

export interface AxeViolationSummary {
  id: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: Array<{ target: string[]; html: string; failureSummary?: string }>;
}

export interface InteractionCheckResult {
  id: string;
  passed: boolean | null; // null = could not be determined automatically
  description: string;
  detail: string;
}

/**
 * Runs axe-core against the page for the configured WCAG level, plus a small
 * set of interaction checks axe cannot perform on its own (skip links, focus
 * visibility). Interaction checks that cannot be determined reliably report
 * `passed: null` rather than a false pass.
 */
export class AccessibilityScanner {
  async run(page: Page, standard: UniVerscanConfig["accessibility"]["standard"]): Promise<AxeViolationSummary[]> {
    const results: AxeResults = await new AxeBuilder({ page }).withTags(STANDARD_TAGS[standard]).analyze();
    return results.violations.map((violation: AxeResultItem) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      description: violation.description,
      help: violation.help,
      helpUrl: violation.helpUrl,
      tags: violation.tags,
      nodes: violation.nodes.map((node: AxeNodeResult) => ({
        target: node.target.map(String),
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    }));
  }

  async runInteractionChecks(page: Page): Promise<InteractionCheckResult[]> {
    const results: InteractionCheckResult[] = [];

    const skipLink = await page
      .locator("a[href^='#']")
      .filter({ hasText: /skip to (main )?content|skip navigation/i })
      .first()
      .count()
      .catch(() => 0);
    results.push({
      id: "skip-navigation-link",
      passed: skipLink > 0,
      description: "A 'skip to content' link should be present as the first focusable element.",
      detail: skipLink > 0 ? "Skip link detected." : "No skip-navigation link was detected by text heuristic.",
    });

    let focusVisible: boolean | null = null;
    try {
      await page.keyboard.press("Tab");
      focusVisible = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return false;
        const style = window.getComputedStyle(active);
        return style.outlineStyle !== "none" || style.boxShadow !== "none";
      });
    } catch {
      focusVisible = null;
    }
    results.push({
      id: "focus-visible-indicator",
      passed: focusVisible,
      description: "The first focusable element after Tab should have a visible focus indicator.",
      detail:
        focusVisible === null
          ? "Could not be determined automatically in this environment."
          : focusVisible
            ? "A visible outline/box-shadow was detected on focus."
            : "No visible outline or box-shadow was detected after pressing Tab.",
    });

    results.push({
      id: "modal-focus-trapping",
      passed: null,
      description: "Modal dialogs must trap focus and return it to the invoking control on close.",
      detail: "Requires manual verification per modal component; not evaluated automatically.",
    });

    results.push({
      id: "accessible-authentication",
      passed: null,
      description: "Authentication must not rely solely on a cognitive function test without an accessible alternative.",
      detail: "Requires manual verification of the authentication flow.",
    });

    return results;
  }
}
