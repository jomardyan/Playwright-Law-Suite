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

export interface AccessibilityScanResult {
  violations: AxeViolationSummary[];
  /**
   * Checks axe ran but could not decide - most often colour contrast against
   * a background image, or an element whose accessible name axe cannot
   * resolve on its own.
   *
   * These were previously discarded. Dropping them silently is the failure
   * mode this scanner exists to avoid: a check that could not run is not a
   * check that passed, and a report that omits it implies conformance that
   * was never established.
   */
  incomplete: AxeViolationSummary[];
}

export interface InteractionCheckResult {
  id: string;
  passed: boolean | null; // null = could not be determined automatically
  description: string;
  detail: string;
}

function summarize(item: AxeResultItem): AxeViolationSummary {
  return {
    id: item.id,
    impact: item.impact ?? null,
    description: item.description,
    help: item.help,
    helpUrl: item.helpUrl,
    tags: item.tags,
    nodes: item.nodes.map((node: AxeNodeResult) => ({
      target: node.target.map(String),
      html: node.html,
      failureSummary: node.failureSummary,
    })),
  };
}

/**
 * Runs axe-core against the page for the configured WCAG level, plus a small
 * set of interaction checks axe cannot perform on its own (bypass mechanism,
 * focus visibility). Interaction checks that cannot be determined reliably
 * report `passed: null` rather than a false pass or a false failure.
 */
export class AccessibilityScanner {
  async run(page: Page, standard: UniVerscanConfig["accessibility"]["standard"]): Promise<AxeViolationSummary[]> {
    return (await this.analyze(page, standard)).violations;
  }

  async analyze(page: Page, standard: UniVerscanConfig["accessibility"]["standard"]): Promise<AccessibilityScanResult> {
    const results: AxeResults = await new AxeBuilder({ page }).withTags(STANDARD_TAGS[standard]).analyze();
    return {
      violations: results.violations.map(summarize),
      incomplete: (results.incomplete ?? []).map(summarize),
    };
  }

  async runInteractionChecks(page: Page): Promise<InteractionCheckResult[]> {
    const results: InteractionCheckResult[] = [];

    /**
     * SC 2.4.1 asks for *a* mechanism to bypass repeated blocks. A skip link
     * is the best known one, but ARIA landmarks satisfy the criterion too
     * (technique ARIA11), so a page with a `<main>` region and no skip link
     * is not a failure - it is a judgement call about whether the landmark
     * structure is usable, which is a person's to make. Reporting it as a
     * violation, as this check used to, was wrong on most well-built pages.
     */
    const bypass = await page
      .evaluate(() => {
        const skipLink = Array.from(document.querySelectorAll("a[href^='#']")).some((el) =>
          /skip to (main )?content|skip navigation|skip to nav|zum inhalt springen|aller au contenu|saltar al contenido/i.test(
            el.textContent ?? ""
          )
        );
        const landmarks = document.querySelectorAll(
          "main, [role='main'], nav, [role='navigation'], header, [role='banner'], [role='contentinfo']"
        ).length;
        const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6").length;
        return { skipLink, landmarks, headings };
      })
      .catch(() => null);

    if (bypass === null) {
      results.push({
        id: "bypass-blocks-mechanism",
        passed: null,
        description: "A mechanism must exist to bypass blocks of content repeated on multiple pages (WCAG SC 2.4.1).",
        detail: "The page could not be inspected for a bypass mechanism.",
      });
    } else if (bypass.skipLink) {
      results.push({
        id: "bypass-blocks-mechanism",
        passed: true,
        description: "A mechanism must exist to bypass blocks of content repeated on multiple pages (WCAG SC 2.4.1).",
        detail: "A skip-navigation link was detected.",
      });
    } else if (bypass.landmarks > 0 || bypass.headings > 0) {
      results.push({
        id: "bypass-blocks-mechanism",
        passed: null,
        description: "A mechanism must exist to bypass blocks of content repeated on multiple pages (WCAG SC 2.4.1).",
        detail: `No skip-navigation link was found, but ${bypass.landmarks} landmark region(s) and ${bypass.headings} heading(s) are present. Landmark and heading navigation can satisfy SC 2.4.1; whether this page's structure does needs checking with a screen reader.`,
      });
    } else {
      results.push({
        id: "bypass-blocks-mechanism",
        passed: false,
        description: "A mechanism must exist to bypass blocks of content repeated on multiple pages (WCAG SC 2.4.1).",
        detail: "No skip-navigation link, no landmark regions and no headings were found, so there is no mechanism to bypass repeated content.",
      });
    }

    results.push(await this.checkFocusVisible(page));

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

  /**
   * SC 2.4.7: the focused element must have a visible focus indicator.
   *
   * Detected by comparing the element's computed style focused against the
   * same element unfocused, rather than by looking for an outline. Modern
   * design systems suppress the outline and indicate focus with a box
   * shadow, a border, a background or an underline; checking only
   * `outlineStyle` and `boxShadow` failed all of them, and reported a hard
   * WCAG violation against pages that indicate focus perfectly well.
   */
  private async checkFocusVisible(page: Page): Promise<InteractionCheckResult> {
    let outcome: { determined: boolean; visible: boolean; changed: string[] } | null = null;
    try {
      await page.keyboard.press("Tab");
      outcome = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body || active === document.documentElement) {
          return { determined: false, visible: false, changed: [] as string[] };
        }

        const PROPERTIES = [
          "outlineStyle",
          "outlineWidth",
          "outlineColor",
          "outlineOffset",
          "boxShadow",
          "borderColor",
          "borderWidth",
          "backgroundColor",
          "backgroundImage",
          "color",
          "textDecorationLine",
          "textDecorationColor",
          "filter",
        ] as const;

        const snapshot = (el: HTMLElement) => {
          const style = window.getComputedStyle(el);
          return Object.fromEntries(PROPERTIES.map((property) => [property, style[property]])) as Record<string, string>;
        };

        const focused = snapshot(active);
        active.blur();
        const blurred = snapshot(active);
        // Leave the page as it was found.
        active.focus();

        // An outline that is never drawn cannot indicate anything. Chromium
        // still reports a different `outline-offset` for a focused element
        // whose outline is suppressed, which would otherwise read as a focus
        // indicator on a page that has none.
        const outlineDrawn = (snap: Record<string, string>) =>
          snap.outlineStyle !== "none" && snap.outlineWidth !== "0px";
        const outlineIsInert = !outlineDrawn(focused) && !outlineDrawn(blurred);
        const OUTLINE_PROPERTIES = ["outlineStyle", "outlineWidth", "outlineColor", "outlineOffset"];

        const changed = PROPERTIES.filter((property) => {
          if (focused[property] === blurred[property]) return false;
          if (outlineIsInert && OUTLINE_PROPERTIES.includes(property)) return false;
          return true;
        });
        return { determined: true, visible: changed.length > 0, changed: changed.slice() };
      });
    } catch {
      outcome = null;
    }

    if (outcome === null) {
      return {
        id: "focus-visible-indicator",
        passed: null,
        description: "The first focusable element after Tab should have a visible focus indicator.",
        detail: "Could not be determined automatically in this environment.",
      };
    }
    if (!outcome.determined) {
      // Nothing took focus, so there is no indicator to look for. That is a
      // different observation from "the indicator is missing".
      return {
        id: "focus-visible-indicator",
        passed: null,
        description: "The first focusable element after Tab should have a visible focus indicator.",
        detail: "Pressing Tab moved focus to no element, so no focus indicator could be observed on this page.",
      };
    }
    return {
      id: "focus-visible-indicator",
      passed: outcome.visible,
      description: "The first focusable element after Tab should have a visible focus indicator.",
      detail: outcome.visible
        ? `Focus changes the element's ${outcome.changed.join(", ")}.`
        : "The first focusable element renders identically focused and unfocused: no outline, shadow, border, background, colour or underline change was observed.",
    };
  }
}
