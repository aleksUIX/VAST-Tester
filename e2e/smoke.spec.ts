import { expect, test } from "@playwright/test";

import { FIXTURES, type CountAssertion, type LensId } from "./fixtures/index.js";
import { installVastRoutes } from "./lib/routes.js";
import { TesterPage } from "./lib/tester.js";

function assertCount(actual: string, expected: CountAssertion, label: string) {
  const value = Number(actual);
  expect(Number.isNaN(value), `${label} should be numeric, got "${actual}"`).toBe(false);

  if (typeof expected === "number") {
    expect(value, label).toBe(expected);
    return;
  }

  if (typeof expected.min === "number") {
    expect(value, `${label} min`).toBeGreaterThanOrEqual(expected.min);
  }

  if (typeof expected.max === "number") {
    expect(value, `${label} max`).toBeLessThanOrEqual(expected.max);
  }
}

test.describe("VAST tester smoke", () => {
  for (const fixture of FIXTURES) {
    test(`${fixture.id}: ${fixture.label}`, async ({ page, baseURL }) => {
      const routes = await installVastRoutes(page, baseURL);
      const tester = new TesterPage(page);

      await tester.goto();
      await tester.runFixture(fixture);

      const metrics = await tester.metrics();
      const detail = `${fixture.id} ${JSON.stringify(metrics)}`;

      expect(metrics.valid, `${detail} (valid)`).toBe(fixture.expect.valid);
      assertCount(metrics.errors, fixture.expect.errors, `${detail} (errors)`);

      for (const key of ["warnings", "info", "hops", "ads"] as const) {
        const expected = fixture.expect[key];
        if (expected !== undefined) {
          assertCount(metrics[key], expected, `${detail} (${key})`);
        }
      }

      for (const [lensId, status] of Object.entries(fixture.expect.lens ?? {})) {
        await expect(tester.lens(lensId as LensId), `${fixture.id} lens ${lensId}`).toHaveAttribute(
          "data-lens-status",
          status,
        );
      }

      for (const sectionId of fixture.expect.sectionsOpen ?? []) {
        await expect(
          tester.section(sectionId),
          `${fixture.id} section ${sectionId} should open itself`,
        ).toHaveAttribute("data-open", "true");
      }

      if (fixture.expect.ruleIds?.length) {
        const found = await tester.ruleIds();
        for (const ruleId of fixture.expect.ruleIds) {
          expect(found, `${fixture.id} findings`).toContain(ruleId);
        }
      }

      expect(routes.unexpectedRequests, `${fixture.id} made uncovered network calls`).toEqual([]);
    });
  }
});

test("clear resets the workspace", async ({ page, baseURL }) => {
  await installVastRoutes(page, baseURL);
  const tester = new TesterPage(page);

  await tester.goto();
  await tester.runFixture(FIXTURES[6]);
  expect(await tester.metric("ads")).toBe("2");

  await tester.clear();

  await expect(tester.xmlInput).toHaveValue("");
  await expect(tester.urlInput).toHaveValue("");
  expect(await tester.status()).toBe("idle");
  expect(await tester.metric("errors")).toBe("0");
  expect(await tester.metric("ads")).toBe("0");
  await expect(tester.section("resolved")).toHaveAttribute("data-open", "false");
  await expect(tester.button("Clear")).toBeDisabled();
});

test("scenario library loads a built-in preset", async ({ page, baseURL }) => {
  await installVastRoutes(page, baseURL);
  const tester = new TesterPage(page);

  await tester.goto();
  await tester.scenarioToggle.click();

  await tester.runAndWait(async () => {
    await page.locator(".scenario-row", { hasText: "Broken tag" }).first().click();
  });

  expect(Number(await tester.metric("errors"))).toBeGreaterThan(0);
  expect(await tester.metric("valid")).toBe("no");
  await expect(tester.section("findings")).toHaveAttribute("data-open", "true");
});

test("an inline editor marker filters the findings table", async ({ page, baseURL }) => {
  await installVastRoutes(page, baseURL);
  const tester = new TesterPage(page);

  await tester.goto();
  await tester.runFixture(FIXTURES[1]);

  const allFindings = await tester.findingsRows.count();
  expect(allFindings).toBeGreaterThan(1);

  // fill() leaves the caret at the end, so the editor is scrolled past the
  // first marker. Scroll back up the way a user would before clicking it.
  await tester.xmlInput.evaluate((node: HTMLTextAreaElement) => { node.scrollTop = 0; });
  await expect(page.locator(".editor-inline-chip").first()).toBeInViewport();

  await tester.clickInView(page.locator(".editor-inline-chip").first(), page.locator(".editor-shell"));
  await expect(page.locator(".findings-filter-note")).toBeVisible();
  expect(await tester.findingsRows.count()).toBeLessThan(allFindings);

  await tester.clickInView(tester.button("Show all findings"));
  expect(await tester.findingsRows.count()).toBe(allFindings);
});

test("inline markers sit on the line they name", async ({ page, baseURL }) => {
  await installVastRoutes(page, baseURL);
  const tester = new TesterPage(page);

  await tester.goto();
  await tester.runFixture(FIXTURES[1]);
  await tester.xmlInput.evaluate((node: HTMLTextAreaElement) => { node.scrollTop = 0; });

  // A native scroll updates React asynchronously. Wait for layout, then read
  // both rectangles in one frame so page anchoring cannot skew the comparison.
  await expect(async () => {
    const geometry = await page.evaluate(() => {
      const node = document.querySelector<HTMLTextAreaElement>("#vast-xml")!;
      const style = globalThis.getComputedStyle(node);
      return {
        lineHeight: Number.parseFloat(style.lineHeight),
        paddingTop: Number.parseFloat(style.paddingTop),
        top: node.getBoundingClientRect().top,
        wrap: node.wrap,
        markers: Array.from(document.querySelectorAll(".editor-inline-marker"), (marker) => ({
          label: marker.querySelector(".editor-inline-chip strong")?.textContent ?? "",
          top: marker.getBoundingClientRect().top,
          height: marker.getBoundingClientRect().height,
        })),
      };
    });
    expect(geometry.wrap).toBe("off");
    expect(geometry.markers.length).toBeGreaterThan(1);
    for (const marker of geometry.markers) {
      const line = Number(marker.label.replace("L", ""));
      expect(Number.isNaN(line), `marker should be labelled Lnn, got "${marker.label}"`).toBe(false);
      const expectedTop = geometry.top + geometry.paddingTop + ((line - 1) * geometry.lineHeight);
      expect(marker.top, `marker top for line ${String(line)}`).toBeCloseTo(expectedTop, 0);
      expect(marker.height, `marker height for line ${String(line)}`).toBeCloseTo(geometry.lineHeight, 0);
    }
  }).toPass({ timeout: 5000 });
});

test("findings show rule IDs without hosted documentation links", async ({ page, baseURL }) => {
  await installVastRoutes(page, baseURL);
  const tester = new TesterPage(page);
  await tester.goto();
  await tester.runFixture(FIXTURES[1]);
  const labels = tester.section("findings").locator("[data-rule]");
  expect(await labels.count()).toBe(await tester.findingsRows.count());
  for (const label of await labels.all()) {
    expect(await label.getAttribute("data-rule")).toBeTruthy();
    await expect(label).not.toHaveAttribute("href");
  }
  await expect(page.locator('a[href*="vastlint.org"]')).toHaveCount(0);
});

test("resolved media files are followable links", async ({ page, baseURL }) => {
  await installVastRoutes(page, baseURL);
  const tester = new TesterPage(page);

  await tester.goto();
  // wrapper-chain is the resolve fixture, so it is the one that populates the
  // resolved-asset tables with real media URLs.
  await tester.runFixture(FIXTURES[9]);

  const mediaLinks = tester.section("resolved").locator("a.url-link");
  await expect(mediaLinks.first()).toHaveAttribute("target", "_blank");
  await expect(mediaLinks.first()).toHaveAttribute("href", /^https:\/\//);
  expect(await mediaLinks.count()).toBeGreaterThan(0);
});

test("a finding location jumps to its line in the editor", async ({ page, baseURL }) => {
  await installVastRoutes(page, baseURL);
  const tester = new TesterPage(page);

  await tester.goto();
  await tester.runFixture(FIXTURES[1]);

  const jump = tester.section("findings").locator(".line-jump").last();
  const line = Number(((await jump.textContent()) ?? "").replace("L", "").split(":")[0]);
  await tester.clickInView(jump);

  const selected = await tester.xmlInput.evaluate((node: HTMLTextAreaElement) => ({
    before: node.value.slice(0, node.selectionStart),
    text: node.value.slice(node.selectionStart, node.selectionEnd),
  }));

  expect(selected.before.split("\n").length).toBe(line);
  expect(selected.text.trim().length).toBeGreaterThan(0);
});
