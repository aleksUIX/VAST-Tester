import { expect, test } from "@playwright/test";

import { fixtureById, type LensId } from "../fixtures/index.js";
import { installVastRoutes } from "../lib/routes.js";
import { TesterPage } from "../lib/tester.js";

const ALL_LENSES: LensId[] = ["strict-iab", "ctv-safe", "ssai-safe", "legacy-player"];

test.describe("compliance profiles", () => {
  test("four lenses render and clicking one selects it", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));

    for (const lens of ALL_LENSES) {
      await expect(tester.lens(lens)).toBeVisible();
    }
    await expect(tester.lens("strict-iab")).toHaveClass(/active/);

    await tester.lens("ctv-safe").click();
    await expect(tester.lens("ctv-safe")).toHaveClass(/active/);
    await expect(tester.lens("strict-iab")).not.toHaveClass(/active/);
    await expect(page.locator(".lens-note")).toContainText("TV playback with conservative runtime assumptions");
  });

  test("the active lens verdict is mirrored in the findings header", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("vpaid-legacy"));

    await expect(tester.section("findings").locator(".panel-head .pill")).toContainText("Strict IAB pass");

    await tester.lens("ctv-safe").click();
    await tester.waitForIdle();
    await expect(tester.section("findings").locator(".panel-head .pill")).toContainText("CTV-safe fail");
    // The verdict explains itself.
    expect(await page.locator(".lens-reasons li").count()).toBeGreaterThan(0);
  });

  test("lens severity overrides re-score the same tag", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("missing-required"));

    const strictErrors = Number(await tester.metric("errors"));
    expect(strictErrors).toBe(4);

    // Legacy players do not require AdServingId / UniversalAdId, so those two
    // errors demote to warnings under that lens.
    await tester.lens("legacy-player").click();
    await tester.waitForIdle();

    const legacyErrors = Number(await tester.metric("errors"));
    expect(legacyErrors).toBeLessThan(strictErrors);
    expect(Number(await tester.metric("warnings"))).toBeGreaterThan(0);

    // And switching back restores the strict counts.
    await tester.lens("strict-iab").click();
    await tester.waitForIdle();
    expect(Number(await tester.metric("errors"))).toBe(strictErrors);
  });

  test("before any run, every lens asks for input instead of scoring", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.clear();

    for (const lens of ALL_LENSES) {
      await expect(tester.lens(lens)).toHaveAttribute("data-lens-status", "attention");
    }
  });
});
