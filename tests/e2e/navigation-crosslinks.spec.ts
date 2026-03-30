import { test, expect } from "@playwright/test";

test.describe("Navigation and Cross-Links", () => {
  test("desktop: Best Of dropdown appears on hover and navigates", async ({ page }) => {
    await page.goto("/");

    // Hover over Best Of button
    const bestOfButton = page.locator('button:has-text("Best Of")');
    await bestOfButton.hover();

    // Dropdown should appear
    const dropdown = page.locator('[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Should contain Restaurants link
    const restaurantsLink = dropdown.locator('a[href="/best/restaurants"]');
    await expect(restaurantsLink).toBeVisible();

    // Click navigates to restaurants
    await restaurantsLink.click();
    await expect(page).toHaveURL(/\/best\/restaurants/);
  });

  test("desktop: keyboard navigation of Best Of dropdown", async ({ page }) => {
    await page.goto("/");

    // Tab to Best Of button and press Enter to open
    const bestOfButton = page.locator('button:has-text("Best Of")');
    await bestOfButton.focus();
    await bestOfButton.press("Enter");

    // Dropdown should open
    const dropdown = page.locator('[role="menu"]');
    await expect(dropdown).toBeVisible();

    // Tab to first item
    await page.keyboard.press("Tab");

    // Escape closes dropdown
    await page.keyboard.press("Escape");
    await expect(dropdown).toBeHidden();
  });

  test("blog post shows ExploreCTA and cross-links", async ({ page }) => {
    await page.goto("/blog/fifa-world-cup-2026-liberty-village-survival-guide");

    // ExploreCTA should be visible
    const exploreCta = page.locator('text="Explore Liberty Village"');
    await expect(exploreCta).toBeVisible();

    // Cross-links section
    const crossLinksSection = page.locator('text="Related Services & Guides"');
    await expect(crossLinksSection).toBeVisible();

    // Should have at least 3 cross-links (restaurants, bars, parking-guide, transit-guide = 4)
    const crossLinks = page.locator('text="Related Services & Guides"').locator("..").locator("a");
    expect(await crossLinks.count()).toBeGreaterThanOrEqual(3);
  });

  test("mobile: Best Of section expandable in mobile nav", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    // Open mobile nav
    const menuButton = page.locator('button[aria-label="Open menu"]');
    await menuButton.click();

    // Expand Best Of
    const bestOfButton = page.locator('button:has-text("Best Of")');
    await bestOfButton.click();

    // Service links should appear
    const restaurantsLink = page.locator('nav a[href="/best/restaurants"]');
    await expect(restaurantsLink).toBeVisible();

    // Tap navigates
    await restaurantsLink.click();
    await expect(page).toHaveURL(/\/best\/restaurants/);
  });
});
