import { test, expect } from "@playwright/test";

test.describe("Homepage and navigation flow", () => {
  test("homepage loads with correct heading and content", async ({ page }) => {
    await page.goto("/");
    const h1 = page.locator("h1");
    await expect(h1).toContainText("Liberty Village");

    // Stat bar shows key numbers
    await expect(page.getByText("9,000+")).toBeVisible();
    await expect(page.getByText("Residents")).toBeVisible();

    // Quick links grid has 8 service cards
    const serviceCards = page.locator("h2:has-text('Explore Liberty Village') + p + div a");
    await expect(serviceCards.first()).toBeVisible();
    const count = await serviceCards.count();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test("navigate from homepage to service page", async ({ page }) => {
    await page.goto("/");

    // Click a service card (first one in the grid)
    const serviceLink = page.locator("h2:has-text('Explore Liberty Village') + p + div a").first();
    await serviceLink.click();

    // Should be on a /best/ page
    await expect(page).toHaveURL(/\/best\//);

    // Service page should have an h1
    const h1 = page.locator("h1");
    await expect(h1).toContainText("Liberty Village");

    // Should have business cards
    const businessCards = page.locator("a[href^='/directory/']");
    await expect(businessCards.first()).toBeVisible();

    // Should have FAQ section
    await expect(page.locator("details").first()).toBeVisible();
  });

  test("navigate from service page to business detail", async ({ page }) => {
    await page.goto("/best/restaurants");

    // Click a business card
    const businessCard = page.locator("a[href^='/directory/']").first();
    const businessName = await businessCard.locator("h3").textContent();
    await businessCard.click();

    // Should be on a /directory/ detail page
    await expect(page).toHaveURL(/\/directory\/[a-z-]+$/);

    // Business name should appear in h1
    if (businessName) {
      await expect(page.locator("h1")).toContainText(businessName.trim());
    }

    // Should have rating, description, and details
    await expect(page.getByText("reviews)").first()).toBeVisible();
    await expect(page.locator("text=Address").first()).toBeVisible();
    await expect(page.getByText("Hours", { exact: true }).first()).toBeVisible();
  });

  test("comparison page loads with correct structure", async ({ page }) => {
    await page.goto("/vs/king-west");

    // H1 should mention both neighborhoods
    const h1 = page.locator("h1");
    await expect(h1).toContainText("Liberty Village");
    await expect(h1).toContainText("King West");

    // Comparison table (desktop) or mobile cards — at least one should be visible
    const viewport = page.viewportSize();
    if (viewport && viewport.width >= 640) {
      await expect(page.locator("table").first()).toBeVisible();
    } else {
      // Mobile shows comparison cards instead of table
      await expect(page.locator("h2").first()).toBeVisible();
    }

    // FAQ section should be present
    await expect(page.locator("details").first()).toBeVisible();
  });

  test("guide page loads with correct structure", async ({ page }) => {
    await page.goto("/guide/parking-guide");

    // H1 should mention topic
    const h1 = page.locator("h1");
    await expect(h1).toContainText("Parking");

    // Quick tips box should be present
    await expect(page.getByText("Quick Tips")).toBeVisible();

    // Content should be rendered
    await expect(page.locator("h2").first()).toBeVisible();

    // FAQ section
    await expect(page.locator("details").first()).toBeVisible();
  });

  test("JSON-LD schema exists on every page type", async ({ page }) => {
    const pages = [
      "/",
      "/best/restaurants",
      "/vs/king-west",
      "/directory/mildreds-temple-kitchen",
      "/guide/parking-guide",
    ];

    for (const url of pages) {
      await page.goto(url);
      const schemas = page.locator('script[type="application/ld+json"]');
      const count = await schemas.count();
      expect(count, `Expected JSON-LD on ${url}`).toBeGreaterThanOrEqual(1);
    }
  });

  test("hreflang en-CA present on every page type", async ({ page }) => {
    const pages = [
      "/",
      "/best/restaurants",
      "/vs/king-west",
      "/directory/mildreds-temple-kitchen",
      "/guide/parking-guide",
    ];

    for (const url of pages) {
      await page.goto(url);
      const hreflang = page.locator('link[hreflang="en-CA"], link[hreflang="en-ca"]');
      const count = await hreflang.count();
      expect(count, `Expected hreflang en-CA on ${url}`).toBeGreaterThanOrEqual(1);
    }
  });
});
