import type { Page } from "playwright";
import { isSameSite } from "../../utils/domainClassifier.js";

export type PersonalDataCategory =
  | "name"
  | "email"
  | "phone"
  | "address"
  | "date-of-birth"
  | "identification-number"
  | "financial"
  | "payment"
  | "health"
  | "biometric"
  | "employment"
  | "location"
  | "credentials";

/**
 * `autocomplete` tokens are the highest-precision signal available: they are
 * a standardised vocabulary the developer chose deliberately, unlike a field
 * name, which is whatever the CMS generated. Checked before the name
 * heuristics for that reason.
 */
const AUTOCOMPLETE_CATEGORIES: Record<string, PersonalDataCategory> = {
  name: "name",
  "given-name": "name",
  "additional-name": "name",
  "family-name": "name",
  nickname: "name",
  "honorific-prefix": "name",
  "honorific-suffix": "name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "tel-country-code": "phone",
  "tel-area-code": "phone",
  "tel-local": "phone",
  "street-address": "address",
  "address-line1": "address",
  "address-line2": "address",
  "address-line3": "address",
  "address-level1": "address",
  "address-level2": "address",
  "address-level3": "address",
  "address-level4": "address",
  "postal-code": "address",
  country: "address",
  "country-name": "address",
  bday: "date-of-birth",
  "bday-day": "date-of-birth",
  "bday-month": "date-of-birth",
  "bday-year": "date-of-birth",
  "cc-number": "payment",
  "cc-name": "payment",
  "cc-exp": "payment",
  "cc-exp-month": "payment",
  "cc-exp-year": "payment",
  "cc-csc": "payment",
  "cc-type": "payment",
  "current-password": "credentials",
  "new-password": "credentials",
  username: "credentials",
  "one-time-code": "credentials",
  organization: "employment",
  "organization-title": "employment",
};

/**
 * Name/id/placeholder/label heuristics, tried in order.
 *
 * Negative lookarounds carry real weight here. `name` on its own matched
 * "company name", "product name", "file name" and "display name", so every
 * B2B contact form reported that it collects a person's name. The qualifiers
 * that make a "name" field non-personal are therefore excluded explicitly.
 */
const FIELD_PATTERNS: Array<{ category: PersonalDataCategory; pattern: RegExp }> = [
  { category: "credentials", pattern: /\b(password|passwd|pwd|passcode|otp|mfa[-_ ]?code)\b/i },
  { category: "payment", pattern: /\b(card[-_ ]?(number|holder|name)|cardnum|ccnum|cc[-_ ]?(num|number|exp|csc)|cvv|cvc|cid|expir(y|ation)|sort[-_ ]?code)\b/i },
  {
    category: "identification-number",
    pattern: /\b(ssn|social[-_ ]?security|passport|national[-_ ]?id|nino|tax[-_ ]?id|tin|vat[-_ ]?(id|number)|driver'?s?[-_ ]?licen[cs]e|id[-_ ]?card|personnummer|pesel|codice[-_ ]?fiscale|aadhaar|nric|cpf|cnpj)\b/i,
  },
  { category: "financial", pattern: /\b(iban|bic|swift|bank[-_ ]?account|account[-_ ]?number|routing[-_ ]?number|sort[-_ ]?code|salary|income|net[-_ ]?worth|credit[-_ ]?score)\b/i },
  { category: "health", pattern: /\b(health|medical|diagnosis|prescription|symptom|disability|blood[-_ ]?(type|group)|allerg(y|ies)|medication|patient)\b/i },
  { category: "biometric", pattern: /\b(biometric|fingerprint|face[-_ ]?(id|scan)|facial[-_ ]?recognition|retina|iris[-_ ]?scan|voice[-_ ]?print)\b/i },
  { category: "date-of-birth", pattern: /\b(dob|date[-_ ]?of[-_ ]?birth|birth[-_ ]?date|birthdate|birthday|geburtsdatum|date[-_ ]?de[-_ ]?naissance)\b/i },
  { category: "location", pattern: /\b(latitude|longitude|lat[-_ ]?lng|geo[-_ ]?location|current[-_ ]?location|coordinates|gps)\b/i },
  { category: "email", pattern: /\b(e[-_ ]?mail|email|correo|courriel)\b/i },
  { category: "phone", pattern: /\b(phone|mobile|tel(ephone)?|telefon|handy|portable|whatsapp)\b/i },
  {
    category: "address",
    pattern: /\b(street|address|addr|city|town|postal[-_ ]?code|post[-_ ]?code|zip(code)?|county|province|state|country|adresse|strasse|stra[sß]e|plz|ville|cap|cidade)\b/i,
  },
  { category: "employment", pattern: /\b(employer|job[-_ ]?title|occupation|company[-_ ]?role|department|position)\b/i },
  {
    category: "name",
    // Not a person's name when qualified by a thing: company, product, file,
    // brand, domain, event, user (a handle), display (a label).
    pattern: /(?<!\b(company|business|organi[sz]ation|org|product|file|brand|domain|host|event|project|team|pet|display|user|screen|nick|folder|album|store|shop)[-_ ]?)\b(first|last|full|given|family|sur|middle|christian)?[-_ ]?name\b|\b(vorname|nachname|nom|pr[ée]nom|apellido|cognome|voornaam|achternaam)\b/i,
  },
];

/**
 * Consent-checkbox wording, in the languages the shipped packs cover. A
 * checkbox is a consent control when its accessible name asks for agreement,
 * a subscription, or acceptance of terms - the label being the thing a
 * regulator reads.
 */
const CONSENT_LABEL_PATTERN =
  /\b(consent|agree|accept|opt[-\s]?in|subscribe|newsletter|marketing|updates|offers|promotion|mailing\s+list|terms|privacy|gdpr|permission)\b|einwillig|zustimm|akzeptier|einverstanden|newsletter|abonnieren|j.accepte|accepte[rz]?\b|consentement|abonner|acepto|acepta[rn]?\b|consentimiento|suscrib|aceito|consinto|accetto|acconsento|iscriv|akkoord|toestemming|abonneer|zgadzam|akceptuj|zgoda|newslettera|godkänner|prenumerer|samtykke|hyväksyn|tilaa/i;

/** Field names that mean the same thing when no label is available. */
const CONSENT_NAME_PATTERN =
  /\b(consent|agree|accept|optin|opt_in|opt-in|subscribe|newsletter|marketing|gdpr|terms|privacy|tos|eula|permission|mailing)\b/i;

export interface FormFieldFinding {
  name: string;
  type: string;
  category: PersonalDataCategory | null;
  required: boolean;
  autocomplete: string | null;
  /**
   * True for `type="hidden"` fields and fields that are not rendered. A
   * hidden `email` field is usually plumbing (a honeypot, a CSRF token, a
   * prefilled tracking parameter), not a field the visitor fills in, so a
   * rule about "a form that collects personal data" should decide for itself
   * whether to count it.
   */
  hidden: boolean;
}

export interface ConsentCheckboxFinding {
  label: string;
  preChecked: boolean;
  purposeBundled: boolean;
  /** True when the control is not visible; a hidden pre-ticked box still counts. */
  hidden: boolean;
}

export interface FormRecord {
  formIndex: number;
  action: string | null;
  method: string | null;
  usesHttps: boolean;
  actionIsThirdParty: boolean;
  fields: FormFieldFinding[];
  consentCheckboxes: ConsentCheckboxFinding[];
  /**
   * `form` for a real `<form>` element; `page` for the synthetic record that
   * collects inputs which sit outside any form. Single-page applications
   * routinely submit through fetch() with no `<form>` at all, and scanning
   * only `<form>` elements missed those pages entirely.
   */
  scope: "form" | "page";
}

interface RawField {
  name: string;
  type: string;
  placeholder: string;
  required: boolean;
  autocomplete: string | null;
  checked: boolean;
  labelText: string;
  hidden: boolean;
}

interface RawForm {
  action: string | null;
  method: string | null;
  scope: "form" | "page";
  fields: RawField[];
}

function classifyField(field: Pick<RawField, "name" | "type" | "placeholder" | "labelText" | "autocomplete">): PersonalDataCategory | null {
  const autocompleteToken = (field.autocomplete ?? "")
    .toLowerCase()
    .split(/\s+/)
    // "shipping street-address" / "billing cc-number": the section and
    // address-type prefixes are not the token that names the field.
    .filter((token) => token.length > 0 && !["on", "off", "shipping", "billing", "section"].includes(token))
    .pop();
  if (autocompleteToken && AUTOCOMPLETE_CATEGORIES[autocompleteToken]) {
    return AUTOCOMPLETE_CATEGORIES[autocompleteToken];
  }

  // `type` is a weak but real signal: `<input type="email">` is an email
  // field whatever it is called.
  if (field.type === "email") return "email";
  if (field.type === "tel") return "phone";
  if (field.type === "password") return "credentials";

  const haystack = `${field.name} ${field.placeholder} ${field.labelText}`;
  for (const { category, pattern } of FIELD_PATTERNS) {
    if (pattern.test(haystack)) return category;
  }
  return null;
}

/**
 * Detects forms collecting personal data and inspects their consent /
 * transport hygiene: pre-checked or bundled consent boxes, non-HTTPS
 * submission, and third-party form processors.
 */
export class FormsScanner {
  async scan(page: Page): Promise<FormRecord[]> {
    const pageUrl = page.url();
    let pageHost = "";
    try {
      pageHost = new URL(pageUrl).hostname;
    } catch {
      pageHost = "";
    }

    const raw: RawForm[] = await page.evaluate(() => {
      /**
       * The control's accessible name, in the order a screen reader (and a
       * regulator reading the page) would resolve it.
       *
       * `label[for=...]` alone missed the most common consent markup of all -
       * `<label><input type="checkbox"> I agree ...</label>` - which left
       * every pre-ticked box in a wrapping label unlabelled and therefore
       * unrecognised as a consent control.
       */
      const accessibleName = (el: Element): string => {
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
            .trim();
          if (text) return text;
        }

        const labels = (el as HTMLInputElement).labels;
        if (labels && labels.length > 0) {
          const text = Array.from(labels)
            .map((label) => label.textContent ?? "")
            .join(" ")
            .trim();
          if (text) return text;
        }

        const wrapping = el.closest("label");
        if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();

        // Last resort, and only for tick boxes: the text of the element that
        // wraps the control, which is how a checkbox with no label element at
        // all is usually written. It is deliberately not used for text
        // inputs, where surrounding prose would contaminate the field
        // classification with words the field itself never contained.
        const type = (el as HTMLInputElement).type;
        if (type === "checkbox" || type === "radio") {
          return (el.parentElement?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
        }
        return "";
      };

      const isHidden = (el: Element): boolean => {
        const input = el as HTMLInputElement;
        if (input.type === "hidden") return true;
        if ((el as HTMLElement).hidden) return true;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return false;
        const style = window.getComputedStyle(el);
        return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
      };

      const describe = (el: Element) => ({
        name: el.getAttribute("name") ?? el.getAttribute("id") ?? "",
        type: (el as HTMLInputElement).type ?? el.tagName.toLowerCase(),
        placeholder: el.getAttribute("placeholder") ?? "",
        required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
        autocomplete: el.getAttribute("autocomplete"),
        checked: (el as HTMLInputElement).checked ?? false,
        labelText: accessibleName(el).replace(/\s+/g, " ").slice(0, 200),
        hidden: isHidden(el),
      });

      const CONTROL_SELECTOR = "input, select, textarea";
      const result: Array<{
        action: string | null;
        method: string | null;
        scope: "form" | "page";
        fields: ReturnType<typeof describe>[];
      }> = Array.from(document.querySelectorAll("form")).map((form) => ({
        action: form.getAttribute("action"),
        method: form.getAttribute("method"),
        scope: "form",
        fields: Array.from(form.querySelectorAll(CONTROL_SELECTOR)).map(describe),
      }));

      // Controls that belong to no form element. `input.form` is null for
      // those, and is also the correct answer for an input associated with a
      // remote form through the `form` attribute.
      const orphans = Array.from(document.querySelectorAll(CONTROL_SELECTOR)).filter(
        (el) => (el as HTMLInputElement).form === null
      );
      if (orphans.length > 0) {
        result.push({ action: null, method: null, scope: "page", fields: orphans.map(describe) });
      }
      return result;
    });

    return raw.map((form, formIndex) => {
      let actionUrl: URL | null = null;
      try {
        if (form.action) actionUrl = new URL(form.action, pageUrl);
      } catch {
        actionUrl = null;
      }

      const fields: FormFieldFinding[] = [];
      const consentCheckboxes: ConsentCheckboxFinding[] = [];

      for (const field of form.fields) {
        if (field.type === "checkbox") {
          const label = field.labelText || field.name;
          if (CONSENT_LABEL_PATTERN.test(label) || CONSENT_NAME_PATTERN.test(field.name)) {
            consentCheckboxes.push({
              label: label || "(unlabeled checkbox)",
              preChecked: field.checked,
              purposeBundled: isPurposeBundled(label),
              hidden: field.hidden,
            });
          }
          continue;
        }
        fields.push({
          name: field.name || "(unnamed)",
          type: field.type,
          category: classifyField(field),
          required: field.required,
          autocomplete: field.autocomplete,
          hidden: field.hidden,
        });
      }

      return {
        formIndex,
        action: form.action,
        method: form.method,
        usesHttps: actionUrl ? actionUrl.protocol === "https:" : pageUrl.startsWith("https:"),
        // A form posting to another subdomain of the same site is not a
        // third-party processor; comparing origins literally reported every
        // `api.example.com` endpoint as one.
        actionIsThirdParty: actionUrl ? !isSameSite(actionUrl.hostname, pageHost) : false,
        fields,
        consentCheckboxes,
        scope: form.scope,
      } satisfies FormRecord;
    });
  }
}

/**
 * True when one checkbox asks for two separable things at once - typically
 * the terms (which the contract needs) and marketing (which needs its own
 * freely given consent). Bundling them means neither is freely given.
 */
export function isPurposeBundled(label: string): boolean {
  const marketing = /\b(marketing|newsletter|promotion(al|s)?|offers|advertis|updates|mailing\s+list)\b|werbung|newsletter|marketing/i;
  const contractual = /\b(terms|conditions|privacy\s+policy|terms\s+of\s+(use|service)|contract|required)\b|agb|gesch[äa]ftsbedingungen|datenschutzerkl[äa]rung|conditions\s+g[ée]n[ée]rales/i;
  const conjunction = /\b(and|as\s+well\s+as|plus)\b|,|\+|&|\bund\b|\bet\b|\by\b|\be\b|\ben\b/i;
  return marketing.test(label) && contractual.test(label) && conjunction.test(label);
}
