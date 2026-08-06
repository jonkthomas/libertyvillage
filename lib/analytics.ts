export const POSTHOG_INGEST_HOST = "https://us.i.posthog.com";
export const LANDING_SESSION_KEY = "libertyvillage:site-landing:v1";

export const ANALYTICS_EVENTS = {
  pageview: "$pageview",
  landing: "site_landing",
  businessContact: "business_contact_clicked",
  newsletterSucceeded: "newsletter_signup_succeeded",
  newsletterFailed: "newsletter_signup_failed",
} as const;

export type DeploymentEnvironment = "production" | "preview" | "local";
export type LandingChannel =
  | "direct"
  | "organic_search"
  | "paid_search"
  | "email"
  | "social"
  | "referral";
export type BusinessContactType = "website" | "phone";
export type NewsletterFailureReason =
  | "client_validation"
  | "not_configured"
  | "http_error"
  | "invalid_response"
  | "network_error";

export interface AnalyticsConfig {
  key: string;
  host: typeof POSTHOG_INGEST_HOST;
  environment: DeploymentEnvironment;
}

type Primitive = string | number | boolean | null;
type EventProperties = Record<string, Primitive>;
type CaptureSink = (event: string, properties: EventProperties) => void;

let captureSink: CaptureSink | null = null;

const VALID_ENVIRONMENTS = new Set<DeploymentEnvironment>([
  "production",
  "preview",
  "local",
]);
const PAID_MEDIUMS = new Set([
  "cpc",
  "ppc",
  "paid",
  "paid_search",
  "paidsearch",
  "search_ads",
]);
const SOCIAL_MEDIUMS = new Set(["social", "social_media", "organic_social"]);
const SEARCH_HOST_PATTERNS = [
  /(^|\.)google\.[a-z.]+$/,
  /(^|\.)bing\.com$/,
  /(^|\.)search\.yahoo\.[a-z.]+$/,
  /(^|\.)duckduckgo\.com$/,
  /(^|\.)ecosia\.org$/,
  /(^|\.)baidu\.com$/,
  /(^|\.)yandex\.[a-z.]+$/,
];
const SOCIAL_HOST_PATTERNS = [
  /(^|\.)facebook\.com$/,
  /(^|\.)instagram\.com$/,
  /(^|\.)linkedin\.com$/,
  /(^|\.)tiktok\.com$/,
  /(^|\.)x\.com$/,
  /(^|\.)twitter\.com$/,
];

export function parseAnalyticsConfig(input: {
  key?: string;
  host?: string;
  environment?: string;
}): AnalyticsConfig | null {
  const key = input.key?.trim();
  const environment = input.environment?.trim() as DeploymentEnvironment | undefined;
  const host = (input.host?.trim() || POSTHOG_INGEST_HOST).replace(/\/$/, "");

  if (!key?.startsWith("phc_") || !environment || !VALID_ENVIRONMENTS.has(environment)) {
    return null;
  }
  if (host !== POSTHOG_INGEST_HOST) {
    return null;
  }
  return { key, host: POSTHOG_INGEST_HOST, environment };
}

export function getPublicAnalyticsConfig(): AnalyticsConfig | null {
  return parseAnalyticsConfig({
    key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    environment: process.env.NEXT_PUBLIC_SITE_ENV,
  });
}

export function sanitizePath(value: string | null | undefined): string {
  const raw = (value || "/").split(/[?#]/, 1)[0] || "/";
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return path.slice(0, 300);
}

export function sanitizeHostname(value: string | null | undefined): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.-]/g, "")
    .slice(0, 253);
}

export function sanitizeLabel(value: string | null | undefined, maxLength = 100): string {
  return (value || "")
    .trim()
    .replace(/[^a-zA-Z0-9 _.:/-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

export function getReferrerHost(referrer: string | null | undefined): string {
  if (!referrer) return "";
  try {
    return sanitizeHostname(new URL(referrer).hostname);
  } catch {
    return "";
  }
}

function matchesAnyHost(host: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(host));
}

export function classifyLandingChannel(input: {
  referrerHost?: string;
  utmMedium?: string;
  hasPaidClickId?: boolean;
}): LandingChannel {
  const referrerHost = sanitizeHostname(input.referrerHost);
  const medium = sanitizeLabel(input.utmMedium, 40).toLowerCase();

  if (input.hasPaidClickId || PAID_MEDIUMS.has(medium)) return "paid_search";
  if (medium === "organic" || matchesAnyHost(referrerHost, SEARCH_HOST_PATTERNS)) {
    return "organic_search";
  }
  if (medium === "email") return "email";
  if (SOCIAL_MEDIUMS.has(medium) || matchesAnyHost(referrerHost, SOCIAL_HOST_PATTERNS)) {
    return "social";
  }
  return referrerHost ? "referral" : "direct";
}

export interface LandingProperties {
  landing_path: string;
  referrer_host: string;
  channel: LandingChannel;
}

export function buildLandingProperties(input: {
  pathname: string;
  search?: string;
  referrer?: string;
}): LandingProperties {
  const params = new URLSearchParams(input.search || "");
  const referrerHost = getReferrerHost(input.referrer);
  const utmMedium = sanitizeLabel(params.get("utm_medium"), 40);
  const hasPaidClickId = ["gclid", "msclkid", "dclid"].some((key) => params.has(key));

  return {
    landing_path: sanitizePath(input.pathname),
    referrer_host: referrerHost,
    channel: classifyLandingChannel({ referrerHost, utmMedium, hasPaidClickId }),
  };
}

export function registerAnalyticsCapture(sink: CaptureSink | null): void {
  captureSink = sink;
}

function runtimeBase(pathname?: string): EventProperties | null {
  if (typeof window === "undefined") return null;
  const config = getPublicAnalyticsConfig();
  if (!config) return null;

  const path = sanitizePath(pathname || window.location.pathname);
  const siteHostname = sanitizeHostname(window.location.hostname);
  const referrerHost = getReferrerHost(document.referrer);
  return {
    deployment_environment: config.environment,
    site_hostname: siteHostname,
    path,
    $current_url: `${window.location.origin}${path}`,
    $referrer: referrerHost,
    $referring_domain: referrerHost,
  };
}

function capture(event: string, properties: EventProperties): boolean {
  if (!captureSink) return false;
  captureSink(event, properties);
  return true;
}

export function capturePageview(pathname: string): boolean {
  const base = runtimeBase(pathname);
  return base ? capture(ANALYTICS_EVENTS.pageview, base) : false;
}

export function captureLanding(properties: LandingProperties): boolean {
  const base = runtimeBase(properties.landing_path);
  if (!base) return false;
  return capture(ANALYTICS_EVENTS.landing, {
    ...base,
    landing_path: properties.landing_path,
    referrer_host: properties.referrer_host,
    channel: properties.channel,
  });
}

export function captureBusinessContact(input: {
  businessSlug: string;
  businessCategory: string;
  contactType: BusinessContactType;
}): boolean {
  const base = runtimeBase();
  if (!base) return false;
  return capture(ANALYTICS_EVENTS.businessContact, {
    ...base,
    business_slug: sanitizeLabel(input.businessSlug, 120),
    business_category: sanitizeLabel(input.businessCategory, 80),
    contact_type: input.contactType,
  });
}

export function captureNewsletterResult(input: {
  succeeded: boolean;
  source: string;
  reason?: NewsletterFailureReason;
  httpStatusClass?: "4xx" | "5xx" | "other";
}): boolean {
  const base = runtimeBase();
  if (!base) return false;
  return capture(
    input.succeeded ? ANALYTICS_EVENTS.newsletterSucceeded : ANALYTICS_EVENTS.newsletterFailed,
    {
      ...base,
      source: sanitizeLabel(input.source, 120),
      ...(!input.succeeded && input.reason ? { reason: input.reason } : {}),
      ...(!input.succeeded && input.httpStatusClass
        ? { http_status_class: input.httpStatusClass }
        : {}),
    },
  );
}

const ALLOWED_POSTHOG_PROPERTIES = new Set([
  "token",
  "$insert_id",
  "$process_person_profile",
  "deployment_environment",
  "site_hostname",
  "path",
  "$current_url",
  "$referrer",
  "$referring_domain",
  "landing_path",
  "referrer_host",
  "channel",
  "business_slug",
  "business_category",
  "contact_type",
  "source",
  "reason",
  "http_status_class",
]);

export function sanitizePosthogProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!ALLOWED_POSTHOG_PROPERTIES.has(key)) continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    if (key === "token" && (typeof value !== "string" || !value.startsWith("phc_"))) continue;
    sanitized[key] = value;
  }

  // Identity is intentionally suppressed. Aggregate sessions use site_landing
  // event counts; PostHog person and session counts are not valid denominators.
  sanitized.distinct_id = "anonymous";
  sanitized.$process_person_profile = false;

  const path = sanitizePath(
    typeof sanitized.path === "string"
      ? sanitized.path
      : typeof window !== "undefined"
        ? window.location.pathname
        : "/",
  );
  let origin = "";
  sanitized.path = path;
  if (typeof sanitized.landing_path === "string") {
    sanitized.landing_path = sanitizePath(sanitized.landing_path);
  }

  if (typeof window !== "undefined") {
    origin = window.location.origin;
    sanitized.site_hostname = sanitizeHostname(window.location.hostname);
    const config = getPublicAnalyticsConfig();
    if (config) sanitized.deployment_environment = config.environment;
  } else if (typeof sanitized.$current_url === "string") {
    try {
      origin = new URL(sanitized.$current_url).origin;
    } catch {
      origin = "";
    }
  }
  sanitized.$current_url = origin ? `${origin}${path}` : path;

  const rawReferrer = typeof sanitized.$referrer === "string" ? sanitized.$referrer : "";
  sanitized.$referrer = rawReferrer.includes("://")
    ? getReferrerHost(rawReferrer)
    : sanitizeHostname(rawReferrer);
  sanitized.$referring_domain = sanitizeHostname(
    typeof sanitized.$referring_domain === "string" ? sanitized.$referring_domain : "",
  );
  if (typeof sanitized.referrer_host === "string") {
    sanitized.referrer_host = sanitizeHostname(sanitized.referrer_host);
  }
  if (typeof sanitized.business_slug === "string") {
    sanitized.business_slug = sanitizeLabel(sanitized.business_slug, 120);
  }
  if (typeof sanitized.business_category === "string") {
    sanitized.business_category = sanitizeLabel(sanitized.business_category, 80);
  }
  if (typeof sanitized.source === "string") {
    sanitized.source = sanitizeLabel(sanitized.source, 120);
  }
  return sanitized;
}
