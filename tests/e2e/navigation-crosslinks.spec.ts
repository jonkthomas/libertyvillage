import { test, expect } from "@playwright/test";

test.describe("Navigation and Cross-Links", () => {
  test("desktop: Best Of dropdown appears on hover and navigates", async ({ page }, testInfo) => {
    if (testInfo.project.name === "mobile-chromium") {
      test.skip();
      return;
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const bestOfButton = page.getByRole("button", { name: "Best Of", exact: true });
    await expect(bestOfButton).toBeVisible();
    await bestOfButton.hover();

    const dropdown = page.getByRole("menu");
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    const categoryLink = dropdown.getByRole("menuitem").first();
    const href = await categoryLink.getAttribute("href");
    expect(href).toMatch(/^\/best\/[a-z0-9-]+$/);

    await categoryLink.click();
    await expect(page).toHaveURL(/\/best\/[a-z0-9-]+$/);
  });

  test("desktop: keyboard navigation of Best Of dropdown", async ({ page }, testInfo) => {
    if (testInfo.project.name === "mobile-chromium") {
      test.skip();
      return;
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const bestOfButton = page.getByRole("button", { name: "Best Of", exact: true });
    await bestOfButton.focus();
    await bestOfButton.press("Enter");

    const dropdown = page.getByRole("menu");
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    await page.keyboard.press("Escape");
    await expect(dropdown).toBeHidden();
  });

  test("blog post shows ExploreCTA and cross-links", async ({ page }) => {
    await page.goto("/blog/fifa-world-cup-2026-liberty-village-survival-guide");

    const exploreCta = page.getByText("Explore Liberty Village", { exact: true }).first();
    await expect(exploreCta).toBeVisible({ timeout: 5000 });

    const mainContent = page.locator("main");
    const restaurantsLink = mainContent.locator('a[href="/best/restaurants"]').first();
    await expect(restaurantsLink).toBeVisible();
  });

  test("mobile: Best Of section expandable in mobile nav", async ({ page }, testInfo) => {
    if (testInfo.project.name === "desktop-chromium") {
      test.skip();
      return;
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const menuButton = page.getByRole("button", { name: "Open menu", exact: true });
    const mobileNav = page.locator("div.sm\\:hidden").filter({
      has: page.getByRole("button", { name: /menu/i }),
    }).first();
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    const menu = mobileNav.getByRole("navigation");
    const bestOfButton = menu.getByRole("button", { name: "Best Of", exact: true });
    await expect(bestOfButton).toBeVisible({ timeout: 3000 });
    await bestOfButton.click();

    const categoryLink = menu.locator('a[href^="/best/"]').first();
    await expect(categoryLink).toBeVisible({ timeout: 3000 });
    await categoryLink.click();
    await expect(page).toHaveURL(/\/best\/[a-z0-9-]+$/);
  });
});
