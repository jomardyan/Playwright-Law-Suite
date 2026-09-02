import type { Page } from "playwright";

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

const FIELD_PATTERNS: Array<{ category: PersonalDataCategory; pattern: RegExp }> = [
  { category: "name", pattern: /\b(first|last|full)?[-_]?name\b/i },
  { category: "email", pattern: /email/i },
  { category: "phone", pattern: /phone|mobile|tel(ephone)?/i },
  { category: "address", pattern: /address|street|city|postal|zip/i },
  { category: "date-of-birth", pattern: /dob|date[-_]?of[-_]?birth|birthdate/i },
  { category: "identification-number", pattern: /ssn|passport|national[-_]?id|tax[-_]?id|social[-_]?security/i },
  { category: "financial", pattern: /iban|account[-_]?number|routing[-_]?number|salary|income/i },
  { category: "payment", pattern: /card[-_]?number|cvv|cvc|expir(y|ation)|payment/i },
  { category: "health", pattern: /health|medical|diagnosis|condition|prescription/i },
  { category: "biometric", pattern: /biometric|fingerprint|face[-_]?id|retina/i },
  { category: "employment", pattern: /employer|job[-_]?title|occupation|salary/i },
  { category: "location", pattern: /latitude|longitude|geo[-_]?location|current[-_]?location/i },
  { category: "credentials", pattern: /password|username|passcode/i },
];

export interface FormFieldFinding {
  name: string;
  type: string;
  category: PersonalDataCategory | null;
  required: boolean;
  autocomplete: string | null;
}

export interface ConsentCheckboxFinding {
  label: string;
  preChecked: boolean;
  purposeBundled: boolean;
}

export interface FormRecord {
  formIndex: number;
  action: string | null;
  method: string | null;
  usesHttps: boolean;
  actionIsThirdParty: boolean;
  fields: FormFieldFinding[];
  consentCheckboxes: ConsentCheckboxFinding[];
}

function classifyField(nameOrId: string, type: string, placeholder: string): PersonalDataCategory | null {
  const haystack = `${nameOrId} ${type} ${placeholder}`;
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
    const pageOrigin = new URL(page.url()).origin;

    const raw = await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll("form"));
      return forms.map((form) => ({
        action: form.getAttribute("action"),
        method: form.getAttribute("method"),
        fields: Array.from(form.querySelectorAll("input, select, textarea")).map((el) => ({
          name: el.getAttribute("name") ?? el.getAttribute("id") ?? "",
          type: (el as HTMLInputElement).type ?? el.tagName.toLowerCase(),
          placeholder: el.getAttribute("placeholder") ?? "",
          required: el.hasAttribute("required"),
          autocomplete: el.getAttribute("autocomplete"),
          checked: (el as HTMLInputElement).checked ?? false,
          labelText: (() => {
            const id = el.getAttribute("id");
            if (!id) return "";
            const label = document.querySelector(`label[for="${id}"]`);
            return label?.textContent ?? "";
          })(),
        })),
      }));
    });

    return raw.map((form, formIndex) => {
      let actionUrl: URL | null = null;
      try {
        if (form.action) actionUrl = new URL(form.action, page.url());
      } catch {
        actionUrl = null;
      }

      const fields: FormFieldFinding[] = [];
      const consentCheckboxes: ConsentCheckboxFinding[] = [];

      for (const field of form.fields) {
        if (field.type === "checkbox") {
          const label = field.labelText || field.name;
          if (/consent|agree|newsletter|marketing|subscribe|accept/i.test(label)) {
            consentCheckboxes.push({
              label: label || "(unlabeled checkbox)",
              preChecked: field.checked,
              purposeBundled: /and|,|\+/.test(label) && /marketing|newsletter/i.test(label) && /terms|privacy|required/i.test(label),
            });
          }
          continue;
        }
        fields.push({
          name: field.name || "(unnamed)",
          type: field.type,
          category: classifyField(field.name, field.type, field.placeholder),
          required: field.required,
          autocomplete: field.autocomplete,
        });
      }

      return {
        formIndex,
        action: form.action,
        method: form.method,
        usesHttps: actionUrl ? actionUrl.protocol === "https:" : page.url().startsWith("https:"),
        actionIsThirdParty: actionUrl ? actionUrl.origin !== pageOrigin : false,
        fields,
        consentCheckboxes,
      } satisfies FormRecord;
    });
  }
}
