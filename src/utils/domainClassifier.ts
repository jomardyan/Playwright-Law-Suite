/**
 * Domain -> category classification for the third-party inventory.
 *
 * Two accuracy concerns drive the shape of this file:
 *
 * 1. *Is this even a third party?* A request from `www.example.com` to
 *    `cdn.example.com` is first-party. Comparing hostnames literally, as an
 *    earlier version did, reported a site's own CDN, API and media subdomains
 *    as external recipients of personal data - noise that buries the real
 *    ones. `isSameSite()` compares registrable domains instead.
 * 2. *What is it?* An unrecognised domain is reported as
 *    `unknown-third-party` rather than dropped, so nothing disappears; but a
 *    tracker the map does not know is a tracker a consent rule cannot flag.
 *    The inventory below is therefore kept broad, and organised by category
 *    rather than by vendor.
 *
 * Nothing here is a legal judgement. A category says what a service is
 * commonly used for; whether its use on a given site is lawful is a question
 * for the pack that consumes it, and ultimately for a person.
 */

/**
 * Multi-label public suffixes needed to compute a registrable domain.
 *
 * This is deliberately not the full Public Suffix List: shipping and
 * refreshing ~10k entries is a dependency this scanner does not need. It
 * covers the multi-label suffixes that actually appear in web traffic, and
 * anything not listed falls back to the last two labels - the correct answer
 * for every single-label suffix (.com, .de, .io, ...), which is the vast
 * majority of hosts.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  // Commonwealth-style second-level hierarchies.
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "sch.uk", "ac.uk", "gov.uk", "nhs.uk", "police.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au",
  "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz",
  "com.br", "net.br", "org.br", "gov.br", "edu.br",
  "com.mx", "org.mx", "gob.mx",
  "com.ar", "org.ar", "gob.ar",
  "co.za", "org.za", "net.za", "gov.za", "ac.za", "web.za",
  "co.in", "net.in", "org.in", "gov.in", "ac.in", "edu.in", "firm.in", "gen.in", "ind.in",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp", "ad.jp", "ed.jp", "gr.jp", "lg.jp",
  "co.kr", "or.kr", "ne.kr", "re.kr", "go.kr", "ac.kr", "pe.kr",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  "com.hk", "org.hk", "net.hk", "edu.hk", "gov.hk", "idv.hk",
  "com.tw", "org.tw", "net.tw", "gov.tw", "edu.tw",
  "com.sg", "net.sg", "org.sg", "edu.sg", "gov.sg",
  "com.my", "net.my", "org.my", "gov.my", "edu.my",
  "co.th", "in.th", "go.th", "ac.th", "or.th",
  "co.id", "or.id", "web.id", "ac.id", "go.id",
  "com.ph", "net.ph", "org.ph", "gov.ph",
  "com.vn", "net.vn", "org.vn", "gov.vn", "edu.vn",
  "com.sa", "net.sa", "org.sa", "gov.sa", "edu.sa",
  "com.ng", "net.ng", "org.ng", "gov.ng", "edu.ng",
  "com.eg", "net.eg", "org.eg", "gov.eg", "edu.eg",
  "com.tr", "net.tr", "org.tr", "gov.tr", "edu.tr",
  "com.pk", "net.pk", "org.pk", "gov.pk", "edu.pk",
  "com.ua", "net.ua", "org.ua", "gov.ua", "in.ua", "kiev.ua",
  "com.ru", "net.ru", "org.ru", "msk.ru", "spb.ru",
  // European second-level hierarchies still in common use.
  "co.il", "org.il", "net.il", "ac.il", "gov.il",
  "com.pl", "net.pl", "org.pl", "gov.pl", "edu.pl", "waw.pl",
  "com.es", "org.es", "nom.es", "gob.es", "edu.es",
  "com.pt", "org.pt", "gov.pt", "edu.pt",
  "com.gr", "net.gr", "org.gr", "gov.gr", "edu.gr",
  "com.cy", "org.cy", "gov.cy",
  "com.hr", "com.mt", "com.ro", "com.ee", "com.lv", "co.at", "or.at", "priv.at",
  "co.hu", "com.de", "com.se",
  // Hosting suffixes where each subdomain is a separate site.
  "github.io", "gitlab.io", "netlify.app", "vercel.app", "pages.dev", "workers.dev",
  "herokuapp.com", "azurewebsites.net", "cloudfunctions.net", "web.app", "firebaseapp.com",
  "s3.amazonaws.com", "myshopify.com", "wordpress.com", "blogspot.com", "wixsite.com",
  "squarespace.com", "webflow.io", "surge.sh", "onrender.com", "fly.dev", "glitch.me",
]);

/**
 * The categories a pack may treat as non-essential tracking - processing a
 * visitor has to opt into under a prior-consent regime.
 *
 * Deliberately excluded: `cdn`, `payment`, `captcha`, `monitoring`, `chat`,
 * `maps`, `consent-management` and `unknown-third-party`. Each of those can
 * be strictly necessary for a service the visitor asked for, or cannot be
 * classified confidently enough to assert a breach. `tag-manager` and
 * `embedded-video` are also excluded: a container script or a video embed is
 * frequently loaded in a consent-aware mode, so pre-consent loading is a
 * question for a person rather than an automated verdict. They remain in the
 * inventory, and rules can reason about them explicitly.
 */
export const NON_ESSENTIAL_TRACKING_CATEGORIES: ReadonlySet<string> = new Set([
  "analytics",
  "advertising",
  "session-recording",
  "marketing-automation",
  "ab-testing",
  "fingerprinting",
  "social-plugin",
  "data-broker",
]);

/** True when `category` is one no prior-consent regime lets you load unasked. */
export function isNonEssentialTrackingCategory(category: string): boolean {
  return NON_ESSENTIAL_TRACKING_CATEGORIES.has(category);
}

/**
 * Static host -> category map. Patterns are tested against the full hostname,
 * most specific first, so `ads.linkedin.com` is advertising while
 * `linkedin.com` on its own is a social plugin.
 */
const DOMAIN_CATEGORY_MAP: Array<{ pattern: RegExp; category: string; service: string }> = [
  // --- Consent management. Listed first: a CMP host is never a tracker, and
  // several CMPs sit on domains that would otherwise look generic. ---
  { pattern: /(^|\.)cookiebot\.com$/, category: "consent-management", service: "Cookiebot" },
  { pattern: /(^|\.)onetrust\.com$/, category: "consent-management", service: "OneTrust" },
  { pattern: /(^|\.)cookielaw\.org$/, category: "consent-management", service: "OneTrust" },
  { pattern: /(^|\.)trustarc\.com$/, category: "consent-management", service: "TrustArc" },
  { pattern: /(^|\.)truste\.com$/, category: "consent-management", service: "TrustArc" },
  { pattern: /(^|\.)usercentrics\.(eu|com)$/, category: "consent-management", service: "Usercentrics" },
  { pattern: /(^|\.)cookieyes\.com$/, category: "consent-management", service: "CookieYes" },
  { pattern: /(^|\.)iubenda\.com$/, category: "consent-management", service: "iubenda" },
  { pattern: /(^|\.)didomi\.io$/, category: "consent-management", service: "Didomi" },
  { pattern: /(^|\.)quantcast\.(com|mgr\.consensu\.org)$/, category: "consent-management", service: "Quantcast Choice" },
  { pattern: /(^|\.)termly\.io$/, category: "consent-management", service: "Termly" },
  { pattern: /(^|\.)osano\.com$/, category: "consent-management", service: "Osano" },
  { pattern: /(^|\.)axept\.io$/, category: "consent-management", service: "Axeptio" },
  { pattern: /(^|\.)sp-prod\.net$/, category: "consent-management", service: "Sourcepoint" },
  { pattern: /(^|\.)consensu\.org$/, category: "consent-management", service: "IAB TCF vendor" },
  { pattern: /(^|\.)complianz\.io$/, category: "consent-management", service: "Complianz" },

  // --- Analytics ---
  { pattern: /(^|\.)google-analytics\.com$/, category: "analytics", service: "Google Analytics" },
  { pattern: /(^|\.)analytics\.google\.com$/, category: "analytics", service: "Google Analytics 4" },
  { pattern: /(^|\.)segment\.(com|io)$/, category: "analytics", service: "Segment" },
  { pattern: /(^|\.)mixpanel\.com$/, category: "analytics", service: "Mixpanel" },
  { pattern: /(^|\.)amplitude\.com$/, category: "analytics", service: "Amplitude" },
  { pattern: /(^|\.)heap(analytics)?\.io$/, category: "analytics", service: "Heap" },
  { pattern: /(^|\.)matomo\.(cloud|org)$/, category: "analytics", service: "Matomo" },
  { pattern: /(^|\.)plausible\.io$/, category: "analytics", service: "Plausible" },
  { pattern: /(^|\.)simpleanalytics(cdn)?\.com$/, category: "analytics", service: "Simple Analytics" },
  { pattern: /(^|\.)fathom\.(dns|com)$/, category: "analytics", service: "Fathom Analytics" },
  { pattern: /(^|\.)statcounter\.com$/, category: "analytics", service: "StatCounter" },
  { pattern: /(^|\.)chartbeat\.(com|net)$/, category: "analytics", service: "Chartbeat" },
  { pattern: /(^|\.)scorecardresearch\.com$/, category: "analytics", service: "Comscore" },
  { pattern: /(^|\.)comscore\.com$/, category: "analytics", service: "Comscore" },
  { pattern: /(^|\.)quantserve\.com$/, category: "analytics", service: "Quantcast Measure" },
  { pattern: /(^|\.)kissmetrics\.(com|io)$/, category: "analytics", service: "Kissmetrics" },
  { pattern: /(^|\.)mc\.yandex\.(ru|com)$/, category: "analytics", service: "Yandex Metrica" },
  { pattern: /(^|\.)hs-analytics\.net$/, category: "analytics", service: "HubSpot Analytics" },
  { pattern: /(^|\.)pendo\.io$/, category: "analytics", service: "Pendo" },
  { pattern: /(^|\.)posthog\.com$/, category: "analytics", service: "PostHog" },
  { pattern: /(^|\.)countly\.com$/, category: "analytics", service: "Countly" },
  { pattern: /(^|\.)piwik\.pro$/, category: "analytics", service: "Piwik PRO" },
  { pattern: /(^|\.)adobedtm\.com$/, category: "analytics", service: "Adobe Experience Cloud" },
  { pattern: /(^|\.)omtrdc\.net$/, category: "analytics", service: "Adobe Analytics" },
  { pattern: /(^|\.)demdex\.net$/, category: "advertising", service: "Adobe Audience Manager" },
  { pattern: /(^|\.)2o7\.net$/, category: "analytics", service: "Adobe Analytics (legacy)" },

  // --- Tag management ---
  { pattern: /(^|\.)googletagmanager\.com$/, category: "tag-manager", service: "Google Tag Manager" },
  { pattern: /(^|\.)tealiumiq\.com$/, category: "tag-manager", service: "Tealium" },
  { pattern: /(^|\.)ensighten\.com$/, category: "tag-manager", service: "Ensighten" },
  { pattern: /(^|\.)segment\.io$/, category: "tag-manager", service: "Segment" },

  // --- Advertising / ad tech ---
  { pattern: /(^|\.)doubleclick\.net$/, category: "advertising", service: "Google Ads / DoubleClick" },
  { pattern: /(^|\.)googlesyndication\.com$/, category: "advertising", service: "Google AdSense" },
  { pattern: /(^|\.)googleadservices\.com$/, category: "advertising", service: "Google Ads conversion" },
  { pattern: /(^|\.)adservice\.google\.[a-z.]+$/, category: "advertising", service: "Google Ads" },
  { pattern: /(^|\.)ads\.linkedin\.com$/, category: "advertising", service: "LinkedIn Ads" },
  { pattern: /(^|\.)snap\.licdn\.com$/, category: "advertising", service: "LinkedIn Insight Tag" },
  { pattern: /(^|\.)px\.ads\.linkedin\.com$/, category: "advertising", service: "LinkedIn Ads" },
  { pattern: /(^|\.)analytics\.tiktok\.com$/, category: "advertising", service: "TikTok Pixel" },
  { pattern: /(^|\.)ads-api\.tiktok\.com$/, category: "advertising", service: "TikTok Ads" },
  { pattern: /(^|\.)facebook\.net$/, category: "advertising", service: "Meta Pixel" },
  { pattern: /(^|\.)bat\.bing\.com$/, category: "advertising", service: "Microsoft UET tag" },
  { pattern: /(^|\.)ads\.microsoft\.com$/, category: "advertising", service: "Microsoft Advertising" },
  { pattern: /(^|\.)criteo\.(com|net)$/, category: "advertising", service: "Criteo" },
  { pattern: /(^|\.)taboola\.com$/, category: "advertising", service: "Taboola" },
  { pattern: /(^|\.)outbrain\.com$/, category: "advertising", service: "Outbrain" },
  { pattern: /(^|\.)adroll\.com$/, category: "advertising", service: "AdRoll" },
  { pattern: /(^|\.)adnxs\.(com|net)$/, category: "advertising", service: "Xandr / AppNexus" },
  { pattern: /(^|\.)rubiconproject\.com$/, category: "advertising", service: "Magnite / Rubicon" },
  { pattern: /(^|\.)pubmatic\.com$/, category: "advertising", service: "PubMatic" },
  { pattern: /(^|\.)openx\.net$/, category: "advertising", service: "OpenX" },
  { pattern: /(^|\.)casalemedia\.com$/, category: "advertising", service: "Index Exchange" },
  { pattern: /(^|\.)33across\.com$/, category: "advertising", service: "33Across" },
  { pattern: /(^|\.)sharethrough\.com$/, category: "advertising", service: "Sharethrough" },
  { pattern: /(^|\.)smartadserver\.com$/, category: "advertising", service: "Equativ / Smart AdServer" },
  { pattern: /(^|\.)teads\.tv$/, category: "advertising", service: "Teads" },
  { pattern: /(^|\.)amazon-adsystem\.com$/, category: "advertising", service: "Amazon Advertising" },
  { pattern: /(^|\.)ads\.pinterest\.com$/, category: "advertising", service: "Pinterest Ads" },
  { pattern: /(^|\.)ct\.pinterest\.com$/, category: "advertising", service: "Pinterest Tag" },
  { pattern: /(^|\.)sc-static\.net$/, category: "advertising", service: "Snap Pixel" },
  { pattern: /(^|\.)tr\.snapchat\.com$/, category: "advertising", service: "Snap Pixel" },
  { pattern: /(^|\.)ads-twitter\.com$/, category: "advertising", service: "X (Twitter) Ads" },
  { pattern: /(^|\.)analytics\.twitter\.com$/, category: "advertising", service: "X (Twitter) Ads" },
  { pattern: /(^|\.)t\.co$/, category: "advertising", service: "X (Twitter) link tracking" },
  { pattern: /(^|\.)redditstatic\.com$/, category: "advertising", service: "Reddit Pixel" },
  { pattern: /(^|\.)alexametrics\.com$/, category: "advertising", service: "Alexa Metrics" },
  { pattern: /(^|\.)an\.yandex\.ru$/, category: "advertising", service: "Yandex Ads" },
  { pattern: /(^|\.)vk\.com$/, category: "advertising", service: "VK Pixel" },
  { pattern: /(^|\.)impact-ad\.jp$/, category: "advertising", service: "Impact Ad" },
  { pattern: /(^|\.)everesttech\.net$/, category: "advertising", service: "Adobe Advertising Cloud" },

  // --- Data brokers / identity resolution ---
  { pattern: /(^|\.)liveramp\.com$/, category: "data-broker", service: "LiveRamp" },
  { pattern: /(^|\.)rlcdn\.com$/, category: "data-broker", service: "LiveRamp" },
  { pattern: /(^|\.)bluekai\.com$/, category: "data-broker", service: "Oracle BlueKai" },
  { pattern: /(^|\.)crwdcntrl\.net$/, category: "data-broker", service: "Lotame" },
  { pattern: /(^|\.)id5-sync\.com$/, category: "data-broker", service: "ID5" },
  { pattern: /(^|\.)tapad\.com$/, category: "data-broker", service: "Tapad" },
  { pattern: /(^|\.)agkn\.com$/, category: "data-broker", service: "Neustar / TransUnion" },

  // --- Session recording / behavioural replay ---
  { pattern: /(^|\.)hotjar\.(com|io)$/, category: "session-recording", service: "Hotjar" },
  { pattern: /(^|\.)fullstory\.com$/, category: "session-recording", service: "FullStory" },
  { pattern: /(^|\.)clarity\.ms$/, category: "session-recording", service: "Microsoft Clarity" },
  { pattern: /(^|\.)mouseflow\.com$/, category: "session-recording", service: "Mouseflow" },
  { pattern: /(^|\.)smartlook\.(com|cloud)$/, category: "session-recording", service: "Smartlook" },
  { pattern: /(^|\.)luckyorange\.(com|net)$/, category: "session-recording", service: "Lucky Orange" },
  { pattern: /(^|\.)inspectlet\.com$/, category: "session-recording", service: "Inspectlet" },
  { pattern: /(^|\.)logrocket\.(com|io)$/, category: "session-recording", service: "LogRocket" },
  { pattern: /(^|\.)contentsquare\.net$/, category: "session-recording", service: "Contentsquare" },
  { pattern: /(^|\.)decibelinsight\.net$/, category: "session-recording", service: "Medallia Decibel" },
  { pattern: /(^|\.)quantummetric\.com$/, category: "session-recording", service: "Quantum Metric" },
  { pattern: /(^|\.)crazyegg\.com$/, category: "session-recording", service: "Crazy Egg" },
  { pattern: /(^|\.)glassboxdigital\.io$/, category: "session-recording", service: "Glassbox" },

  // --- A/B testing and personalisation ---
  { pattern: /(^|\.)optimizely\.com$/, category: "ab-testing", service: "Optimizely" },
  { pattern: /(^|\.)visualwebsiteoptimizer\.com$/, category: "ab-testing", service: "VWO" },
  { pattern: /(^|\.)abtasty\.com$/, category: "ab-testing", service: "AB Tasty" },
  { pattern: /(^|\.)dynamicyield\.com$/, category: "ab-testing", service: "Dynamic Yield" },
  { pattern: /(^|\.)kameleoon\.(com|eu)$/, category: "ab-testing", service: "Kameleoon" },
  { pattern: /(^|\.)convertexperiments\.com$/, category: "ab-testing", service: "Convert" },
  { pattern: /(^|\.)omappapi\.com$/, category: "ab-testing", service: "OptinMonster" },

  // --- Marketing automation / lifecycle messaging ---
  { pattern: /(^|\.)klaviyo\.com$/, category: "marketing-automation", service: "Klaviyo" },
  { pattern: /(^|\.)list-manage\.com$/, category: "marketing-automation", service: "Mailchimp" },
  { pattern: /(^|\.)braze\.(com|eu)$/, category: "marketing-automation", service: "Braze" },
  { pattern: /(^|\.)iterable\.com$/, category: "marketing-automation", service: "Iterable" },
  { pattern: /(^|\.)marketo\.(com|net)$/, category: "marketing-automation", service: "Adobe Marketo" },
  { pattern: /(^|\.)mktoresp\.com$/, category: "marketing-automation", service: "Adobe Marketo" },
  { pattern: /(^|\.)pardot\.com$/, category: "marketing-automation", service: "Salesforce Pardot" },
  { pattern: /(^|\.)hs-scripts\.com$/, category: "marketing-automation", service: "HubSpot" },
  { pattern: /(^|\.)hubspot\.com$/, category: "marketing-automation", service: "HubSpot" },
  { pattern: /(^|\.)activecampaign\.com$/, category: "marketing-automation", service: "ActiveCampaign" },
  { pattern: /(^|\.)sendinblue\.com$/, category: "marketing-automation", service: "Brevo" },
  { pattern: /(^|\.)customer\.io$/, category: "marketing-automation", service: "Customer.io" },
  { pattern: /(^|\.)drip\.com$/, category: "marketing-automation", service: "Drip" },

  // --- Fingerprinting / anti-fraud device identification ---
  { pattern: /(^|\.)fpjs\.io$/, category: "fingerprinting", service: "FingerprintJS" },
  { pattern: /(^|\.)fingerprint\.com$/, category: "fingerprinting", service: "FingerprintJS" },
  { pattern: /(^|\.)iovation\.com$/, category: "fingerprinting", service: "TransUnion iovation" },
  { pattern: /(^|\.)threatmetrix\.com$/, category: "fingerprinting", service: "LexisNexis ThreatMetrix" },
  { pattern: /(^|\.)sift\.com$/, category: "fingerprinting", service: "Sift" },

  // --- Social plugins and embeds ---
  { pattern: /(^|\.)facebook\.com$/, category: "social-plugin", service: "Meta / Facebook" },
  { pattern: /(^|\.)instagram\.com$/, category: "social-plugin", service: "Instagram" },
  { pattern: /(^|\.)linkedin\.com$/, category: "social-plugin", service: "LinkedIn" },
  { pattern: /(^|\.)twitter\.com$/, category: "social-plugin", service: "X (Twitter)" },
  { pattern: /(^|\.)x\.com$/, category: "social-plugin", service: "X (Twitter)" },
  { pattern: /(^|\.)pinterest\.com$/, category: "social-plugin", service: "Pinterest" },
  { pattern: /(^|\.)addthis\.com$/, category: "social-plugin", service: "AddThis" },
  { pattern: /(^|\.)sharethis\.com$/, category: "social-plugin", service: "ShareThis" },
  { pattern: /(^|\.)disqus\.com$/, category: "social-plugin", service: "Disqus" },
  { pattern: /(^|\.)tiktok\.com$/, category: "social-plugin", service: "TikTok" },

  // --- Embedded video ---
  { pattern: /(^|\.)youtube(-nocookie)?\.com$/, category: "embedded-video", service: "YouTube" },
  { pattern: /(^|\.)ytimg\.com$/, category: "embedded-video", service: "YouTube" },
  { pattern: /(^|\.)vimeo(cdn)?\.com$/, category: "embedded-video", service: "Vimeo" },
  { pattern: /(^|\.)wistia\.(com|net)$/, category: "embedded-video", service: "Wistia" },
  { pattern: /(^|\.)brightcove\.(com|net)$/, category: "embedded-video", service: "Brightcove" },
  { pattern: /(^|\.)jwplayer\.com$/, category: "embedded-video", service: "JW Player" },
  { pattern: /(^|\.)dailymotion\.com$/, category: "embedded-video", service: "Dailymotion" },
  { pattern: /(^|\.)soundcloud\.com$/, category: "embedded-video", service: "SoundCloud" },
  { pattern: /(^|\.)spotify\.com$/, category: "embedded-video", service: "Spotify" },

  // --- Payment ---
  { pattern: /(^|\.)stripe\.(com|network)$/, category: "payment", service: "Stripe" },
  { pattern: /(^|\.)paypal\.com$/, category: "payment", service: "PayPal" },
  { pattern: /(^|\.)paypalobjects\.com$/, category: "payment", service: "PayPal" },
  { pattern: /(^|\.)braintreegateway\.com$/, category: "payment", service: "Braintree" },
  { pattern: /(^|\.)adyen\.com$/, category: "payment", service: "Adyen" },
  { pattern: /(^|\.)klarna\.(com|net)$/, category: "payment", service: "Klarna" },
  { pattern: /(^|\.)checkout\.com$/, category: "payment", service: "Checkout.com" },
  { pattern: /(^|\.)mollie\.com$/, category: "payment", service: "Mollie" },
  { pattern: /(^|\.)worldpay\.com$/, category: "payment", service: "Worldpay" },
  { pattern: /(^|\.)squareup(cdn)?\.com$/, category: "payment", service: "Square" },
  { pattern: /(^|\.)afterpay\.com$/, category: "payment", service: "Afterpay" },
  { pattern: /(^|\.)applepay\.cdn-apple\.com$/, category: "payment", service: "Apple Pay" },

  // --- Delivery, hosting, fonts. Necessary infrastructure in most cases,
  //     but still a recipient of an IP address, so still inventoried. ---
  { pattern: /(^|\.)cloudflare(insights)?\.com$/, category: "cdn", service: "Cloudflare" },
  { pattern: /(^|\.)cloudfront\.net$/, category: "cdn", service: "Amazon CloudFront" },
  { pattern: /(^|\.)akamaized\.net$/, category: "cdn", service: "Akamai" },
  { pattern: /(^|\.)akamai(hd|edge)\.net$/, category: "cdn", service: "Akamai" },
  { pattern: /(^|\.)fastly(lb)?\.net$/, category: "cdn", service: "Fastly" },
  { pattern: /(^|\.)jsdelivr\.net$/, category: "cdn", service: "jsDelivr" },
  { pattern: /(^|\.)unpkg\.com$/, category: "cdn", service: "unpkg" },
  { pattern: /(^|\.)cdnjs\.cloudflare\.com$/, category: "cdn", service: "cdnjs" },
  { pattern: /(^|\.)bootstrapcdn\.com$/, category: "cdn", service: "BootstrapCDN" },
  { pattern: /(^|\.)gstatic\.com$/, category: "cdn", service: "Google static content" },
  { pattern: /(^|\.)fonts\.googleapis\.com$/, category: "font-provider", service: "Google Fonts" },
  { pattern: /(^|\.)fonts\.gstatic\.com$/, category: "font-provider", service: "Google Fonts" },
  { pattern: /(^|\.)use\.typekit\.net$/, category: "font-provider", service: "Adobe Fonts" },
  { pattern: /(^|\.)fontawesome\.com$/, category: "font-provider", service: "Font Awesome" },

  // --- Support chat / helpdesk ---
  { pattern: /(^|\.)intercom(cdn)?\.(io|com)$/, category: "chat", service: "Intercom" },
  { pattern: /(^|\.)zendesk\.com$/, category: "chat", service: "Zendesk" },
  { pattern: /(^|\.)zdassets\.com$/, category: "chat", service: "Zendesk" },
  { pattern: /(^|\.)crisp\.chat$/, category: "chat", service: "Crisp" },
  { pattern: /(^|\.)tawk\.to$/, category: "chat", service: "Tawk.to" },
  { pattern: /(^|\.)livechatinc\.com$/, category: "chat", service: "LiveChat" },
  { pattern: /(^|\.)drift\.com$/, category: "chat", service: "Drift" },
  { pattern: /(^|\.)tidio(chat)?\.(com|co)$/, category: "chat", service: "Tidio" },
  { pattern: /(^|\.)freshchat\.com$/, category: "chat", service: "Freshchat" },

  // --- CRM ---
  { pattern: /(^|\.)salesforce\.com$/, category: "crm", service: "Salesforce" },
  { pattern: /(^|\.)force\.com$/, category: "crm", service: "Salesforce" },
  { pattern: /(^|\.)dynamics\.com$/, category: "crm", service: "Microsoft Dynamics" },

  // --- Bot protection ---
  { pattern: /(^|\.)recaptcha\.net$/, category: "captcha", service: "Google reCAPTCHA" },
  { pattern: /(^|\.)hcaptcha\.com$/, category: "captcha", service: "hCaptcha" },
  { pattern: /(^|\.)turnstile\.cloudflare\.com$/, category: "captcha", service: "Cloudflare Turnstile" },
  { pattern: /(^|\.)arkoselabs\.com$/, category: "captcha", service: "Arkose Labs" },
  { pattern: /(^|\.)perimeterx\.net$/, category: "captcha", service: "HUMAN / PerimeterX" },
  { pattern: /(^|\.)datadome\.co$/, category: "captcha", service: "DataDome" },

  // --- Maps ---
  { pattern: /(^|\.)maps\.googleapis\.com$/, category: "maps", service: "Google Maps" },
  { pattern: /(^|\.)maps\.google\.[a-z.]+$/, category: "maps", service: "Google Maps" },
  { pattern: /(^|\.)mapbox\.com$/, category: "maps", service: "Mapbox" },
  { pattern: /(^|\.)openstreetmap\.org$/, category: "maps", service: "OpenStreetMap" },
  { pattern: /(^|\.)here\.com$/, category: "maps", service: "HERE Maps" },

  // --- Error and performance monitoring ---
  { pattern: /(^|\.)sentry\.io$/, category: "monitoring", service: "Sentry" },
  { pattern: /(^|\.)ingest\.sentry\.io$/, category: "monitoring", service: "Sentry" },
  { pattern: /(^|\.)bugsnag\.com$/, category: "monitoring", service: "Bugsnag" },
  { pattern: /(^|\.)nr-data\.net$/, category: "monitoring", service: "New Relic" },
  { pattern: /(^|\.)newrelic\.com$/, category: "monitoring", service: "New Relic" },
  { pattern: /(^|\.)datadoghq(-browser-agent)?\.com$/, category: "monitoring", service: "Datadog" },
  { pattern: /(^|\.)browser-intake-datadoghq\.com$/, category: "monitoring", service: "Datadog RUM" },
  { pattern: /(^|\.)rollbar\.com$/, category: "monitoring", service: "Rollbar" },
  { pattern: /(^|\.)raygun\.io$/, category: "monitoring", service: "Raygun" },
  { pattern: /(^|\.)pingdom\.net$/, category: "monitoring", service: "Pingdom" },

  // --- Broad-surface hosts kept last, so a specific subdomain above wins ---
  { pattern: /(^|\.)googleapis\.com$/, category: "cdn", service: "Google APIs" },
  { pattern: /(^|\.)google\.com$/, category: "unknown-third-party", service: "Google (unclassified endpoint)" },
];

export interface DomainClassification {
  domain: string;
  category: string;
  service: string;
}

export function classifyDomain(domain: string): DomainClassification {
  const normalized = normalizeHost(domain);
  for (const entry of DOMAIN_CATEGORY_MAP) {
    if (entry.pattern.test(normalized)) {
      return { domain: normalized, category: entry.category, service: entry.service };
    }
  }
  return { domain: normalized, category: "unknown-third-party", service: normalized };
}

/** Lower-cases a hostname and strips a trailing root dot and any port. */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
}

/**
 * The registrable domain ("eTLD+1") of a hostname: `cdn.shop.example.co.uk`
 * -> `example.co.uk`. Returns the input for hostnames that have no dot, and
 * for IP addresses, which are their own site.
 */
export function getRegistrableDomain(host: string): string {
  const normalized = normalizeHost(host);
  if (normalized.length === 0) return normalized;
  // An IPv4/IPv6 literal is a site on its own; splitting it on dots is wrong.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":")) return normalized;

  const labels = normalized.split(".");
  if (labels.length <= 2) return normalized;

  // Longest known multi-label suffix wins, so `s3.amazonaws.com` beats
  // `amazonaws.com` for a bucket host.
  for (let take = Math.min(labels.length - 1, 4); take >= 2; take -= 1) {
    const candidate = labels.slice(-take).join(".");
    if (MULTI_LABEL_SUFFIXES.has(candidate)) {
      return labels.slice(-(take + 1)).join(".");
    }
  }
  return labels.slice(-2).join(".");
}

/**
 * True when two hostnames belong to the same site. Used to keep a site's own
 * subdomains out of the third-party inventory: `www.example.com` and
 * `cdn.example.com` are the same operator, and reporting the latter as an
 * external recipient of personal data is a false positive.
 */
export function isSameSite(hostA: string, hostB: string): boolean {
  if (!hostA || !hostB) return false;
  const a = normalizeHost(hostA);
  const b = normalizeHost(hostB);
  if (a === b) return true;
  return getRegistrableDomain(a) === getRegistrableDomain(b);
}

/**
 * Hostname of an http(s) URL, or `null` for anything else.
 *
 * `data:`, `blob:`, `about:` and extension URLs are not network requests to a
 * third party; an earlier version returned the whole URL string as a
 * "domain", which produced inventory entries like
 * `data:image/png;base64,iVBOR...` and inflated the recipient count in every
 * cross-border transfer finding.
 */
export function extractHttpHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return normalizeHost(parsed.hostname);
  } catch {
    return null;
  }
}

/** True when the URL is an http(s) request that can reach a third party. */
export function isNetworkUrl(url: string): boolean {
  return extractHttpHost(url) !== null;
}

export function extractDomain(url: string): string {
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return url;
  }
}
