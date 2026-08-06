"use client";

import { useState } from "react";
import { captureNewsletterResult } from "@/lib/analytics";

interface Props {
  heading?: string;
  description?: string;
  source?: string;
}

export default function EmailCapture({
  heading = "Get Liberty Village updates",
  description = "Local news, new openings, road closures, and guides — once a week, no spam.",
  source = "blog",
}: Props) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const endpoint = process.env.NEXT_PUBLIC_EMAIL_CAPTURE_URL;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalizedEmail = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      captureNewsletterResult({
        succeeded: false,
        source,
        reason: "client_validation",
      });
      setErrorMessage("Please enter a valid email.");
      setStatus("error");
      return;
    }
    if (!endpoint) {
      captureNewsletterResult({
        succeeded: false,
        source,
        reason: "not_configured",
      });
      setErrorMessage("Subscriptions are temporarily unavailable. Please try again later.");
      setStatus("error");
      return;
    }

    setStatus("submitting");
    setErrorMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, source }),
      });

      if (!response.ok) {
        const httpStatusClass =
          response.status >= 400 && response.status < 500
            ? "4xx"
            : response.status >= 500
              ? "5xx"
              : "other";
        captureNewsletterResult({
          succeeded: false,
          source,
          reason: "http_error",
          httpStatusClass,
        });
        setErrorMessage("We couldn't subscribe you right now. Please try again.");
        setStatus("error");
        return;
      }

      let result: unknown;
      const contentType = response.headers.get("content-type")?.toLowerCase() || "";
      try {
        result = contentType.includes("application/json") ? await response.json() : null;
      } catch {
        result = null;
      }
      if (
        !result ||
        typeof result !== "object" ||
        !("success" in result) ||
        result.success !== true
      ) {
        captureNewsletterResult({
          succeeded: false,
          source,
          reason: "invalid_response",
        });
        setErrorMessage("We couldn't subscribe you right now. Please try again.");
        setStatus("error");
        return;
      }

      captureNewsletterResult({ succeeded: true, source });
      setEmail("");
      setStatus("success");
    } catch {
      captureNewsletterResult({
        succeeded: false,
        source,
        reason: "network_error",
      });
      setErrorMessage("We couldn't subscribe you right now. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-6 py-5 text-center">
        <p className="text-base font-semibold text-warm-900">You&apos;re on the list.</p>
        <p className="mt-1 text-sm text-warm-600">
          Check your inbox for a quick confirmation.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-10 rounded-xl border border-warm-200 bg-warm-50 px-6 py-6 sm:px-8 sm:py-7">
      <h3 className="text-lg font-semibold text-warm-900">{heading}</h3>
      <p className="mt-1 text-sm text-warm-600">{description}</p>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="email-capture">Email address</label>
        <input
          id="email-capture"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@liberty.village"
          required
          className="flex-1 rounded-lg border border-warm-300 bg-white px-4 py-2.5 text-sm text-warm-900 placeholder:text-warm-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "submitting" ? "Subscribing…" : "Subscribe"}
        </button>
      </form>
      {status === "error" && errorMessage && (
        <p className="mt-2 text-sm text-red-600" role="alert">{errorMessage}</p>
      )}
      <p className="mt-3 text-xs text-warm-500">
        No spam. Unsubscribe any time.
      </p>
    </div>
  );
}
