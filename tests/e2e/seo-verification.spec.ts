import { test, expect } from "@playwright/test";

test.describe("SEO and sitemap verification", () => {
  test("sitemap.xml is valid and contains 145+ URLs", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain("<?xml");
    expect(body).toContain("<urlset");

    // Count <url> entries
    const urlCount = (body.match(/<url>/g) || []).length;
    expect(urlCount).toBeGreaterThanOrEqual(145);

    // Should contain all page patterns
    expect(body).toContain("/best/");
    expect(body).toContain("/vs/");
    expect(body).toContain("/directory/");
    expect(body).toContain("/guide/");
  });

  test("robots.txt references sitemap", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain("Sitemap:");
    expect(body).toContain("libertyvillage.co/sitemap.xml");
  });

  test("service page has complete SEO elements", async ({ page }) => {
    await page.goto("/best/restaurants");

    // Title tag contains service name and Liberty Village
    const title = await page.title();
    expect(title.toLowerCase()).toContain("restaurant");
    expect(title.toLowerCase()).toContain("liberty village");

    // Meta description exists and is reasonable length
    const metaDesc = await page.getAttribute('meta[name="description"]', "content");
    expect(metaDesc).toBeTruthy();
    expect(metaDesc!.length).toBeGreaterThanOrEqual(80);
    expect(metaDesc!.length).toBeLessThanOrEqual(200);

    // JSON-LD with ItemList
    const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
    const hasItemList = schemas.some((s) => s.includes("ItemList"));
    expect(hasItemList).toBe(true);

    // JSON-LD with FAQPage
    const hasFAQ = schemas.some((s) => s.includes("FAQPage"));
    expect(hasFAQ).toBe(true);

    // Canonical URL present
    const canonical = await page.getAttribute('link[rel="canonical"]', "href");
    expect(canonical).toBeTruthy();
    expect(canonical).toContain("/best/restaurants");

    // OG tags
    const ogTitle = await page.getAttribute('meta[property="og:title"]', "content");
    expect(ogTitle).toBeTruthy();

    const ogDesc = await page.getAttribute('meta[property="og:description"]', "content");
    expect(ogDesc).toBeTruthy();
  });

  test("comparison page has Article schema", async ({ page }) => {
    await page.goto("/vs/king-west");

    const title = await page.title();
    expect(title.toLowerCase()).toContain("liberty village");
    expect(title.toLowerCase()).toContain("king west");

    const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
    const hasArticle = schemas.some((s) => s.includes("Article"));
    expect(hasArticle).toBe(true);

    // Canonical
    const canonical = await page.getAttribute('link[rel="canonical"]', "href");
    expect(canonical).toContain("/vs/king-west");

    // OG tags
    const ogTitle = await page.getAttribute('meta[property="og:title"]', "content");
    expect(ogTitle).toBeTruthy();
  });

  test("business detail page has LocalBusiness schema", async ({ page }) => {
    await page.goto("/directory/mildreds-temple-kitchen");

    const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
    const hasLocalBusiness = schemas.some((s) => s.includes("LocalBusiness"));
    expect(hasLocalBusiness).toBe(true);

    // Canonical
    const canonical = await page.getAttribute('link[rel="canonical"]', "href");
    expect(canonical).toContain("/directory/mildreds-temple-kitchen");
  });

  test("guide page has Article schema", async ({ page }) => {
    await page.goto("/guide/parking-guide");

    const title = await page.title();
    expect(title.toLowerCase()).toContain("parking");

    const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
    const hasArticle = schemas.some((s) => s.includes("Article"));
    expect(hasArticle).toBe(true);

    // Canonical
    const canonical = await page.getAttribute('link[rel="canonical"]', "href");
    expect(canonical).toContain("/guide/parking-guide");
  });

  test("homepage has WebSite schema", async ({ page }) => {
    await page.goto("/");

    const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
    const hasWebSite = schemas.some((s) => s.includes("WebSite"));
    expect(hasWebSite).toBe(true);

    // Canonical
    const canonical = await page.getAttribute('link[rel="canonical"]', "href");
    expect(canonical).toBeTruthy();
  });
});
