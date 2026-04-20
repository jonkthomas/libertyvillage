"use client";

import { useState } from "react";

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
    if (!email.includes("@")) {
      setErrorMessage("Please enter a valid email.");
      setStatus("error");
      return;
    }
    if (!endpoint) {
      // No endpoint configured — soft success for dev environments
      setStatus("success");
      return;
    }
    setStatus("submitting");
    setErrorMessage("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setStatus("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
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
        <p className="mt-2 text-sm text-red-600">{errorMessage}</p>
      )}
      <p className="mt-3 text-xs text-warm-500">
        No spam. Unsubscribe any time.
      </p>
    </div>
  );
}
