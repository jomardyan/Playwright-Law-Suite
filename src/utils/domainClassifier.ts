/**
 * Static domain -> category map covering common third-party services.
 * This is intentionally a starting inventory, not an exhaustive one: unknown
 * domains are classified as "unknown-third-party" rather than silently
 * dropped, so the report still surfaces them for manual review.
 */
const DOMAIN_CATEGORY_MAP: Array<{ pattern: RegExp; category: string; service: string }> = [
  { pattern: /(^|\.)google-analytics\.com$/, category: "analytics", service: "Google Analytics" },
  { pattern: /(^|\.)googletagmanager\.com$/, category: "tag-manager", service: "Google Tag Manager" },
  { pattern: /(^|\.)analytics\.google\.com$/, category: "analytics", service: "Google Analytics 4" },
  { pattern: /(^|\.)doubleclick\.net$/, category: "advertising", service: "Google Ads / DoubleClick" },
  { pattern: /(^|\.)googlesyndication\.com$/, category: "advertising", service: "Google AdSense" },
  { pattern: /(^|\.)facebook\.net$/, category: "advertising", service: "Meta Pixel" },
  { pattern: /(^|\.)connect\.facebook\.net$/, category: "advertising", service: "Meta Pixel" },
  { pattern: /(^|\.)facebook\.com$/, category: "social-plugin", service: "Meta / Facebook" },
  { pattern: /(^|\.)ads\.linkedin\.com$/, category: "advertising", service: "LinkedIn Ads" },
  { pattern: /(^|\.)analytics\.tiktok\.com$/, category: "advertising", service: "TikTok Pixel" },
  { pattern: /(^|\.)hotjar\.com$/, category: "session-recording", service: "Hotjar" },
  { pattern: /(^|\.)fullstory\.com$/, category: "session-recording", service: "FullStory" },
  { pattern: /(^|\.)clarity\.ms$/, category: "session-recording", service: "Microsoft Clarity" },
  { pattern: /(^|\.)stripe\.com$/, category: "payment", service: "Stripe" },
  { pattern: /(^|\.)paypal\.com$/, category: "payment", service: "PayPal" },
  { pattern: /(^|\.)braintreegateway\.com$/, category: "payment", service: "Braintree" },
  { pattern: /(^|\.)cloudflare\.com$/, category: "cdn", service: "Cloudflare" },
  { pattern: /(^|\.)cloudfront\.net$/, category: "cdn", service: "Amazon CloudFront" },
  { pattern: /(^|\.)akamaized\.net$/, category: "cdn", service: "Akamai" },
  { pattern: /(^|\.)intercom\.io$/, category: "chat", service: "Intercom" },
  { pattern: /(^|\.)zendesk\.com$/, category: "chat", service: "Zendesk" },
  { pattern: /(^|\.)crisp\.chat$/, category: "chat", service: "Crisp" },
  { pattern: /(^|\.)hubspot\.com$/, category: "crm", service: "HubSpot" },
  { pattern: /(^|\.)salesforce\.com$/, category: "crm", service: "Salesforce" },
  { pattern: /(^|\.)recaptcha\.net$/, category: "captcha", service: "Google reCAPTCHA" },
  { pattern: /(^|\.)hcaptcha\.com$/, category: "captcha", service: "hCaptcha" },
  { pattern: /(^|\.)maps\.googleapis\.com$/, category: "maps", service: "Google Maps" },
  { pattern: /(^|\.)youtube\.com$/, category: "embedded-video", service: "YouTube" },
  { pattern: /(^|\.)ytimg\.com$/, category: "embedded-video", service: "YouTube" },
  { pattern: /(^|\.)vimeo\.com$/, category: "embedded-video", service: "Vimeo" },
  { pattern: /(^|\.)cookiebot\.com$/, category: "consent-management", service: "Cookiebot" },
  { pattern: /(^|\.)onetrust\.com$/, category: "consent-management", service: "OneTrust" },
  { pattern: /(^|\.)trustarc\.com$/, category: "consent-management", service: "TrustArc" },
  { pattern: /(^|\.)sentry\.io$/, category: "monitoring", service: "Sentry" },
  { pattern: /(^|\.)segment\.com$/, category: "analytics", service: "Segment" },
  { pattern: /(^|\.)mixpanel\.com$/, category: "analytics", service: "Mixpanel" },
  { pattern: /(^|\.)amplitude\.com$/, category: "analytics", service: "Amplitude" },
];

export interface DomainClassification {
  domain: string;
  category: string;
  service: string;
}

export function classifyDomain(domain: string): DomainClassification {
  const normalized = domain.toLowerCase();
  for (const entry of DOMAIN_CATEGORY_MAP) {
    if (entry.pattern.test(normalized)) {
      return { domain: normalized, category: entry.category, service: entry.service };
    }
  }
  return { domain: normalized, category: "unknown-third-party", service: normalized };
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
