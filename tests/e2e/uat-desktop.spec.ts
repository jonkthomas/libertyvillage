import { test, expect } from "@playwright/test";

test.describe("UAT — Desktop Flows", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("homepage has Organization schema JSON-LD", async ({ page }) => {
    await page.goto("/");
    const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
    const hasOrg = scripts.some((s) => s.includes('"@type":"Organization"') || s.includes('"@type": "Organization"'));
    expect(hasOrg).toBe(true);
  });

  test("Best Of dropdown → click Restaurants", async ({ page }) => {
    await page.goto("/");

    // Hover Best Of trigger
    const bestOf = page.locator("button", { hasText: "Best Of" });
    await bestOf.hover();

    // Dropdown appears with Restaurants link
    const dropdown = page.locator('[role="menu"]');
    await expect(dropdown).toBeVisible();
    const restaurantsLink = dropdown.locator('a[href="/best/restaurants"]');
    await expect(restaurantsLink).toBeVisible();

    // Click Restaurants
    await restaurantsLink.click();
    await expect(page).toHaveURL(/\/best\/restaurants/);

    // Verify content depth
    await expect(page.locator("table")).toBeVisible();
    expect(await page.locator(".key-takeaways li").count()).toBeGreaterThanOrEqual(5);
    expect(await page.locator(".pro-tips li").count()).toBeGreaterThanOrEqual(5);
    expect(await page.locator("details").count()).toBeGreaterThanOrEqual(8);
  });

  test("/best/gyms has comparison table with monthly costs", async ({ page }) => {
    await page.goto("/best/gyms");
    const table = page.locator("table");
    await expect(table).toBeVisible();
    const tableText = await table.textContent();
    expect(tableText).toContain("Monthly");
  });

  test("/best/bars has content depth", async ({ page }) => {
    await page.goto("/best/bars");
    await expect(page.locator("table")).toBeVisible();
    await expect(page.locator(".pro-tips")).toBeVisible();
    expect(await page.locator("details").count()).toBeGreaterThanOrEqual(8);
  });

  test("/guide has facts sidebar, history, pros/cons, guide links", async ({ page }) => {
    await page.goto("/guide");

    // Facts sidebar with Walk Score
    const factsText = await page.textContent("body");
    expect(factsText).toContain("88");

    // History section
    await expect(page.locator("h2", { hasText: "History" })).toBeVisible();

    // Pros/cons
    await expect(page.locator("h3", { hasText: "Pros" })).toBeVisible();
    await expect(page.locator("h3", { hasText: "Cons" })).toBeVisible();

    // Guide links preserved
    const guideLinks = page.locator('a[href^="/guide/"]');
    expect(await guideLinks.count()).toBeGreaterThanOrEqual(5);
  });

  test("World Cup blog has ExploreCTA and cross-links", async ({ page }) => {
    await page.goto("/blog/fifa-world-cup-2026-liberty-village-survival-guide");

    // ExploreCTA visible
    await expect(page.locator("text=Explore Liberty Village")).toBeVisible();

    // Cross-links section
    const crossLinks = page.locator('a[href^="/best/"]');
    expect(await crossLinks.count()).toBeGreaterThanOrEqual(1);
  });

  test("no console errors on key pages", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    const pages = ["/", "/best/restaurants", "/guide", "/blog/fifa-world-cup-2026-liberty-village-survival-guide"];
    for (const url of pages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
    }

    // Filter out known non-critical errors (e.g., favicon 404)
    const criticalErrors = errors.filter((e) => !e.includes("favicon") && !e.includes("404"));
    expect(criticalErrors).toHaveLength(0);
  });
});
