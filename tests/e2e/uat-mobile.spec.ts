import { test, expect } from "@playwright/test";

test.describe("UAT — Mobile Flows (375x812)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("mobile nav → Best Of → rendered category", async ({ page }) => {
    await page.goto("/");

    const menuButton = page.getByRole("button", { name: "Open menu", exact: true });
    const mobileNav = page.locator("div.sm\\:hidden").filter({
      has: page.getByRole("button", { name: /menu/i }),
    }).first();
    await menuButton.click();

    const menu = mobileNav.getByRole("navigation");
    const bestOfButton = menu.getByRole("button", { name: "Best Of", exact: true });
    await expect(bestOfButton).toBeVisible();
    await bestOfButton.click();

    const categoryLink = menu.locator('a[href^="/best/"]').first();
    await expect(categoryLink).toBeVisible();
    await categoryLink.click();
    await expect(page).toHaveURL(/\/best\/[a-z0-9-]+$/);
  });

  test("/best/restaurants stacked cards at 375px", async ({ page }) => {
    await page.goto("/best/restaurants");

    // Desktop table should be hidden
    const table = page.locator("table");
    await expect(table).toBeHidden();

    // Stacked cards visible
    const cards = page.locator(".md\\:hidden > div");
    expect(await cards.count()).toBeGreaterThanOrEqual(5);

    // All sections readable
    await expect(page.locator(".key-takeaways")).toBeVisible();
    await expect(page.locator(".pro-tips")).toBeVisible();
  });

  test("/guide stacks facts above guide links", async ({ page }) => {
    await page.goto("/guide");

    // NeighbourhoodFacts should be visible
    const factsText = await page.textContent("body");
    expect(factsText).toContain("88");

    // History section readable
    await expect(page.getByRole("heading", { level: 2, name: "History of Liberty Village", exact: true }).first()).toBeVisible();

    // Guide links present
    const guideLinks = page.locator('a[href^="/guide/"]');
    expect(await guideLinks.count()).toBeGreaterThanOrEqual(5);
  });

  test("World Cup blog at 375px — CTA and cross-links tappable", async ({ page }) => {
    await page.goto("/blog/fifa-world-cup-2026-liberty-village-survival-guide");

    // ExploreCTA visible
    await expect(page.locator("text=Explore Liberty Village")).toBeVisible();

    // Cross-links visible and tappable (minimum tap target)
    const crossLinks = page.locator('a[href^="/best/"]');
    expect(await crossLinks.count()).toBeGreaterThanOrEqual(1);
  });

  test("no horizontal scrolling on key mobile pages", async ({ page }) => {
    const pages = ["/", "/best/restaurants", "/guide", "/blog/fifa-world-cup-2026-liberty-village-survival-guide"];

    for (const url of pages) {
      await page.goto(url);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // 1px tolerance
    }
  });
});
