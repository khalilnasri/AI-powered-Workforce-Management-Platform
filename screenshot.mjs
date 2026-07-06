import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

// Login first
await page.goto("http://localhost:5173/login");
await page.waitForLoadState("networkidle");
await page.fill('input[type="email"]', "med@gmail.com");
await page.fill('input[type="password"]', "123456789");
await page.click('button[type="submit"]');
await page.waitForTimeout(3000);
await page.screenshot({ path: "mobile-dashboard.png", fullPage: false });
console.log("Screenshot saved: mobile-dashboard.png");

// Click Planung tab (3rd item, index 2)
await page.locator('.mb-nav__item').nth(2).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "mobile-planung-schichten.png", fullPage: false });
console.log("Screenshot saved: mobile-planung-schichten.png");

// Click Urlaub sub-tab
await page.locator('.mb-planung-tab').nth(1).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: "mobile-planung-urlaub.png", fullPage: false });
console.log("Screenshot saved: mobile-planung-urlaub.png");

await browser.close();
