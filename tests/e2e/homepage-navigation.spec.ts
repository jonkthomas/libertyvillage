import { test, expect } from "@playwright/test";

test.describe("Homepage and navigation flow", () => {
  test("homepage loads with correct heading and content", async ({ page }) => {
    await page.goto("/");
    const h1 = page.getByRole("heading", { level: 1, name: /Discover Liberty Village/ });
    await expect(h1).toBeVisible();

    // Stat bar shows key numbers
    await expect(page.getByText("9,000+")).toBeVisible();
    await expect(page.getByText("Residents", { exact: true })).toBeVisible();

    // Current category grid exposes its service links.
    const interestsHeading = page.getByRole("heading", { level: 2, name: "Explore by Interest", exact: true });
    await expect(interestsHeading).toBeVisible();
    const categoryLinks = interestsHeading.locator("xpath=ancestor::section").locator('a[href^="/best/"]');
    await expect(categoryLinks.first()).toBeVisible();
    expect(await categoryLinks.count()).toBeGreaterThanOrEqual(6);
  });

  test("navigate from homepage to service page", async ({ page }) => {
    await page.goto("/");

    const interestsHeading = page.getByRole("heading", { level: 2, name: "Explore by Interest", exact: true });
    const categoryLink = interestsHeading.locator("xpath=ancestor::section").locator('a[href^="/best/"]').first();
    const href = await categoryLink.getAttribute("href");
    expect(href).toMatch(/^\/best\/[a-z0-9-]+$/);
    await categoryLink.click();

    await expect(page).toHaveURL(new RegExp(`${href}$`));

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

    // Follow a known business link rendered in the service content.
    const businessCard = page.getByRole("link", {
      name: "Mildred's Temple Kitchen",
      exact: true,
    }).first();
    await expect(businessCard).toBeVisible();
    await businessCard.click();

    // Should be on the matching directory detail page with the business heading.
    await expect(page).toHaveURL(/\/directory\/mildreds-temple-kitchen$/);
    await expect(page.locator("h1")).toContainText("Mildred's Temple Kitchen");

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

    // Quick tips and guide content headings should be present without ambiguous text matches.
    await expect(page.getByRole("heading", { level: 2, name: "Quick Tips", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 }).filter({ hasNotText: "Quick Tips" }).first()).toBeVisible();

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

  test("Canadian locale (en-CA) present on every page type", async ({ page }) => {
    const pages = [
      "/",
      "/best/restaurants",
      "/vs/king-west",
      "/directory/mildreds-temple-kitchen",
      "/guide/parking-guide",
    ];

    for (const url of pages) {
      await page.goto(url);
      const content = await page.content();
      expect(content, `Expected en-CA or en_CA on ${url}`).toMatch(/en.CA/);
    }
  });
});
