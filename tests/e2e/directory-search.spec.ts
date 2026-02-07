import { test, expect } from "@playwright/test";

test.describe("Directory search and filter", () => {
  test("directory page lists all businesses", async ({ page }) => {
    await page.goto("/directory");

    // H1 present
    await expect(page.locator("h1")).toContainText("Business Directory");

    // Count display shows all businesses
    const countText = page.locator("text=/Showing \\d+ of \\d+ businesses/");
    await expect(countText).toBeVisible();

    // Verify full count (should be 68)
    const text = await countText.textContent();
    const match = text?.match(/Showing (\d+) of (\d+)/);
    expect(match).toBeTruthy();
    if (match) {
      expect(Number(match[1])).toEqual(Number(match[2]));
      expect(Number(match[2])).toBeGreaterThanOrEqual(60);
    }
  });

  test("search filters businesses by name", async ({ page }) => {
    await page.goto("/directory");

    // Get initial count
    const countEl = page.locator("text=/Showing \\d+ of \\d+ businesses/");
    const initialText = await countEl.textContent();
    const initialCount = Number(initialText?.match(/Showing (\d+)/)?.[1]);

    // Type in search
    const searchInput = page.getByPlaceholder("Search businesses...");
    await searchInput.fill("Mildred");

    // Wait for filter to apply
    await page.waitForTimeout(300);

    // Count should decrease
    const filteredText = await countEl.textContent();
    const filteredCount = Number(filteredText?.match(/Showing (\d+)/)?.[1]);
    expect(filteredCount).toBeLessThan(initialCount);
    expect(filteredCount).toBeGreaterThanOrEqual(1);

    // Should show Mildred's
    await expect(page.locator("h3").filter({ hasText: "Mildred" }).first()).toBeVisible();
  });

  test("clearing search restores full list", async ({ page }) => {
    await page.goto("/directory");

    const countEl = page.locator("text=/Showing \\d+ of \\d+ businesses/");
    const initialText = await countEl.textContent();

    // Search then clear
    const searchInput = page.getByPlaceholder("Search businesses...");
    await searchInput.fill("Mildred");
    await page.waitForTimeout(300);
    await searchInput.fill("");
    await page.waitForTimeout(300);

    // Count should return to initial
    const restoredText = await countEl.textContent();
    expect(restoredText).toEqual(initialText);
  });

  test("category filter shows only matching businesses", async ({ page }) => {
    await page.goto("/directory");

    const countEl = page.locator("text=/Showing \\d+ of \\d+ businesses/");
    const initialText = await countEl.textContent();
    const totalCount = Number(initialText?.match(/of (\d+)/)?.[1]);

    // Click a category filter button — use exact name to avoid matching "Sushi Restaurants" etc.
    const coffeeButton = page.getByRole("button", { name: /☕ Coffee Shops/i });
    await coffeeButton.click();
    await page.waitForTimeout(300);

    // Showing count should be less than total
    const filteredText = await countEl.textContent();
    const filteredCount = Number(filteredText?.match(/Showing (\d+)/)?.[1]);
    expect(filteredCount).toBeLessThan(totalCount);
    expect(filteredCount).toBeGreaterThanOrEqual(1);
  });

  test("clicking business card navigates to detail page", async ({ page }) => {
    await page.goto("/directory");

    // Click first business card
    const businessCard = page.locator("a[href^='/directory/']").first();
    const businessName = await businessCard.locator("h3").textContent();
    await businessCard.click();

    // Should navigate to detail page
    await expect(page).toHaveURL(/\/directory\/[a-z-]+$/);

    // Business name should be in h1
    if (businessName) {
      await expect(page.locator("h1")).toContainText(businessName.trim());
    }
  });

  test("business detail has link back to service category", async ({ page }) => {
    await page.goto("/directory/mildreds-temple-kitchen");

    // Should have a link to the /best/ page for its category
    const categoryLink = page.locator("a[href^='/best/']");
    await expect(categoryLink.first()).toBeVisible();

    // Click the "See all" link at the bottom
    const seeAllLink = page.locator("a:has-text('See all')").filter({ hasText: "Liberty Village" });
    if (await seeAllLink.count() > 0) {
      await seeAllLink.first().click();
      await expect(page).toHaveURL(/\/best\//);
    }
  });
});
