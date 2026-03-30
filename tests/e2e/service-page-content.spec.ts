import { test, expect } from "@playwright/test";

test.describe("Service Page Content Depth", () => {
  test("restaurants page has all enriched content sections", async ({ page }) => {
    await page.goto("/best/restaurants");

    // H1
    const h1 = page.locator("h1");
    await expect(h1).toContainText("Best Restaurants");

    // AnswerBlock (now a section with data-answer)
    const answerBlock = page.locator("section[data-answer=true]");
    await expect(answerBlock).toBeVisible();

    // Comparison table with >=5 rows
    const tableRows = page.locator("table tbody tr");
    await expect(tableRows).toHaveCount(await tableRows.count());
    expect(await tableRows.count()).toBeGreaterThanOrEqual(5);

    // Key takeaways with >=5 items
    const takeaways = page.locator(".key-takeaways li");
    expect(await takeaways.count()).toBeGreaterThanOrEqual(5);

    // Pro tips with >=5 items
    const proTips = page.locator(".pro-tips li");
    expect(await proTips.count()).toBeGreaterThanOrEqual(5);

    // FAQ section with >=8 questions
    const faqItems = page.locator("details");
    expect(await faqItems.count()).toBeGreaterThanOrEqual(8);
  });

  test("gyms page has enriched content", async ({ page }) => {
    await page.goto("/best/gyms");

    const answerBlock = page.locator("section[data-answer=true]");
    await expect(answerBlock).toBeVisible();

    const tableRows = page.locator("table tbody tr");
    expect(await tableRows.count()).toBeGreaterThanOrEqual(5);

    const takeaways = page.locator(".key-takeaways li");
    expect(await takeaways.count()).toBeGreaterThanOrEqual(5);
  });

  test("bars page has enriched content", async ({ page }) => {
    await page.goto("/best/bars");

    const answerBlock = page.locator("section[data-answer=true]");
    await expect(answerBlock).toBeVisible();

    const tableRows = page.locator("table tbody tr");
    expect(await tableRows.count()).toBeGreaterThanOrEqual(5);
  });

  test("dentists page does NOT show comparison table (backward compat)", async ({ page }) => {
    await page.goto("/best/dentists");

    // Should have no comparison table
    const table = page.locator("table");
    await expect(table).toHaveCount(0);

    // Should still have basic content
    const h1 = page.locator("h1");
    await expect(h1).toContainText("Best Dentists");
  });

  test("mobile: restaurants comparison renders as stacked cards", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/best/restaurants");

    // On mobile, the table should be hidden
    const table = page.locator("table");
    await expect(table).toBeHidden();

    // Stacked cards should be visible
    const cards = page.locator(".md\\:hidden > div");
    expect(await cards.count()).toBeGreaterThanOrEqual(5);
  });
});
