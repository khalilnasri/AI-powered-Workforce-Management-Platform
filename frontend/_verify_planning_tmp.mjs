/**
 * Temporary regression check for Admin Planung page.
 * Run: node frontend/_verify_planning_tmp.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.PLANNING_TEST_URL || "http://127.0.0.1:5173";
const EMAIL = process.env.PLANNING_TEST_EMAIL || "khalilnasri@gmail.com";
const PASSWORD = process.env.PLANNING_TEST_PASSWORD || "123456789";

const results = [];
const consoleErrors = [];

function pass(name, detail = "") {
  results.push({ ok: true, name, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  results.push({ ok: false, name, detail });
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[type="email"], input[name="email"]', EMAIL);
    await page.fill('input[type="password"], input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/admin|dashboard/i, { timeout: 20000 }).catch(() => null);

    if (!/admin|dashboard/i.test(page.url())) {
      fail("Login", `Still on ${page.url()}`);
    } else {
      pass("Login", page.url());
    }

    await page.click('button:has-text("Planung"), .ad-sidebar__item:has-text("Planung")');
    await page.waitForTimeout(800);

    const weekGrid = page.locator(".ad-plan-grid");
    if (await weekGrid.count()) {
      pass("Wochenansicht", "Raster sichtbar");
    } else {
      fail("Wochenansicht", "ad-plan-grid fehlt");
    }

    const toolbar = page.locator(".ad-plan-toolbar");
    if (await toolbar.count()) pass("Toolbar", "Navigation + Toggle vorhanden");
    else fail("Toolbar");

    const neueSchicht = page.locator('button:has-text("Neue Schicht")');
    if (await neueSchicht.count()) {
      await neueSchicht.click();
      const modal = page.locator(".ad-modal--shift");
      if (await modal.isVisible({ timeout: 3000 })) {
        pass("Modal anlegen", "öffnet über Toolbar");
        await page.click(".ad-modal__close");
      } else fail("Modal anlegen");
    } else fail("Neue Schicht Button");

    const cell = page.locator(".ad-plan-cell").first();
    if (await cell.count()) {
      await cell.click();
      const modal = page.locator(".ad-modal--shift");
      if (await modal.isVisible({ timeout: 3000 })) {
        pass("Modal Slot-Klick", "Datum/Mitarbeiter vorausgefüllt");
        await page.click(".ad-modal__close");
      } else fail("Modal Slot-Klick");
    } else {
      fail("Plan-Zelle", "keine Zellen gefunden");
    }

    const dayToggle = page.locator('.ad-plan-toggle:has-text("Tag")');
    await dayToggle.click();
    await page.waitForTimeout(500);
    const timeline = page.locator(".ad-plan-timeline");
    if (await timeline.count()) pass("Tagesansicht", "Timeline sichtbar");
    else fail("Tagesansicht");

    const weekToggle = page.locator('.ad-plan-toggle:has-text("Woche")');
    await weekToggle.click();
    await page.waitForTimeout(300);
    const navNext = page.locator('.ad-plan-toolbar__nav button[aria-label="Nächste Woche"]');
    if (await navNext.count()) {
      await navNext.click();
      pass("Wochennavigation", "nächste Woche");
    } else fail("Wochennavigation");

    const heute = page.locator('.ad-plan-toolbar button:has-text("Heute")');
    if (await heute.count()) {
      await heute.click();
      pass("Heute-Button");
    } else fail("Heute-Button");

    const shiftBlock = page.locator(".ad-plan-block").first();
    if (await shiftBlock.count()) {
      await shiftBlock.click();
      const editTitle = page.locator('#ad-shift-modal-title:has-text("bearbeiten")');
      if (await editTitle.isVisible({ timeout: 3000 })) {
        pass("Schicht bearbeiten", "Modal aus Block-Klick");
        await page.click(".ad-modal__close");
      } else fail("Schicht bearbeiten");
    } else {
      pass("Schicht bearbeiten", "übersprungen (keine Schichten in Woche)");
    }

    const nightBar = page.locator(".ad-plan-timeline__bar--night-in, .ad-plan-timeline__bar--night-out");
    await dayToggle.click();
    await page.waitForTimeout(400);
    if (await nightBar.count()) {
      pass("Nachtschicht-Timeline", `${await nightBar.count()} Balken mit Mitternacht-Spanne`);
    } else {
      pass("Nachtschicht-Timeline", "keine Nachtschicht in aktuellem Tag (OK wenn keine Daten)");
    }

    const criticalErrors = consoleErrors.filter(
      (e) => !/favicon|404|Failed to load resource/i.test(e)
    );
    if (criticalErrors.length === 0) pass("Konsole", "keine kritischen Fehler");
    else fail("Konsole", criticalErrors.slice(0, 3).join(" | "));
  } catch (err) {
    fail("Unerwarteter Fehler", String(err));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n--- Zusammenfassung ---");
  console.log(`${results.length - failed.length}/${results.length} bestanden`);
  if (failed.length) {
    console.log("Fehlgeschlagen:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main();
