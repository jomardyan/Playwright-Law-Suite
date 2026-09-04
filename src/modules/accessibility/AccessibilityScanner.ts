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
   * Two things make this hard to get right, and the previous version got both
   * wrong on real sites.
   *
   * *What counts as an indicator.* Looking for an outline or a box shadow
   * failed every design system that indicates focus some other way. It is
   * detected here by comparing the element's computed style focused against
   * the same element unfocused - including geometry, because the most common
   * pattern of all is a visually hidden skip link that moves into view on
   * focus. On bbc.co.uk and nytimes.com that link changes `left`, `top`,
   * `clip`, `width` and `height`, none of which were compared, so both sites
   * were reported as failing 2.4.7.
   *
   * *How much to look at.* One Tab press is not a page. On heise.de the first
   * Tab stop is an `<iframe>`, which has no focus style of its own and read
   * as "no indicator anywhere on this page". Several keyboard-reachable
   * elements are sampled, frames are skipped, and a failure is only reported
   * when none of the sampled elements indicates focus at all.
   */
  private async checkFocusVisible(page: Page): Promise<InteractionCheckResult> {
    const samples: Array<{ label: string; changed: string[] }> = [];
    const MAX_TAB_PRESSES = 12;
    const WANTED_SAMPLES = 5;

    try {
      for (let press = 0; press < MAX_TAB_PRESSES && samples.length < WANTED_SAMPLES; press += 1) {
        await page.keyboard.press("Tab");
        const sample = await page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          if (!active || active === document.body || active === document.documentElement) return null;
          // Focus inside a frame is styled by that frame's own document,
          // which this page cannot see. Sampling it would report the frame's
          // lack of style as the page's failure.
          const tag = active.tagName.toLowerCase();
          if (tag === "iframe" || tag === "frame" || tag === "object" || tag === "embed") return null;

          const PAINT = [
            "outlineStyle",
            "outlineWidth",
            "outlineColor",
            "outlineOffset",
            "boxShadow",
            "borderColor",
            "borderWidth",
            "borderStyle",
            "backgroundColor",
            "backgroundImage",
            "color",
            "textDecorationLine",
            "textDecorationColor",
            "textDecorationThickness",
            "filter",
            "opacity",
            "visibility",
          ] as const;
          // Geometry: a visually hidden control that becomes visible on focus
          // is indicating focus in the most emphatic way available.
          const GEOMETRY = ["left", "top", "right", "bottom", "clip", "clipPath", "transform", "width", "height", "overflow", "zIndex", "position"] as const;
          const PROPERTIES = [...PAINT, ...GEOMETRY];

          const snapshot = (el: HTMLElement) => {
            const style = window.getComputedStyle(el);
            return Object.fromEntries(PROPERTIES.map((property) => [property, style[property]])) as Record<string, string>;
          };

          const focused = snapshot(active);
          active.blur();
          const blurred = snapshot(active);
          active.focus();

          // An outline that is never drawn cannot indicate anything.
          // Chromium reports a different `outline-offset` for a focused
          // element whose outline is suppressed, which would otherwise read
          // as a focus indicator on a page that has none.
          const outlineDrawn = (snap: Record<string, string>) =>
            snap.outlineStyle !== "none" && snap.outlineWidth !== "0px";
          const outlineIsInert = !outlineDrawn(focused) && !outlineDrawn(blurred);
          const OUTLINE_PROPERTIES = new Set(["outlineStyle", "outlineWidth", "outlineColor", "outlineOffset"]);

          const changed = PROPERTIES.filter((property) => {
            if (focused[property] === blurred[property]) return false;
            if (outlineIsInert && OUTLINE_PROPERTIES.has(property)) return false;
            return true;
          });

          const label = `${tag}${active.id ? `#${active.id}` : ""}: ${(active.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || "(no text)"}`;
          return { label, changed: changed.slice() };
        });
        if (sample) samples.push(sample);
      }
    } catch {
      return {
        id: "focus-visible-indicator",
        passed: null,
        description: "Keyboard-focusable elements must have a visible focus indicator (WCAG SC 2.4.7).",
        detail: "Could not be determined automatically in this environment.",
      };
    }

    if (samples.length === 0) {
      return {
        id: "focus-visible-indicator",
        passed: null,
        description: "Keyboard-focusable elements must have a visible focus indicator (WCAG SC 2.4.7).",
        detail: `Pressing Tab ${MAX_TAB_PRESSES} times reached no element this check can inspect (a frame, or nothing focusable), so no focus indicator could be observed.`,
      };
    }

    const indicated = samples.filter((sample) => sample.changed.length > 0);
    if (indicated.length === samples.length) {
      return {
        id: "focus-visible-indicator",
        passed: true,
        description: "Keyboard-focusable elements must have a visible focus indicator (WCAG SC 2.4.7).",
        detail: `All ${samples.length} sampled focusable element(s) change appearance on focus, e.g. ${indicated[0].label} (${indicated[0].changed.slice(0, 4).join(", ")}).`,
      };
    }
    if (indicated.length === 0) {
      return {
        id: "focus-visible-indicator",
        passed: false,
        description: "Keyboard-focusable elements must have a visible focus indicator (WCAG SC 2.4.7).",
        detail: `None of the ${samples.length} sampled focusable element(s) render any differently focused than unfocused: ${samples
          .map((sample) => sample.label)
          .join("; ")}.`,
      };
    }
    // Some indicate and some do not. Which of the two the page as a whole
    // fails on depends on where the missing indicator is, so it is put to a
    // person rather than decided here.
    return {
      id: "focus-visible-indicator",
      passed: null,
      description: "Keyboard-focusable elements must have a visible focus indicator (WCAG SC 2.4.7).",
      detail: `${indicated.length} of ${samples.length} sampled focusable element(s) indicate focus; the rest do not: ${samples
        .filter((sample) => sample.changed.length === 0)
        .map((sample) => sample.label)
        .join("; ")}. Check those controls by keyboard.`,
    };
  }
}
