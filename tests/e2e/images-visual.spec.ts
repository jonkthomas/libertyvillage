import { test, expect, type Locator } from "@playwright/test";

async function expectLoadedImage(image: Locator, pageUrl: string) {
  await image.scrollIntoViewIfNeeded();
  const src = await image.getAttribute("src");
  await expect
    .poll(
      () => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
      { message: `Broken image on ${pageUrl}: ${src ?? "missing src"}`, timeout: 10_000 },
    )
    .toBe(true);
}

test.describe("Images load correctly across all page types", () => {
  test("homepage has hero background image", async ({ page }) => {
    await page.goto("/");

    const heroImg = page.locator("section").first().locator("img").first();
    if (await heroImg.count() > 0) {
      await expect(heroImg).toBeVisible();
      await expectLoadedImage(heroImg, "/");
    }
  });

  test("service page has hero image if available", async ({ page }) => {
    await page.goto("/best/restaurants");

    const heroImages = page.locator("img[alt*='Restaurants'], img[alt*='restaurants']");
    if (await heroImages.count() > 0) {
      const firstImg = heroImages.first();
      await expect(firstImg).toBeVisible();
      await expectLoadedImage(firstImg, "/best/restaurants");
    }
  });

  test("business detail page has image if available", async ({ page }) => {
    await page.goto("/directory/mildreds-temple-kitchen");

    const businessImg = page.locator("img[alt*='Mildred'], img[alt*='mildred']");
    if (await businessImg.count() > 0) {
      await expect(businessImg.first()).toBeVisible();
      await expectLoadedImage(businessImg.first(), "/directory/mildreds-temple-kitchen");
    }
  });

  test("comparison page has hero image if available", async ({ page }) => {
    await page.goto("/vs/king-west");

    const heroImg = page.locator("img[alt*='King West'], img[alt*='king-west']");
    if (await heroImg.count() > 0) {
      await expect(heroImg.first()).toBeVisible();
      await expectLoadedImage(heroImg.first(), "/vs/king-west");
    }
  });

  test("guide page has hero image if available", async ({ page }) => {
    await page.goto("/guide/parking-guide");

    const heroImg = page.locator("img[alt*='Parking'], img[alt*='parking']");
    if (await heroImg.count() > 0) {
      await expect(heroImg.first()).toBeVisible();
      await expectLoadedImage(heroImg.first(), "/guide/parking-guide");
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
      const images = page.locator("img:visible");
      const count = await images.count();

      for (let i = 0; i < count; i++) {
        const image = images.nth(i);
        const src = await image.getAttribute("src");
        if (src && !src.startsWith("data:")) await expectLoadedImage(image, url);
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
