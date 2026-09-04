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


  // --- Programmatic advertising, SSPs, DSPs and exchanges ---
  //
  // Added from real scans: a run over 16 public sites left 412 of 613
  // third-party records as `unknown-third-party`, and sampling them showed
  // almost all were RTB infrastructure. A domain the map does not know is a
  // tracker no consent rule can flag, so the recurring ones are named here
  // and the tail is handled by `inferTrackingCategory`.
  { pattern: /(^|\.)360yield\.com$/, category: "advertising", service: "Improve Digital" },
  { pattern: /(^|\.)3lift\.com$/, category: "advertising", service: "TripleLift" },
  { pattern: /(^|\.)1rx\.io$/, category: "advertising", service: "RhythmOne" },
  { pattern: /(^|\.)a-mo\.net$/, category: "advertising", service: "Amobee" },
  { pattern: /(^|\.)adentifi\.com$/, category: "advertising", service: "AdTheorent" },
  { pattern: /(^|\.)adform\.net$/, category: "advertising", service: "Adform" },
  { pattern: /(^|\.)adgrx\.com$/, category: "advertising", service: "AdGear" },
  { pattern: /(^|\.)adingo\.jp$/, category: "advertising", service: "Fluct" },
  { pattern: /(^|\.)adition\.com$/, category: "advertising", service: "Adition" },
  { pattern: /(^|\.)adkernel\.com$/, category: "advertising", service: "AdKernel" },
  { pattern: /(^|\.)admanmedia\.com$/, category: "advertising", service: "AdMan Media" },
  { pattern: /(^|\.)admaster\.cc$/, category: "advertising", service: "AdMaster" },
  { pattern: /(^|\.)ad-stir\.com$/, category: "advertising", service: "AdStir" },
  { pattern: /(^|\.)adtdp\.com$/, category: "advertising", service: "AJA / adtdp" },
  { pattern: /(^|\.)adtech\.ink$/, category: "advertising", service: "AdTech.ink" },
  { pattern: /(^|\.)adtrafficquality\.google$/, category: "advertising", service: "Google Ad Traffic Quality" },
  { pattern: /(^|\.)adsrvr\.org$/, category: "advertising", service: "The Trade Desk" },
  { pattern: /(^|\.)advolve\.io$/, category: "advertising", service: "Advolve" },
  { pattern: /(^|\.)aniview\.com$/, category: "advertising", service: "Aniview" },
  { pattern: /(^|\.)appier\.net$/, category: "advertising", service: "Appier" },
  { pattern: /(^|\.)appnerve\.net$/, category: "advertising", service: "AppNerve" },
  { pattern: /(^|\.)aralego\.com$/, category: "advertising", service: "Aralego" },
  { pattern: /(^|\.)balance-x\.com$/, category: "advertising", service: "Balance-X" },
  { pattern: /(^|\.)bidr\.io$/, category: "advertising", service: "Beeswax" },
  { pattern: /(^|\.)bidswitch\.net$/, category: "advertising", service: "BidSwitch" },
  { pattern: /(^|\.)bidtheatre\.com$/, category: "advertising", service: "BidTheatre" },
  { pattern: /(^|\.)blismedia\.com$/, category: "advertising", service: "Blis" },
  { pattern: /(^|\.)bttrack\.com$/, category: "advertising", service: "Bidtellect" },
  { pattern: /(^|\.)caprofitx\.com$/, category: "advertising", service: "CA ProFit-X" },
  { pattern: /(^|\.)chocolateplatform\.com$/, category: "advertising", service: "Chocolate Platform" },
  { pattern: /(^|\.)connatix\.com$/, category: "advertising", service: "Connatix" },
  { pattern: /(^|\.)connectad\.io$/, category: "advertising", service: "ConnectAd" },
  { pattern: /(^|\.)contextweb\.com$/, category: "advertising", service: "PulsePoint" },
  { pattern: /(^|\.)copper6\.com$/, category: "advertising", service: "Copper6" },
  { pattern: /(^|\.)creative-serving\.com$/, category: "advertising", service: "Platform161" },
  { pattern: /(^|\.)creativecdn\.com$/, category: "advertising", service: "RTB House" },
  { pattern: /(^|\.)de17a\.com$/, category: "advertising", service: "Sift Media" },
  { pattern: /(^|\.)deepintent\.com$/, category: "advertising", service: "DeepIntent" },
  { pattern: /(^|\.)dotomi\.com$/, category: "advertising", service: "Conversant / Epsilon" },
  { pattern: /(^|\.)emxdgt\.com$/, category: "advertising", service: "EMX Digital" },
  { pattern: /(^|\.)ethicalads\.io$/, category: "advertising", service: "EthicalAds" },
  { pattern: /(^|\.)flvcdn\.net$/, category: "advertising", service: "Flashtalking" },
  { pattern: /(^|\.)fout\.jp$/, category: "advertising", service: "FOUT" },
  { pattern: /(^|\.)fwmrm\.net$/, category: "advertising", service: "FreeWheel" },
  { pattern: /(^|\.)gmossp-sp\.jp$/, category: "advertising", service: "GMO SSP" },
  { pattern: /(^|\.)gssprt\.jp$/, category: "advertising", service: "GenieeSSP" },
  { pattern: /(^|\.)gumgum\.com$/, category: "advertising", service: "GumGum" },
  { pattern: /(^|\.)indexww\.com$/, category: "advertising", service: "Index Exchange" },
  { pattern: /(^|\.)ingage\.tech$/, category: "advertising", service: "Ingage" },
  { pattern: /(^|\.)inmobi\.com$/, category: "advertising", service: "InMobi" },
  { pattern: /(^|\.)ipredictive\.com$/, category: "advertising", service: "Adelphic" },
  { pattern: /(^|\.)iprom\.net$/, category: "advertising", service: "iPROM" },
  { pattern: /(^|\.)iqm\.com$/, category: "advertising", service: "IQM" },
  { pattern: /(^|\.)iqzonertb\.live$/, category: "advertising", service: "IQzone" },
  { pattern: /(^|\.)kargo\.com$/, category: "advertising", service: "Kargo" },
  { pattern: /(^|\.)krushmedia\.com$/, category: "advertising", service: "Krush Media" },
  { pattern: /(^|\.)ladsp\.com$/, category: "advertising", service: "Logly" },
  { pattern: /(^|\.)liftdsp\.com$/, category: "advertising", service: "Lift DSP" },
  { pattern: /(^|\.)lijit\.com$/, category: "advertising", service: "Sovrn" },
  { pattern: /(^|\.)loopme\.me$/, category: "advertising", service: "LoopMe" },
  { pattern: /(^|\.)loudecho\.ai$/, category: "advertising", service: "LoudEcho" },
  { pattern: /(^|\.)mathtag\.com$/, category: "advertising", service: "MediaMath" },
  { pattern: /(^|\.)media\.net$/, category: "advertising", service: "Media.net" },
  { pattern: /(^|\.)mediago\.io$/, category: "advertising", service: "MediaGo" },
  { pattern: /(^|\.)mfadsrvr\.com$/, category: "advertising", service: "MobileFuse" },
  { pattern: /(^|\.)mgid\.com$/, category: "advertising", service: "MGID" },
  { pattern: /(^|\.)microad\.jp$/, category: "advertising", service: "MicroAd" },
  { pattern: /(^|\.)minutemedia-prebid\.com$/, category: "advertising", service: "Minute Media (Prebid)" },
  { pattern: /(^|\.)moloco\.com$/, category: "advertising", service: "Moloco" },
  { pattern: /(^|\.)mxptint\.net$/, category: "advertising", service: "MediaX" },
  { pattern: /(^|\.)nrich\.ai$/, category: "advertising", service: "nRich" },
  { pattern: /(^|\.)omnitagjs\.com$/, category: "advertising", service: "Adyoulike" },
  { pattern: /(^|\.)onetag-sys\.com$/, category: "advertising", service: "OneTag" },
  { pattern: /(^|\.)s-onetag\.com$/, category: "advertising", service: "OneTag" },
  { pattern: /(^|\.)openwebmp\.com$/, category: "advertising", service: "OpenWeb" },
  { pattern: /(^|\.)openxcdn\.net$/, category: "advertising", service: "OpenX" },
  { pattern: /(^|\.)p7cloud\.net$/, category: "advertising", service: "Platform One" },
  { pattern: /(^|\.)pa-cd\.com$/, category: "advertising", service: "Perion" },
  { pattern: /(^|\.)pangle-ads\.com$/, category: "advertising", service: "Pangle (ByteDance)" },
  { pattern: /(^|\.)pgammedia\.com$/, category: "advertising", service: "PGAM" },
  { pattern: /(^|\.)pmbmonetize\.live$/, category: "advertising", service: "PMB Monetize" },
  { pattern: /(^|\.)postrelease\.com$/, category: "advertising", service: "Nativo" },
  { pattern: /(^|\.)presage\.io$/, category: "advertising", service: "Ogury" },
  { pattern: /(^|\.)primis\.tech$/, category: "advertising", service: "Primis" },
  { pattern: /(^|\.)rbstsystems\.live$/, category: "advertising", service: "RBST Systems" },
  { pattern: /(^|\.)resetdigital\.co$/, category: "advertising", service: "Reset Digital" },
  { pattern: /(^|\.)rfihub\.com$/, category: "advertising", service: "Rocket Fuel / Criteo" },
  { pattern: /(^|\.)richaudience\.com$/, category: "advertising", service: "Rich Audience" },
  { pattern: /(^|\.)rtbsystem\.com$/, category: "advertising", service: "RTB System" },
  { pattern: /(^|\.)seedtag\.com$/, category: "advertising", service: "Seedtag" },
  { pattern: /(^|\.)simpli\.fi$/, category: "advertising", service: "Simpli.fi" },
  { pattern: /(^|\.)sitescout\.com$/, category: "advertising", service: "SiteScout" },
  { pattern: /(^|\.)slim02\.jp$/, category: "advertising", service: "Slim02" },
  { pattern: /(^|\.)smaato\.net$/, category: "advertising", service: "Smaato" },
  { pattern: /(^|\.)smilewanted\.com$/, category: "advertising", service: "SmileWanted" },
  { pattern: /(^|\.)socdm\.com$/, category: "advertising", service: "Supership / Ad Generation" },
  { pattern: /(^|\.)sonobi\.com$/, category: "advertising", service: "Sonobi" },
  { pattern: /(^|\.)spotxchange\.com$/, category: "advertising", service: "SpotX / Magnite" },
  { pattern: /(^|\.)springserve\.com$/, category: "advertising", service: "SpringServe" },
  { pattern: /(^|\.)stackadapt\.com$/, category: "advertising", service: "StackAdapt" },
  { pattern: /(^|\.)syncingbridge\.com$/, category: "advertising", service: "Syncing Bridge" },
  { pattern: /(^|\.)theagenticx\.ai$/, category: "advertising", service: "AgenticX" },
  { pattern: /(^|\.)tracookiepixel\.xyz$/, category: "advertising", service: "unnamed pixel service" },
  { pattern: /(^|\.)tremorhub\.com$/, category: "advertising", service: "Tremor / Nexxen" },
  { pattern: /(^|\.)tribalfusion\.com$/, category: "advertising", service: "Exponential" },
  { pattern: /(^|\.)turn\.com$/, category: "advertising", service: "Amobee" },
  { pattern: /(^|\.)uncn\.jp$/, category: "advertising", service: "Unicorn" },
  { pattern: /(^|\.)vistarsagency\.com$/, category: "advertising", service: "Vistars" },
  { pattern: /(^|\.)yieldlab\.net$/, category: "advertising", service: "Yieldlab" },
  { pattern: /(^|\.)yieldmo\.com$/, category: "advertising", service: "Yieldmo" },
  { pattern: /(^|\.)ymmobi\.com$/, category: "advertising", service: "YM Mobi" },
  { pattern: /(^|\.)zemanta\.com$/, category: "advertising", service: "Zemanta / Outbrain" },

  // --- Ad verification and viewability, which measure the same impression ---
  { pattern: /(^|\.)doubleverify\.com$/, category: "advertising", service: "DoubleVerify" },
  { pattern: /(^|\.)dv\.tech$/, category: "advertising", service: "DoubleVerify" },
  { pattern: /(^|\.)geoedge\.be$/, category: "advertising", service: "GeoEdge" },
  { pattern: /(^|\.)insurads\.com$/, category: "advertising", service: "InsurAds" },
  { pattern: /(^|\.)brandmetrics\.com$/, category: "advertising", service: "Brandmetrics" },
  { pattern: /(^|\.)webcontentassessor\.com$/, category: "advertising", service: "Web Content Assessor" },
  { pattern: /(^|\.)usbrowserspeed\.com$/, category: "fingerprinting", service: "Adloox" },

  // --- Identity resolution and data brokerage ---
  { pattern: /(^|\.)anonymised\.io$/, category: "data-broker", service: "Anonymised" },
  { pattern: /(^|\.)company-target\.com$/, category: "data-broker", service: "Demandbase" },
  { pattern: /(^|\.)demandbase\.com$/, category: "data-broker", service: "Demandbase" },
  { pattern: /(^|\.)digitalaudience\.io$/, category: "data-broker", service: "Digital Audience" },
  { pattern: /(^|\.)eu-1-id5-sync\.com$/, category: "data-broker", service: "ID5" },
  { pattern: /(^|\.)exelator\.com$/, category: "data-broker", service: "Nielsen eXelate" },
  { pattern: /(^|\.)eyeota\.net$/, category: "data-broker", service: "Eyeota" },
  { pattern: /(^|\.)geistm\.com$/, category: "data-broker", service: "GeistM" },
  { pattern: /(^|\.)intentiq\.com$/, category: "data-broker", service: "Intent IQ" },
  { pattern: /(^|\.)liadm\.com$/, category: "data-broker", service: "LiveIntent" },
  { pattern: /(^|\.)marketiq\.com$/, category: "data-broker", service: "MarketIQ" },
  { pattern: /(^|\.)ml-api\.io$/, category: "data-broker", service: "MediaLab" },
  { pattern: /(^|\.)ml-attr\.io$/, category: "data-broker", service: "MediaLab" },
  { pattern: /(^|\.)onaudience\.com$/, category: "data-broker", service: "OnAudience" },
  { pattern: /(^|\.)pdscrb\.com$/, category: "data-broker", service: "Pubmatic Identity" },
  { pattern: /(^|\.)pippio\.com$/, category: "data-broker", service: "LiveRamp" },
  { pattern: /(^|\.)semasio\.net$/, category: "data-broker", service: "Semasio" },
  { pattern: /(^|\.)zi-scripts\.com$/, category: "data-broker", service: "ZoomInfo" },
  { pattern: /(^|\.)zoominfo\.com$/, category: "data-broker", service: "ZoomInfo" },

  // --- Analytics, measurement and audience platforms ---
  { pattern: /(^|\.)4dex\.io$/, category: "analytics", service: "4Dex" },
  { pattern: /(^|\.)acuityplatform\.com$/, category: "advertising", service: "AcuityAds" },
  { pattern: /(^|\.)blendee\.com$/, category: "marketing-automation", service: "Blendee" },
  { pattern: /(^|\.)cognitivlabs\.com$/, category: "analytics", service: "Cognitiv" },
  { pattern: /(^|\.)cxense\.com$/, category: "analytics", service: "Piano / Cxense" },
  { pattern: /(^|\.)cxpublic\.com$/, category: "analytics", service: "Piano / Cxense" },
  { pattern: /(^|\.)dotmetrics\.net$/, category: "analytics", service: "Dotmetrics" },
  { pattern: /(^|\.)edigitalsurvey\.com$/, category: "analytics", service: "eDigitalResearch" },
  { pattern: /(^|\.)imrworldwide\.com$/, category: "analytics", service: "Nielsen" },
  { pattern: /(^|\.)im-apps\.net$/, category: "analytics", service: "Intimate Merger" },
  { pattern: /(^|\.)iteratehq\.com$/, category: "analytics", service: "Iterate" },
  { pattern: /(^|\.)macromill\.com$/, category: "analytics", service: "Macromill" },
  { pattern: /(^|\.)mparticle\.com$/, category: "analytics", service: "mParticle" },
  { pattern: /(^|\.)neodatagroup\.com$/, category: "analytics", service: "Neodata" },
  { pattern: /(^|\.)permutive\.com$/, category: "data-broker", service: "Permutive" },
  { pattern: /(^|\.)piano\.io$/, category: "analytics", service: "Piano" },
  { pattern: /(^|\.)tinypass\.com$/, category: "analytics", service: "Piano" },
  { pattern: /(^|\.)pocustrack\.com$/, category: "analytics", service: "Pocus" },
  { pattern: /(^|\.)speedcurve\.com$/, category: "monitoring", service: "SpeedCurve" },
  { pattern: /(^|\.)treasuredata\.com$/, category: "analytics", service: "Treasure Data" },
  { pattern: /(^|\.)tynt\.com$/, category: "analytics", service: "Tynt / 33Across" },
  { pattern: /(^|\.)vector\.co$/, category: "analytics", service: "Vector" },
  { pattern: /(^|\.)pacvue\.com$/, category: "analytics", service: "Pacvue" },

  // --- Marketing automation and engagement ---
  { pattern: /(^|\.)appsflyer\.com$/, category: "marketing-automation", service: "AppsFlyer" },
  { pattern: /(^|\.)hs-banner\.com$/, category: "marketing-automation", service: "HubSpot" },
  { pattern: /(^|\.)hsadspixel\.net$/, category: "advertising", service: "HubSpot Ads" },
  { pattern: /(^|\.)hsforms\.com$/, category: "marketing-automation", service: "HubSpot" },
  { pattern: /(^|\.)hubapi\.com$/, category: "marketing-automation", service: "HubSpot" },
  { pattern: /(^|\.)usemessages\.com$/, category: "marketing-automation", service: "HubSpot" },
  { pattern: /(^|\.)onesignal\.com$/, category: "marketing-automation", service: "OneSignal" },
  { pattern: /(^|\.)webpush\.jp$/, category: "marketing-automation", service: "WebPush" },
  { pattern: /(^|\.)pages07\.net$/, category: "marketing-automation", service: "Oracle Eloqua" },

  // --- Consent and preference platforms observed in the wild ---
  { pattern: /(^|\.)privacymanager\.io$/, category: "consent-management", service: "InMobi Choice" },
  { pattern: /(^|\.)privacy-mgmt\.com$/, category: "consent-management", service: "Sourcepoint" },
  { pattern: /(^|\.)transcend-cdn\.com$/, category: "consent-management", service: "Transcend" },
  { pattern: /(^|\.)opecloud\.com$/, category: "consent-management", service: "OneTrust / Opecloud" },
  { pattern: /(^|\.)ccgateway\.net$/, category: "consent-management", service: "Consent gateway" },

  // --- Identity/CIAM and comment platforms ---
  { pattern: /(^|\.)gigya\.com$/, category: "crm", service: "SAP Customer Data Cloud" },
  { pattern: /(^|\.)spot\.im$/, category: "social-plugin", service: "OpenWeb / Spot.IM" },

  // --- Broad-surface hosts kept last, so a specific subdomain above wins ---
  { pattern: /(^|\.)googleapis\.com$/, category: "cdn", service: "Google APIs" },
  { pattern: /(^|\.)google\.com$/, category: "unknown-third-party", service: "Google (unclassified endpoint)" },
];

export interface DomainClassification {
  domain: string;
  category: string;
  service: string;
  /**
   * How the category was arrived at.
   *
   * `known` - the host matched the static map, which names the service.
   * `inferred` - the host or request path carries an unmistakable tracking
   *   marker (`sync.`, `pixel.`, `rtb.`, `/usersync`, ...) but the service is
   *   not named here. A rule may act on this, but must say the category was
   *   inferred and must not assert a breach on it alone.
   * `unknown` - nothing was established. Surfaced for review, never flagged.
   */
  evidence: "known" | "inferred" | "unknown";
  /** For an inferred classification, the marker that produced it. */
  inferredFrom?: string;
}

/**
 * Host labels that only appear on tracking infrastructure.
 *
 * The real-scan sample behind this: 412 of 613 third-party records over 16
 * public sites were `unknown-third-party`, and the hosts were things like
 * `sync.mathtag.com`, `cs.media.net`, `match.deepintent.com`,
 * `ad.360yield.com`, `px.ladsp.com`. A static map will never enumerate the
 * RTB ecosystem, and leaving them unclassified means no consent rule can see
 * them at all. These labels are the vocabulary that ecosystem uses for
 * itself.
 *
 * Only the *leftmost* label is tested, and only against exact matches, which
 * is what keeps `api.`, `cdn.`, `static.`, `img.`, `play.` and `accounts.`
 * out. A match yields an `inferred` classification, never a `known` one.
 */
const INFERRED_TRACKING_LABELS: Record<string, { category: string; kind: string }> = {
  ad: { category: "advertising", kind: "an ad-serving host label" },
  ads: { category: "advertising", kind: "an ad-serving host label" },
  adn: { category: "advertising", kind: "an ad-network host label" },
  adx: { category: "advertising", kind: "an ad-exchange host label" },
  adserver: { category: "advertising", kind: "an ad-server host label" },
  adservice: { category: "advertising", kind: "an ad-service host label" },
  adsystem: { category: "advertising", kind: "an ad-system host label" },
  adserv: { category: "advertising", kind: "an ad-server host label" },
  jadserve: { category: "advertising", kind: "an ad-server host label" },
  dsp: { category: "advertising", kind: "a demand-side-platform host label" },
  ssp: { category: "advertising", kind: "a supply-side-platform host label" },
  rtb: { category: "advertising", kind: "a real-time-bidding host label" },
  prebid: { category: "advertising", kind: "a header-bidding host label" },
  pbs: { category: "advertising", kind: "a Prebid Server host label" },
  hb: { category: "advertising", kind: "a header-bidding host label" },
  hbx: { category: "advertising", kind: "a header-bidding host label" },
  bid: { category: "advertising", kind: "a bidding host label" },
  bidder: { category: "advertising", kind: "a bidding host label" },
  sync: { category: "data-broker", kind: "a cookie-sync host label" },
  csync: { category: "data-broker", kind: "a cookie-sync host label" },
  cksync: { category: "data-broker", kind: "a cookie-sync host label" },
  usersync: { category: "data-broker", kind: "a user-sync host label" },
  idsync: { category: "data-broker", kind: "an identity-sync host label" },
  cs: { category: "data-broker", kind: "a cookie-sync host label" },
  cm: { category: "data-broker", kind: "a cookie-match host label" },
  um: { category: "data-broker", kind: "a user-match host label" },
  ums: { category: "data-broker", kind: "a user-match host label" },
  ups: { category: "data-broker", kind: "a user-profile-sync host label" },
  match: { category: "data-broker", kind: "an identity-match host label" },
  pixel: { category: "advertising", kind: "a tracking-pixel host label" },
  pixels: { category: "advertising", kind: "a tracking-pixel host label" },
  pxl: { category: "advertising", kind: "a tracking-pixel host label" },
  px: { category: "advertising", kind: "a tracking-pixel host label" },
  tr: { category: "analytics", kind: "a tracking host label" },
  trk: { category: "analytics", kind: "a tracking host label" },
  track: { category: "analytics", kind: "a tracking host label" },
  tracker: { category: "analytics", kind: "a tracking host label" },
  tracking: { category: "analytics", kind: "a tracking host label" },
  beacon: { category: "analytics", kind: "a beacon host label" },
  telemetry: { category: "analytics", kind: "a telemetry host label" },
  analytics: { category: "analytics", kind: "an analytics host label" },
  stats: { category: "analytics", kind: "a statistics host label" },
  metrics: { category: "analytics", kind: "a metrics host label" },
  collector: { category: "analytics", kind: "a collector host label" },
  dmp: { category: "data-broker", kind: "a data-management-platform host label" },
  segments: { category: "data-broker", kind: "an audience-segment host label" },
  audience: { category: "data-broker", kind: "an audience host label" },
  retarget: { category: "advertising", kind: "a retargeting host label" },
};

/** Label suffixes that carry the same meaning: `gumgum-match`, `user-sync`. */
const INFERRED_LABEL_SUFFIXES: Array<{ suffix: string; category: string; kind: string }> = [
  { suffix: "-match", category: "data-broker", kind: "an identity-match host label" },
  { suffix: "-sync", category: "data-broker", kind: "a cookie-sync host label" },
  { suffix: "-cookie-sync", category: "data-broker", kind: "a cookie-sync host label" },
  { suffix: "-pixel", category: "advertising", kind: "a tracking-pixel host label" },
  { suffix: "-rtb", category: "advertising", kind: "a real-time-bidding host label" },
  { suffix: "-adserver", category: "advertising", kind: "an ad-server host label" },
  { suffix: "-tracking", category: "analytics", kind: "a tracking host label" },
  { suffix: "-analytics", category: "analytics", kind: "an analytics host label" },
];

/**
 * Request paths that only tracking endpoints serve. Used as a second opinion
 * for hosts whose name says nothing.
 */
const INFERRED_TRACKING_PATHS: Array<{ pattern: RegExp; category: string; kind: string }> = [
  { pattern: /\/(usersync|user_sync|cookiesync|cookie_sync|cksync|idsync|id_sync|getuid|setuid|pixelsync)\b/i, category: "data-broker", kind: "a cookie-sync request path" },
  { pattern: /\/(rtb|openrtb2?|prebid|hbopenbid|bidrequest)\b/i, category: "advertising", kind: "a real-time-bidding request path" },
  { pattern: /\/(pagead|adsid|adview|adcall|adserve|adrequest|impression)\b/i, category: "advertising", kind: "an ad-serving request path" },
  { pattern: /\/(pixel|px|tr|track|trk|beacon|collect|telemetry)(\/|\.|\?|$)/i, category: "analytics", kind: "a tracking request path" },
];

function inferFromHost(host: string): { category: string; kind: string } | null {
  const labels = host.split(".");
  const leftmost = labels[0] ?? "";
  const direct = INFERRED_TRACKING_LABELS[leftmost];
  if (direct) return direct;
  const suffixed = INFERRED_LABEL_SUFFIXES.find((entry) => leftmost.endsWith(entry.suffix));
  if (suffixed) return { category: suffixed.category, kind: suffixed.kind };
  return null;
}

/**
 * Classifies a host the static map does not name, from tracking markers in
 * the host and (when available) the request path. Returns `null` when
 * nothing can be established, which stays `unknown-third-party`.
 */
export function inferTrackingCategory(host: string, requestUrl?: string): { category: string; kind: string } | null {
  const fromHost = inferFromHost(normalizeHost(host));
  if (fromHost) return fromHost;
  if (!requestUrl) return null;
  try {
    const path = new URL(requestUrl).pathname;
    const fromPath = INFERRED_TRACKING_PATHS.find((entry) => entry.pattern.test(path));
    if (fromPath) return { category: fromPath.category, kind: fromPath.kind };
  } catch {
    return null;
  }
  return null;
}

/**
 * Classifies a third-party host.
 *
 * `requestUrl` is optional and only used to infer a category for a host the
 * static map does not name; passing it turns an unclassified RTB endpoint
 * into an `inferred` classification a rule can reason about.
 */
export function classifyDomain(domain: string, requestUrl?: string): DomainClassification {
  const normalized = normalizeHost(domain);
  for (const entry of DOMAIN_CATEGORY_MAP) {
    if (entry.pattern.test(normalized)) {
      return { domain: normalized, category: entry.category, service: entry.service, evidence: "known" };
    }
  }
  const inferred = inferTrackingCategory(normalized, requestUrl);
  if (inferred) {
    return {
      domain: normalized,
      category: inferred.category,
      service: `${normalized} (unnamed service, classified from ${inferred.kind})`,
      evidence: "inferred",
      inferredFrom: inferred.kind,
    };
  }
  return { domain: normalized, category: "unknown-third-party", service: normalized, evidence: "unknown" };
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
