import { expect, test, type Page, type Request } from "@playwright/test";

interface CapturedEvent {
  uuid?: string;
  event: string;
  properties: Record<string, unknown>;
}

function decodePostHogEvents(request: Request): CapturedEvent[] {
  if (!request.url().includes("/e")) return [];
  const body = request.postData();
  if (!body) return [];

  const data = body.startsWith("{") ? body : new URLSearchParams(body).get("data");
  if (!data) return [];
  try {
    const parsed = JSON.parse(data) as CapturedEvent | { batch?: CapturedEvent[] };
    if ("batch" in parsed && Array.isArray(parsed.batch)) return parsed.batch;
    return "event" in parsed ? [parsed] : [];
  } catch {
    return [];
  }
}

async function collectPostHogEvents(page: Page) {
  const events: CapturedEvent[] = [];
  await page.route("https://www.googletagmanager.com/**", (route) => route.abort());
  await page.route("https://www.google-analytics.com/**", (route) => route.abort());
  await page.route("https://us.i.posthog.com/**", async (route) => {
    events.push(...decodePostHogEvents(route.request()));
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  return events;
}

test.describe("privacy-safe analytics", () => {
  test("captures deterministic page, landing, and business CTA events without contact data", async ({ page }) => {
    test.skip(!process.env.NEXT_PUBLIC_POSTHOG_KEY, "requires the browser-safe test project key");

    const events = await collectPostHogEvents(page);
    await page.goto("/?utm_source=Google&utm_medium=organic&utm_campaign=parking&email=private@example.com", {
      referer: "https://www.google.ca/search?q=private+search",
    });

    await expect.poll(() => events.filter((event) => event.event === "$pageview").length).toBe(1);
    await expect.poll(() => events.filter((event) => event.event === "site_landing").length).toBe(1);

    const secondTab = await page.context().newPage();
    const secondTabEvents = await collectPostHogEvents(secondTab);
    await secondTab.goto("/");
    await expect
      .poll(() => secondTabEvents.filter((event) => event.event === "site_landing").length)
      .toBe(1);
    await secondTab.close();

    await page.locator('a[href="/directory"]:visible').first().click();
    await expect(page).toHaveURL(/\/directory$/);
    await expect.poll(() => events.filter((event) => event.event === "$pageview").length).toBe(2);
    expect(events.filter((event) => event.event === "site_landing")).toHaveLength(1);

    await page.reload();
    await expect.poll(() => events.filter((event) => event.event === "$pageview").length).toBe(3);
    expect(events.filter((event) => event.event === "site_landing")).toHaveLength(1);

    await page.goto("/directory/local-public-eatery-liberty-village");
    const website = page.locator('[data-contact-type="website"]');
    const websiteDestination = await website.getAttribute("href");
    await website.evaluate((element) => {
      element.addEventListener("click", (event) => event.preventDefault(), { once: true });
    });
    await website.click();

    const phone = page.locator('[data-contact-type="phone"]');
    const phoneDestination = await phone.getAttribute("href");
    await phone.evaluate((element) => {
      element.addEventListener("click", (event) => event.preventDefault(), { once: true });
    });
    await phone.click();

    await expect
      .poll(() => events.filter((event) => event.event === "business_contact_clicked").length)
      .toBe(2);

    const landing = events.find((event) => event.event === "site_landing");
    expect(landing?.properties).toMatchObject({
      channel: "organic_search",
      referrer_host: "google.ca",
      deployment_environment: "preview",
      site_hostname: "localhost",
    });

    const contacts = events.filter((event) => event.event === "business_contact_clicked");
    expect(contacts.map((event) => event.properties.contact_type).sort()).toEqual(["phone", "website"]);
    for (const contact of contacts) {
      expect(contact.properties).toMatchObject({
        business_slug: "local-public-eatery-liberty-village",
        business_category: "restaurants",
        distinct_id: "anonymous",
      });
    }

    expect(new Set(events.map((event) => event.uuid)).size).toBe(events.length);
    expect(new Set(events.map((event) => event.properties.$insert_id)).size).toBe(events.length);
    for (const event of events) {
      expect(event.uuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(event.properties.$insert_id).toEqual(expect.any(String));
      expect(event.properties).toMatchObject({
        deployment_environment: "preview",
        site_hostname: "localhost",
        distinct_id: "anonymous",
        $process_person_profile: false,
      });
    }

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("private+search");
    expect(serialized).not.toContain("+1 416");
    expect(websiteDestination).toBeTruthy();
    expect(phoneDestination).toBeTruthy();
    expect(serialized).not.toContain(websiteDestination!);
    expect(serialized).not.toContain(phoneDestination!);
    expect(serialized).not.toContain("Visit Website");
    expect(serialized).not.toContain("$device_id");
    expect(serialized).not.toContain("$session_id");
    expect(serialized).not.toContain("$window_id");
    expect(serialized).not.toContain("utm_campaign");
    expect(serialized).not.toContain("utm_source");
  });

  test("newsletter fails closed when no subscription endpoint is configured", async ({ page }) => {
    test.skip(Boolean(process.env.NEXT_PUBLIC_EMAIL_CAPTURE_URL), "requires no subscription endpoint");
    const events = await collectPostHogEvents(page);
    await page.goto("/blog/fifa-world-cup-2026-liberty-village-survival-guide");
    await page.getByLabel("Email address").fill("reader@example.com");
    await page.getByRole("button", { name: "Subscribe" }).click();

    await expect(page.getByText("Subscriptions are temporarily unavailable.")).toBeVisible();
    await expect(page.getByText("You're on the list.")).toHaveCount(0);

    if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      await expect
        .poll(() => events.filter((event) => event.event === "newsletter_signup_failed").length)
        .toBe(1);
      const failure = events.find((event) => event.event === "newsletter_signup_failed");
      expect(failure?.properties).toMatchObject({
        reason: "not_configured",
        source: "blog:fifa-world-cup-2026-liberty-village-survival-guide",
      });
      expect(JSON.stringify(failure)).not.toContain("reader@example.com");
    }
  });

  test("newsletter accepts only 2xx JSON with success true", async ({ page }) => {
    const endpoint = process.env.NEXT_PUBLIC_EMAIL_CAPTURE_URL;
    test.skip(!endpoint, "requires the safe intercepted subscription endpoint");

    const events = await collectPostHogEvents(page);
    let responseCase: "false-json" | "wrong-content-type" | "http-error" | "success" = "false-json";
    await page.route(endpoint!, async (route) => {
      if (responseCase === "wrong-content-type") {
        await route.fulfill({ status: 200, contentType: "text/plain", body: '{"success":true}' });
        return;
      }
      await route.fulfill({
        status: responseCase === "http-error" ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify({ success: responseCase === "http-error" || responseCase === "success" }),
      });
    });

    await page.goto("/blog/fifa-world-cup-2026-liberty-village-survival-guide");
    const input = page.getByLabel("Email address");
    const submit = page.getByRole("button", { name: "Subscribe" });
    await input.fill("reader@example.com");
    await submit.click();
    await expect(page.locator('p[role="alert"]')).toContainText("couldn't subscribe");

    responseCase = "wrong-content-type";
    await submit.click();
    await expect(page.locator('p[role="alert"]')).toContainText("couldn't subscribe");

    responseCase = "http-error";
    await submit.click();
    await expect(page.locator('p[role="alert"]')).toContainText("couldn't subscribe");

    responseCase = "success";
    await submit.click();
    await expect(page.getByText("You're on the list.")).toBeVisible();

    if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      await expect
        .poll(() => events.filter((event) => event.event === "newsletter_signup_failed").length)
        .toBe(3);
      await expect
        .poll(() => events.filter((event) => event.event === "newsletter_signup_succeeded").length)
        .toBe(1);
      expect(JSON.stringify(events)).not.toContain("reader@example.com");
    }
  });
});
