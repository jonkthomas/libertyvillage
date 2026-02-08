import { test, expect } from "@playwright/test";

test.describe("Images load correctly across all page types", () => {
  test("homepage has hero background image", async ({ page }) => {
    await page.goto("/");

    // Hero section should have an img or background image
    const heroImg = page.locator("section").first().locator("img").first();
    if (await heroImg.count() > 0) {
      await expect(heroImg).toBeVisible();
      // Check image loaded (naturalWidth > 0)
      const naturalWidth = await heroImg.evaluate((el: HTMLImageElement) => el.naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    }
  });

  test("service page has hero image if available", async ({ page }) => {
    await page.goto("/best/restaurants");

    // Check for HeroImage component
    const heroImages = page.locator("img[alt*='Restaurants'], img[alt*='restaurants']");
    if (await heroImages.count() > 0) {
      const firstImg = heroImages.first();
      await expect(firstImg).toBeVisible();
    }
  });

  test("business detail page has image if available", async ({ page }) => {
    await page.goto("/directory/mildreds-temple-kitchen");

    const businessImg = page.locator("img[alt*='Mildred'], img[alt*='mildred']");
    if (await businessImg.count() > 0) {
      await expect(businessImg.first()).toBeVisible();
    }
  });

  test("comparison page has hero image if available", async ({ page }) => {
    await page.goto("/vs/king-west");

    const heroImg = page.locator("img[alt*='King West'], img[alt*='king-west']");
    if (await heroImg.count() > 0) {
      await expect(heroImg.first()).toBeVisible();
    }
  });

  test("guide page has hero image if available", async ({ page }) => {
    await page.goto("/guide/parking-guide");

    const heroImg = page.locator("img[alt*='Parking'], img[alt*='parking']");
    if (await heroImg.count() > 0) {
      await expect(heroImg.first()).toBeVisible();
    }
  });

  test("no broken images on key pages", async ({ page }) => {
    const pages = [
      "/",
      "/best/restaurants",
      "/directory/mildreds-temple-kitchen",
      "/vs/king-west",
      "/guide/parking-guide",
    ];

    for (const url of pages) {
      await page.goto(url);

      // Get all visible img elements
      const images = page.locator("img:visible");
      const count = await images.count();

      for (let i = 0; i < count; i++) {
        const img = images.nth(i);
        const src = await img.getAttribute("src");
        if (src && !src.startsWith("data:")) {
          const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
          expect(naturalWidth, `Broken image on ${url}: ${src}`).toBeGreaterThan(0);
        }
      }
    }
  });

  test("all images have alt text", async ({ page }) => {
    const pages = ["/", "/best/restaurants", "/directory/mildreds-temple-kitchen"];

    for (const url of pages) {
      await page.goto(url);

      const images = page.locator("img:visible");
      const count = await images.count();

      for (let i = 0; i < count; i++) {
        const alt = await images.nth(i).getAttribute("alt");
        expect(alt, `Image missing alt text on ${url}`).toBeTruthy();
      }
    }
  });
});
