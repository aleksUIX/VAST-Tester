import { expect, test } from "@playwright/test";

import { fixtureById } from "../fixtures/index.js";
import { installVastRoutes } from "../lib/routes.js";
import { TesterPage } from "../lib/tester.js";

async function runPreset(tester: TesterPage, label: string) {
  if ((await tester.scenarioToggle.getAttribute("aria-expanded")) !== "true") {
    await tester.scenarioToggle.click();
  }
  await expect(tester.scenarioBody).toBeVisible();
  const more = tester.page.locator(".scenario-expand-toggle", { hasText: "more" });
  while ((await more.count()) > 0) {
    await more.first().click();
  }
  await tester.runAndWait(async () => {
    await tester.scenarioRow(label).click();
  });
}

test.describe("wrapper chain inspector", () => {
  test("renders one card per hop with fetch, validation, and delta notes", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("wrapper-chain"));

    const cards = tester.section("wrappers").locator(".hop-card");
    await expect(cards).toHaveCount(3);

    await expect(cards.nth(0)).toContainText("Hop 0");
    await expect(cards.nth(0)).toContainText("Root document fetched from the requested URL.");
    await expect(cards.nth(0)).toContainText("Next wrapper URI:");
    await expect(cards.nth(2)).toContainText("Resolution terminates here with inline creative content.");

    for (let index = 0; index < 3; index += 1) {
      const card = cards.nth(index);
      await expect(card.locator(".pill", { hasText: "ms fetch" })).toBeVisible();
      await expect(card.locator(".hop-topline .pill")).toHaveText(/\d+e \/ \d+w \/ \d+i/);
    }
  });
});

test.describe("resolved ads and asset audit", () => {
  test("audit metrics add up and rows describe each asset", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));

    const total = Number(await tester.sectionMetric("resolved", "assets"));
    const ready = Number(await tester.sectionMetric("resolved", "ready"));
    const review = Number(await tester.sectionMetric("resolved", "review"));
    const risk = Number(await tester.sectionMetric("resolved", "high-risk"));

    expect(total).toBeGreaterThan(0);
    expect(ready + review + risk).toBe(total);
    await expect(tester.section("resolved").locator(".asset-audit-table .table-row")).toHaveCount(total);
    await expect(tester.section("resolved").locator(".resolved-grid > *")).toHaveCount(1);
  });

  test("plain-HTTP assets are flagged high risk", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    const fixture = fixtureById("insecure-media");

    await tester.goto();
    await tester.clear();
    await tester.pasteXml(fixture.payload);
    await tester.validate();

    await tester.openSection("resolved");
    expect(Number(await tester.sectionMetric("resolved", "high-risk"))).toBeGreaterThan(0);

    const riskyRow = tester.section("resolved").locator(".table-row.asset-risk").first();
    await expect(riskyRow.locator('[data-label="Transport"] .pill')).toHaveText("HTTP");
    await expect(riskyRow.locator('[data-label="Risk"] .pill')).toHaveText("high risk");
    await expect(riskyRow).toContainText("Non-HTTPS");
  });
});

test.describe("runtime and verification", () => {
  test("verification vendors and api frameworks surface for an OMID tag", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("omid-verification"));

    expect(Number(await tester.sectionMetric("runtime", "omid-resources"))).toBeGreaterThanOrEqual(2);
    await expect(tester.section("runtime").locator(".runtime-chip", { hasText: "omid" }).first()).toBeVisible();

    const rows = tester.section("runtime").locator(".runtime-table .table-row");
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
    await expect(rows.first().locator('[data-label="Vendor"]')).not.toBeEmpty();
    await expect(rows.first().locator("a.url-link")).toHaveAttribute("href", /^https:\/\//);
  });

  test("companion and icon creatives render as preview cards", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("companion-icons"));

    expect(Number(await tester.sectionMetric("runtime", "companions"))).toBeGreaterThanOrEqual(1);
    expect(Number(await tester.sectionMetric("runtime", "icons"))).toBeGreaterThanOrEqual(1);

    const grid = tester.section("runtime").locator(".preview-grid");
    await expect(grid.locator("text=Companion").first()).toBeVisible();
    await expect(grid.locator("text=Icon").first()).toBeVisible();
    expect(await grid.locator("img").count()).toBeGreaterThanOrEqual(1);
  });

  test("a plain linear tag reports empty runtime surfaces honestly", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("missing-required"));

    await tester.openSection("runtime");
    await expect(
      tester.section("runtime").locator(".empty-state", { hasText: "No verification resources detected" }),
    ).toBeVisible();
  });

  test("Ad verification starts an OM SDK session and can fire verificationNotExecuted", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "Ad verification");

    await tester.openSection("runtime");
    const panel = page.locator("[data-omid-session]");
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-label="Vendor"]', { hasText: "iabtechlab.com-omid" })).toBeVisible();

    await tester.openSection("playback");
    await tester.button("Prepare runner").click();
    await tester.waitForIdle();
    await expect(tester.runnerVideo).toBeVisible();

    await expect
      .poll(async () => page.locator("[data-omid-session]").getAttribute("data-omid-session"), { timeout: 15_000 })
      .toBe("running");
    await expect(panel.locator(".omid-script-injected")).toBeVisible();

    await page.locator(".runner-video").evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(async () => tester.milestonesValue.textContent(), { timeout: 15_000 }).toContain("start");
    await expect(page.locator('[data-omid-event="loaded"]')).toBeVisible();
    await expect(page.locator('[data-omid-event="impression"]')).toBeVisible();
    await expect(page.locator('[data-omid-event="start"]')).toBeVisible();

    await tester.button("REASON 3").click();
    const notExecuted = tester.waterfallRow("verificationNotExecuted");
    await expect(notExecuted.locator('[data-label="Status"] .pill')).toHaveText("ok");
    await expect(notExecuted).toContainText("reason=3");
  });
});
