"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import posthog, { type PostHogInterface } from "posthog-js";
import {
  ANALYTICS_EVENTS,
  LANDING_SESSION_KEY,
  buildLandingProperties,
  captureBusinessContact,
  captureLanding,
  capturePageview,
  getPublicAnalyticsConfig,
  registerAnalyticsCapture,
  sanitizePath,
  sanitizePosthogProperties,
  type BusinessContactType,
} from "@/lib/analytics";

let initializedKey: string | null = null;
let analyticsClient: PostHogInterface | null = null;
let landingCapturedInMemory = false;

function hasCapturedLanding(): boolean {
  if (landingCapturedInMemory) return true;
  try {
    return sessionStorage.getItem(LANDING_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberLanding(): void {
  landingCapturedInMemory = true;
  try {
    sessionStorage.setItem(LANDING_SESSION_KEY, "1");
  } catch {
    // Analytics remains optional when storage is unavailable.
  }
}

function isContactType(value: string | undefined): value is BusinessContactType {
  return value === "website" || value === "phone";
}

export default function Analytics() {
  const pathname = usePathname();
  const lastCapturedPath = useRef<string | null>(null);
  const entry = useRef<{ pathname: string; search: string; referrer: string } | null>(null);
  const [ready, setReady] = useState(false);
  const config = useMemo(() => getPublicAnalyticsConfig(), []);

  useEffect(() => {
    if (!config) return;

    entry.current ??= {
      pathname: window.location.pathname,
      search: window.location.search,
      referrer: document.referrer,
    };

    const activate = (client: PostHogInterface) => {
      analyticsClient = client;
      initializedKey = config.key;
      registerAnalyticsCapture((event, properties) => {
        client.capture(event, properties);
      });
      setReady(true);
    };

    if (!initializedKey) {
      const client = posthog.init(config.key, {
        api_host: config.host,
        capture_pageview: false,
        capture_pageleave: false,
        autocapture: false,
        disable_session_recording: true,
        capture_heatmaps: false,
        capture_performance: false,
        capture_exceptions: false,
        request_batching: false,
        disable_compression: true,
        person_profiles: "never",
        persistence: "memory",
        advanced_disable_flags: true,
        opt_out_useragent_filter: config.environment !== "production",
        before_send: (event) => {
          if (!event || !Object.values(ANALYTICS_EVENTS).some((name) => name === event.event)) {
            return null;
          }
          const properties = sanitizePosthogProperties(event.properties || {});
          if (!properties.deployment_environment || !properties.site_hostname) return null;
          return {
            ...event,
            properties,
            $set: undefined,
            $set_once: undefined,
            $unset: undefined,
          };
        },
        loaded: activate,
      });
      initializedKey = config.key;
      analyticsClient = client;
    } else if (initializedKey === config.key && analyticsClient) {
      activate(analyticsClient);
    } else {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>(
        '[data-analytics-event="business_contact_clicked"]',
      );
      if (!anchor) return;

      const contactType = anchor.dataset.contactType;
      if (!isContactType(contactType)) return;
      captureBusinessContact({
        businessSlug: anchor.dataset.businessSlug || "",
        businessCategory: anchor.dataset.businessCategory || "",
        contactType,
      });
    };

    document.addEventListener("click", handleClick, { capture: true });
    return () => {
      document.removeEventListener("click", handleClick, { capture: true });
      registerAnalyticsCapture(null);
    };
  }, [config]);

  useEffect(() => {
    if (!config || !ready || initializedKey !== config.key) return;

    const path = sanitizePath(pathname);
    if (lastCapturedPath.current === path) return;
    lastCapturedPath.current = path;
    capturePageview(path);

    if (!hasCapturedLanding()) {
      const landingEntry = entry.current ?? {
        pathname: window.location.pathname,
        search: window.location.search,
        referrer: document.referrer,
      };
      const captured = captureLanding(buildLandingProperties(landingEntry));
      if (captured) rememberLanding();
    }
  }, [config, pathname, ready]);

  return null;
}
