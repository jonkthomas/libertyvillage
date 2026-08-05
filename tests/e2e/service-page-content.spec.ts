import { test, expect } from "@playwright/test";

test.describe("Service page content depth", () => {
  const enrichedPages = [
    { slug: "restaurants", heading: "Best Restaurants" },
    { slug: "gyms", heading: "Best Gyms" },
    { slug: "bars", heading: "Best Bars" },
  ];

  for (const { slug, heading } of enrichedPages) {
    test(`/best/${slug} has full content depth`, async ({ page }) => {
      await page.goto(`/best/${slug}`);

      // H1 contains expected heading
      const h1 = page.locator("h1");
      await expect(h1).toContainText(heading);

      // AnswerBlock with data-answer attribute
      const answerBlock = page.locator("section[data-answer=true]");
      await expect(answerBlock).toBeVisible();

      // Comparison table with >=5 rows (desktop view)
      const tableRows = page.locator("table tbody tr");
      await expect(tableRows).toHaveCount(await tableRows.count());
      expect(await tableRows.count()).toBeGreaterThanOrEqual(5);

      // Key takeaways >=5 items
      const takeawayItems = page.locator(".key-takeaways li");
      expect(await takeawayItems.count()).toBeGreaterThanOrEqual(5);

      // Pro tips >=5 items
      const proTipItems = page.locator(".pro-tips li");
      expect(await proTipItems.count()).toBeGreaterThanOrEqual(5);

      // FAQ section >=8 questions (uses <details> elements)
      const faqDetails = page.locator("details");
      expect(await faqDetails.count()).toBeGreaterThanOrEqual(8);
    });
  }

  test("/best/dentists shows its current clinic comparison", async ({ page }) => {
    await page.goto("/best/dentists");
    await expect(page.getByRole("heading", { level: 1, name: /Best Dentists/ })).toBeVisible();

    const table = page.locator("table");
    const viewport = page.viewportSize();
    if (viewport && viewport.width >= 768) {
      await expect(table).toBeVisible();
      expect(await table.locator("tbody tr").count()).toBeGreaterThanOrEqual(2);
    } else {
      await expect(table).toBeHidden();
      const clinicCards = page.locator(".space-y-3.md\\:hidden > div");
      await expect(clinicCards.first()).toBeVisible();
      expect(await clinicCards.count()).toBeGreaterThanOrEqual(2);
    }
  });

  test("comparison table renders as stacked cards at 375px", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await page.goto("/best/restaurants");

    // Desktop table should be hidden
    const table = page.locator("table");
    await expect(table).toBeHidden();

    // Mobile cards should be visible
    const mobileCards = page.locator(".md\\:hidden > div");
    expect(await mobileCards.count()).toBeGreaterThanOrEqual(5);

    await context.close();
  });
});
