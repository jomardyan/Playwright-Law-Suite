/**
 * Recognises cookie names and web-storage keys that carry a tracking
 * identifier.
 *
 * Why this exists: a network-request check alone misses the most common
 * real-world pattern. A site running Google Analytics through a first-party
 * endpoint, a server-side tag manager, or a proxied Meta CAPI still writes
 * `_ga` and `_fbp` into the browser before the visitor has agreed to
 * anything - and Art. 5(3) ePrivacy is about the *storing of, or access to,*
 * information on the terminal equipment, not about who the request went to.
 * Checking only outbound domains therefore under-reports exactly the
 * deployments that were built to avoid being seen.
 *
 * A match here says "this key is the identifier that service is known to
 * write". It says nothing about whether writing it was lawful; that is for
 * the pack, and ultimately a person, to decide.
 */

export type StorageMechanism = "cookie" | "localStorage" | "sessionStorage";

export interface TrackerStorageClassification {
  key: string;
  mechanism: StorageMechanism;
  /** Same vocabulary as `classifyDomain`, so rules can share one category set. */
  category: string;
  service: string;
}

interface TrackerKeyPattern {
  pattern: RegExp;
  category: string;
  service: string;
}

/**
 * Ordered most specific first. Patterns are anchored deliberately: an
 * unanchored `/ga/` would match `language`, `organisation` and half the
 * preference cookies on the web.
 */
const TRACKER_KEY_PATTERNS: TrackerKeyPattern[] = [
  // Google Analytics / Ads. `_ga_<container>` is the GA4 session cookie.
  { pattern: /^_ga(_[A-Z0-9]+)?$/i, category: "analytics", service: "Google Analytics" },
  { pattern: /^_gid$/i, category: "analytics", service: "Google Analytics" },
  { pattern: /^_gat(_.+)?$/i, category: "analytics", service: "Google Analytics" },
  { pattern: /^__utm[abcvxz]$/i, category: "analytics", service: "Google Analytics (legacy)" },
  { pattern: /^_gcl_(au|aw|dc|gb|gf|ha)$/i, category: "advertising", service: "Google Ads conversion linker" },
  { pattern: /^_gac_.+$/i, category: "advertising", service: "Google Ads" },
  { pattern: /^(IDE|DSID|test_cookie)$/, category: "advertising", service: "Google DoubleClick" },
  { pattern: /^__gads$/i, category: "advertising", service: "Google AdSense" },
  { pattern: /^__gpi$/i, category: "advertising", service: "Google Publisher Tag" },

  // Meta.
  { pattern: /^_fb[pc]$/i, category: "advertising", service: "Meta Pixel" },
  { pattern: /^(datr|c_user)$/, category: "social-plugin", service: "Meta / Facebook" },

  // Microsoft.
  { pattern: /^_uet(sid|vid)(_exp)?$/i, category: "advertising", service: "Microsoft UET tag" },
  { pattern: /^(MUID|MR|MSPTC|ANONCHK|SRM_B)$/i, category: "advertising", service: "Microsoft Advertising" },
  { pattern: /^_cl(ck|sk)$/i, category: "session-recording", service: "Microsoft Clarity" },
  { pattern: /^CLID$/i, category: "session-recording", service: "Microsoft Clarity" },

  // Other advertising pixels.
  { pattern: /^_ttp$/i, category: "advertising", service: "TikTok Pixel" },
  { pattern: /^_tt_enable_cookie$/i, category: "advertising", service: "TikTok Pixel" },
  { pattern: /^(li_sugr|bcookie|bscookie|lidc|UserMatchHistory|AnalyticsSyncHistory|li_gc)$/i, category: "advertising", service: "LinkedIn" },
  { pattern: /^_pin_unauth$/i, category: "advertising", service: "Pinterest Tag" },
  { pattern: /^_pinterest_(ct|sess|ct_rt)$/i, category: "advertising", service: "Pinterest" },
  { pattern: /^_scid$/i, category: "advertising", service: "Snap Pixel" },
  { pattern: /^_rdt_uuid$/i, category: "advertising", service: "Reddit Pixel" },
  { pattern: /^(personalization_id|guest_id|muc_ads)$/i, category: "advertising", service: "X (Twitter)" },
  { pattern: /^(criteo|cto_(bundle|bidid|optout|dna_bundle|axid))/i, category: "advertising", service: "Criteo" },
  { pattern: /^(taboola_session_id|t_gid|trc_cookie_storage)$/i, category: "advertising", service: "Taboola" },
  { pattern: /^(obuid|_obid)$/i, category: "advertising", service: "Outbrain" },
  { pattern: /^__adroll(_fpc|_shared|_session)?/i, category: "advertising", service: "AdRoll" },
  { pattern: /^(uuid2|anj|usersync)$/i, category: "advertising", service: "Xandr / AppNexus" },
  { pattern: /^(ad-id|ad-privacy)$/i, category: "advertising", service: "Amazon Advertising" },
  { pattern: /^_kuid_$/i, category: "data-broker", service: "Salesforce Krux" },
  { pattern: /^(rlas3|pxrc|_rxuuid)$/i, category: "data-broker", service: "LiveRamp" },
  { pattern: /^bku?id$/i, category: "data-broker", service: "Oracle BlueKai" },
  { pattern: /^(panoramaId|panoramaIdType|panoramaId_expiry)$/i, category: "data-broker", service: "Lotame Panorama" },
  { pattern: /^id5(id|_consent)/i, category: "data-broker", service: "ID5" },

  // Analytics platforms.
  { pattern: /^_hj[A-Za-z]/, category: "session-recording", service: "Hotjar" },
  { pattern: /^(fs_uid|fs_lua|fs_session)$/i, category: "session-recording", service: "FullStory" },
  { pattern: /^(mf_user|_mf_[A-Za-z0-9]+)$/i, category: "session-recording", service: "Mouseflow" },
  { pattern: /^SL_[CG]_/i, category: "session-recording", service: "Smartlook" },
  { pattern: /^(__lo_.+|_lo(uid|_v))$/i, category: "session-recording", service: "Lucky Orange" },
  { pattern: /^(_cs_(id|s|c|ex|root_domain)|_cs_.+)$/i, category: "session-recording", service: "Contentsquare" },
  { pattern: /^(_cq_(duid|suid)|is_returning)$/i, category: "session-recording", service: "Quantum Metric" },
  { pattern: /^(_ce\.|_CEFT)/i, category: "session-recording", service: "Crazy Egg" },
  { pattern: /^ajs_(anonymous_id|user_id|group_id)$/i, category: "analytics", service: "Segment" },
  { pattern: /^(amplitude_(id|test)|amp_[a-f0-9]+)/i, category: "analytics", service: "Amplitude" },
  { pattern: /^(mp_[a-f0-9]+_mixpanel|__mp_opt_in_out)/i, category: "analytics", service: "Mixpanel" },
  { pattern: /^(_pk_(id|ses|ref|cvar|hsr))/i, category: "analytics", service: "Matomo" },
  { pattern: /^(_sp_id|_sp_ses)/i, category: "analytics", service: "Snowplow" },
  { pattern: /^(_hp2_(id|ses|props))/i, category: "analytics", service: "Heap" },
  { pattern: /^_scor_uid$/, category: "analytics", service: "Comscore" },
  { pattern: /^__qca$/i, category: "analytics", service: "Quantcast" },
  { pattern: /^(_yasc|yandexuid|_ym_(uid|d|isad|visorc))/i, category: "analytics", service: "Yandex Metrica" },
  { pattern: /^(s_cc|s_sq|s_vi|s_fid|AMCV_|AMCVS_)/i, category: "analytics", service: "Adobe Analytics" },
  { pattern: /^(demdex|dpm)$/i, category: "advertising", service: "Adobe Audience Manager" },
  { pattern: /^(__hstc|__hssrc|__hssc|hubspotutk)$/i, category: "marketing-automation", service: "HubSpot" },
  { pattern: /^(_mkto_trk|__mkto)/i, category: "marketing-automation", service: "Adobe Marketo" },
  { pattern: /^(visitor_id\d+(-hash)?|pardot)$/i, category: "marketing-automation", service: "Salesforce Pardot" },
  { pattern: /^(__kla_id|_kla_)/i, category: "marketing-automation", service: "Klaviyo" },
  { pattern: /^(ab\.storage\.(deviceId|sessionId|userId))/i, category: "marketing-automation", service: "Braze" },
  { pattern: /^(_omappvp|_omappvs)$/i, category: "ab-testing", service: "OptinMonster" },
  { pattern: /^(optimizely(EndUserId|Buckets|Segments)|optimizely_data)/i, category: "ab-testing", service: "Optimizely" },
  { pattern: /^_vwo(_uuid|_ds|_sn|_uuid_v2)/i, category: "ab-testing", service: "VWO" },
  { pattern: /^(ABTasty|ABTastySession)/i, category: "ab-testing", service: "AB Tasty" },
  { pattern: /^(_dy_(c_exps|csc_ses|geo|toffset)|_dyid)/i, category: "ab-testing", service: "Dynamic Yield" },
  { pattern: /^(kameleoon(VisitorCode|Visit))/i, category: "ab-testing", service: "Kameleoon" },
  { pattern: /^_pk_testcookie/i, category: "analytics", service: "Matomo" },
  { pattern: /^(fpjs|fingerprintjs)/i, category: "fingerprinting", service: "FingerprintJS" },
];

/**
 * Cookie names that look like a tracker but are the consent record itself.
 *
 * Storing the visitor's own consent choice is strictly necessary for the
 * service they asked for, so flagging it as pre-consent tracking would be
 * exactly backwards - the cookie exists *because* the site implemented
 * consent.
 */
const CONSENT_RECORD_PATTERNS: RegExp[] = [
  /^(OptanonConsent|OptanonAlertBoxClosed|eupubconsent(-v2)?)$/i,
  /^(CookieConsent|CookieConsentBulkSetting|cookieyes-consent|cky-)/i,
  /^(euconsent(-v2)?|addtl_consent|usprivacy|gpp|gpp_sid)$/i,
  /^(didomi_token|didomi-|axeptio_)/i,
  /^(_iub_cs|iubenda|_sp_(v1_|user_)|consentUUID)/i,
  /^(complianz_|cmplz_|borlabs-cookie|moove_gdpr_popup|real_cookie_banner)/i,
  /^(termly-|osano_consentmanager|usercentrics|uc_settings|uc_user_interaction)/i,
  /^(cookie_?(consent|notice|policy|preferences|banner|accepted|agreed))/i,
  /^(gdpr[-_]?(consent|accepted|preferences))/i,
];

/** True when the key records the visitor's own consent choice. */
export function isConsentRecordKey(key: string): boolean {
  return CONSENT_RECORD_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Classifies a cookie name or storage key, or returns `null` when it matches
 * nothing known. An unknown key is never guessed at: a scanner that called
 * every unrecognised cookie a tracker would be wrong about most sites.
 */
export function classifyStorageKey(key: string, mechanism: StorageMechanism): TrackerStorageClassification | null {
  const trimmed = key.trim();
  if (trimmed.length === 0) return null;
  if (isConsentRecordKey(trimmed)) return null;
  for (const entry of TRACKER_KEY_PATTERNS) {
    if (entry.pattern.test(trimmed)) {
      return { key: trimmed, mechanism, category: entry.category, service: entry.service };
    }
  }
  return null;
}

export interface StateStorageSnapshot {
  cookies: ReadonlyArray<{ name: string }>;
  localStorageKeys: readonly string[];
  sessionStorageKeys: readonly string[];
}

/**
 * Every recognised tracking identifier in a captured browser state,
 * deduplicated by mechanism + key.
 *
 * `sessionStorage` is included: it is still "information stored on the
 * terminal equipment of a subscriber or user", and a session-scoped
 * identifier is used for exactly the same purpose as a cookie-scoped one.
 */
export function findTrackingStorage(state: StateStorageSnapshot): TrackerStorageClassification[] {
  const found = new Map<string, TrackerStorageClassification>();
  const add = (key: string, mechanism: StorageMechanism) => {
    const classification = classifyStorageKey(key, mechanism);
    if (!classification) return;
    const dedupeKey = `${mechanism}|${classification.key}`;
    if (!found.has(dedupeKey)) found.set(dedupeKey, classification);
  };

  for (const cookie of state.cookies) add(cookie.name, "cookie");
  for (const key of state.localStorageKeys) add(key, "localStorage");
  for (const key of state.sessionStorageKeys) add(key, "sessionStorage");
  return Array.from(found.values());
}
