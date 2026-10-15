import { expect, test } from "@playwright/test";

import { installVastRoutes } from "../lib/routes.js";
import { TesterPage } from "../lib/tester.js";

const PRESET_COUNT = 43;

/**
 * Every scenario preset in the library, with what its run must produce.
 * `valid` mirrors the status-bar tile; `minErrors` guards the known-bad tags.
 */
const SCENARIOS: Array<{
  label: string;
  group: string;
  status: "ready" | "resolved";
  valid: "yes" | "no";
  minErrors?: number;
}> = [
  { label: "Inline linear", group: "Core coverage", status: "ready", valid: "yes" },
  { label: "Skippable linear", group: "Core coverage", status: "ready", valid: "yes" },
  { label: "Broken tag", group: "Core coverage", status: "ready", valid: "no", minErrors: 1 },
  { label: "Fixable tag", group: "Core coverage", status: "ready", valid: "yes" },
  { label: "Wrapper chain", group: "Core coverage", status: "resolved", valid: "yes" },
  { label: "Pricing and category", group: "Core coverage", status: "ready", valid: "yes" },
  { label: "Non-linear overlay", group: "Creative formats", status: "ready", valid: "yes" },
  { label: "Companion banner", group: "Creative formats", status: "ready", valid: "yes" },
  { label: "Icon fallbacks", group: "Creative formats", status: "ready", valid: "yes" },
  { label: "Runtime surfaces", group: "Creative formats", status: "ready", valid: "yes" },
  { label: "SIMID overlay banner", group: "SIMID interactive", status: "ready", valid: "yes" },
  { label: "SIMID interactive poll", group: "SIMID interactive", status: "ready", valid: "yes" },
  { label: "SIMID protocol explorer", group: "SIMID interactive", status: "ready", valid: "yes" },
  { label: "SIMID product carousel", group: "SIMID interactive", status: "ready", valid: "yes" },
  { label: "SIMID shoppable CTAs", group: "SIMID interactive", status: "ready", valid: "yes" },
  { label: "SIMID menu tiles", group: "SIMID interactive", status: "ready", valid: "yes" },
  { label: "IAB SIMID overlay", group: "SIMID interactive", status: "ready", valid: "yes" },
  { label: "IAB SIMID survey", group: "SIMID interactive", status: "ready", valid: "yes" },
  { label: "IAB SIMID extender", group: "SIMID interactive", status: "ready", valid: "yes" },
  { label: "IAB SIMID testers nonlinear", group: "SIMID interactive", status: "ready", valid: "yes" },
  { label: "SIMID behind a wrapper", group: "SIMID interactive", status: "resolved", valid: "yes" },
  { label: "Bumper then SIMID", group: "SIMID interactive", status: "ready", valid: "yes" },
  { label: "Click tracking", group: "Measurement", status: "ready", valid: "yes" },
  { label: "Viewable impression", group: "Measurement", status: "ready", valid: "yes" },
  { label: "Ad verification", group: "Measurement", status: "ready", valid: "yes" },
  { label: "Wrapper signals", group: "Measurement", status: "ready", valid: "yes" },
  { label: "Ad identity", group: "CTV and SSAI", status: "ready", valid: "yes" },
  { label: "Mezzanine support", group: "CTV and SSAI", status: "ready", valid: "yes" },
  { label: "Closed captions", group: "CTV and SSAI", status: "ready", valid: "yes" },
  { label: "2.0 pause (extension)", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "2.0 overlay SIMID (extension)", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "3.0 pause (extension)", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "3.0 overlay SIMID (extension)", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "4.4 pause static", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "4.4 pause video", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "4.4 screensaver", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "4.4 overlay SIMID", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "4.4 squeezeback", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "4.4 in-scene", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "4.4 pause SIMID", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "4.4 screensaver SIMID", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "4.4 squeezeback SIMID", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
  { label: "4.4 in-scene SIMID", group: "CTV Ad Portfolio", status: "ready", valid: "yes" },
];

async function openLibrary(tester: TesterPage) {
  if ((await tester.scenarioToggle.getAttribute("aria-expanded")) !== "true") {
    await tester.scenarioToggle.click();
  }
  await expect(tester.scenarioBody).toBeVisible();
}

async function expandAllGroups(tester: TesterPage) {
  const toggles = tester.page.locator(".scenario-expand-toggle", { hasText: "more" });
  while ((await toggles.count()) > 0) {
    await toggles.first().click();
  }
}

test.describe("scenario library", () => {
  test("all presets are listed across the groups", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await openLibrary(tester);

    await expect(page.locator(".scenario-count")).toContainText(`Showing ${String(PRESET_COUNT)} of ${String(PRESET_COUNT)} presets`);

    const groupHeads = page.locator(".scenario-group-head strong");
    await expect(groupHeads).toHaveText([
      "Core coverage",
      "Creative formats",
      "SIMID interactive",
      "Measurement",
      "CTV and SSAI",
      "CTV Ad Portfolio",
    ]);

    await expandAllGroups(tester);
    await expect(tester.scenarioRows).toHaveCount(PRESET_COUNT);
  });

  test("groups over the row limit collapse behind a show-more toggle", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await openLibrary(tester);

    const coreGroup = page.locator(".scenario-group", { hasText: "Core coverage" });
    await expect(coreGroup.locator(".scenario-row")).toHaveCount(5);

    const toggle = coreGroup.locator(".scenario-expand-toggle");
    await expect(toggle).toHaveText("Show 1 more");
    await toggle.click();
    await expect(coreGroup.locator(".scenario-row")).toHaveCount(6);
    await expect(toggle).toHaveText("Show fewer");
  });

  test("each filter narrows the list and reset restores it", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await openLibrary(tester);

    await tester.scenarioFilter("Version").selectOption("VAST 2.0");
    await expect(tester.scenarioRows).toHaveCount(3);
    await expect(tester.scenarioRow("Non-linear overlay")).toBeVisible();

    const reset = page.locator(".scenario-reset");
    await reset.click();
    await expect(page.locator(".scenario-count")).toContainText(`Showing ${String(PRESET_COUNT)}`);
    await expect(reset).toBeDisabled();

    await tester.scenarioFilter("Action").selectOption({ label: "Resolve wrappers" });
    await expect(tester.scenarioRows).toHaveCount(2);
    await expect(tester.scenarioRow("Wrapper chain")).toBeVisible();
    await reset.click();

    await tester.scenarioFilter("Surface").selectOption("omid");
    await expect(tester.scenarioRows).toHaveCount(2);
    await expect(tester.scenarioRow("Ad verification")).toBeVisible();
    await reset.click();

    await tester.scenarioSearch.fill("pause");
    await tester.scenarioFilter("Version").selectOption("VAST 4.4 (beta)");
    await expect(tester.scenarioRows).toHaveCount(3);
    await expect(tester.scenarioRow("4.4 pause static")).toBeVisible();
    await expect(tester.scenarioRow("4.4 pause video")).toBeVisible();
    await expect(tester.scenarioRow("4.4 pause SIMID")).toBeVisible();
    await reset.click();

    await tester.scenarioSearch.fill("4.4");
    await tester.scenarioFilter("Version").selectOption("VAST 4.4 (beta)");
    await expandAllGroups(tester);
    await expect(tester.scenarioRows).toHaveCount(10);
    await expect(page.locator(".scenario-group-head strong")).toHaveText(["CTV Ad Portfolio"]);
  });

  test("conflicting filters show the empty state", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await openLibrary(tester);

    await tester.scenarioFilter("Version").selectOption("VAST 2.0");
    await tester.scenarioFilter("Action").selectOption({ label: "Resolve wrappers" });

    await expect(page.locator(".scenario-empty")).toHaveText("No presets match the current filters.");
    await expect(tester.scenarioRows).toHaveCount(0);
  });

  test("running a preset closes the library and marks it active", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await openLibrary(tester);

    await tester.runAndWait(async () => {
      await tester.scenarioRow("Skippable linear").click();
    });

    await expect(tester.scenarioBody).toHaveCount(0);
    await expect(tester.scenarioToggle).toContainText("Active: Skippable linear");

    await openLibrary(tester);
    await expect(tester.scenarioRow("Skippable linear")).toHaveClass(/active/);
  });

  for (const scenario of SCENARIOS) {
    test(`preset runs clean: ${scenario.label}`, async ({ page, baseURL }) => {
      const routes = await installVastRoutes(page, baseURL);
      const tester = new TesterPage(page);

      await tester.goto();
      await openLibrary(tester);
      await expandAllGroups(tester);

      await tester.runAndWait(async () => {
        await tester.scenarioRow(scenario.label).click();
      });

      const metrics = await tester.metrics();
      const detail = `${scenario.label} ${JSON.stringify(metrics)}`;
      expect(await tester.status(), detail).toBe(scenario.status);
      expect(metrics.valid, detail).toBe(scenario.valid);

      if (scenario.minErrors !== undefined) {
        expect(Number(metrics.errors), detail).toBeGreaterThanOrEqual(scenario.minErrors);
      } else {
        expect(metrics.errors, detail).toBe("0");
      }

      expect(routes.unexpectedRequests, detail).toEqual([]);
    });
  }
});
