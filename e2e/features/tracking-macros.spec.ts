import { expect, test } from "@playwright/test";

import { fixtureById } from "../fixtures/index.js";
import { installVastRoutes } from "../lib/routes.js";
import { TesterPage } from "../lib/tester.js";

test.describe("tracking waterfall", () => {
  test("summary counts always add up to the row total", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));
    await tester.prepareRunner();
    await tester.openSection("tracking");

    const total = Number(await tester.sectionMetric("tracking", "targets"));
    const ok = Number(await tester.sectionMetric("tracking", "succeeded"));
    const failed = Number(await tester.sectionMetric("tracking", "failed"));
    const pending = Number(await tester.sectionMetric("tracking", "pending"));
    const linked = Number(await tester.sectionMetric("tracking", "linked-only"));

    expect(total).toBeGreaterThan(0);
    expect(ok + failed + pending + linked).toBe(total);
    await expect(tester.waterfallRows).toHaveCount(total);
  });

  test("every waterfall row names its event, hop, and URLs", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));
    await tester.prepareRunner();
    await tester.openSection("tracking");

    const first = tester.waterfallRows.first();
    await expect(first.locator('[data-label="Event"] strong')).not.toBeEmpty();
    await expect(first.locator('[data-label="Status"] .pill')).toHaveText(/ok|failed|ready|linked/);
    await expect(first).toContainText(/Hop \d+/);
  });
});

test.describe("macro debugger", () => {
  test("ships editable defaults and add/remove works", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.openSection("macros");

    const keys = await tester.macroRows.locator('input[aria-label="Macro key"]').evaluateAll(
      (nodes) => nodes.map((node) => (node as HTMLInputElement).value),
    );
    for (const expected of ["CACHEBUSTING", "TIMESTAMP", "ERRORCODE", "CONTENTPLAYHEAD", "PAGEURL"]) {
      expect(keys).toContain(expected);
    }
    const initialCount = keys.length;

    await tester.button("Add macro").click();
    await expect(tester.macroRows).toHaveCount(initialCount + 1);

    await tester.macroRows.last().locator("button", { hasText: "Remove" }).click();
    await expect(tester.macroRows).toHaveCount(initialCount);
  });

  test("removing the last remaining macro clears it instead of deleting the row", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.openSection("macros");

    while ((await tester.macroRows.count()) > 1) {
      await tester.macroRows.last().locator("button", { hasText: "Remove" }).click();
    }

    const lastRow = tester.macroRows.first();
    await lastRow.locator("button", { hasText: "Remove" }).click();
    await expect(tester.macroRows).toHaveCount(1);
    await expect(lastRow.locator('input[aria-label="Macro key"]')).toHaveValue("");
    await expect(lastRow.locator('input[aria-label="Macro value"]')).toHaveValue("");
  });

  test("presets swap the macro set for their environment", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.openSection("macros");

    await tester.macroPresetSelect.selectOption({ label: "CTV player" });
    await expect(tester.section("macros").locator(".panel-head .tag")).toHaveText("CTV player");
    let entries = await readMacroEntries(tester);
    expect(entries.APPBUNDLE).toBe("com.publisher.ctv");
    expect(entries.DEVICEUA).toContain("Roku");

    await tester.macroPresetSelect.selectOption({ label: "Mobile app" });
    entries = await readMacroEntries(tester);
    expect(entries.ERRORCODE).toBe("402");
    expect(entries.APPBUNDLE).toBe("com.publisher.mobile");

    // Reload preset restores the canonical values after a manual edit.
    const errorIndex = await macroRowIndex(tester, "ERRORCODE");
    await macroValueInputAt(tester, errorIndex).fill("999");
    await tester.button("Reload preset").click();
    await expect(macroValueInputAt(tester, errorIndex)).toHaveValue("402");
  });

  test("edited macro values expand into the tracking URL preview", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));
    await tester.prepareRunner();
    await tester.openSection("macros");

    // The impression URL carries cb=[CACHEBUSTING]; the preview link shows it
    // expanded to the 8-digit cachebuster while the original keeps the macro.
    const previews = tester.macroPreviewRows;
    expect(await previews.count()).toBeGreaterThan(0);
    const impressionPreview = previews.filter({ hasText: "imp?cb=" }).first();
    await expect(impressionPreview.locator("a.url-link")).toContainText(/cb=\d{8}/);
    await expect(impressionPreview.locator("a.url-link")).not.toContainText("[CACHEBUSTING]");

    const errorPreview = previews.filter({ hasText: "error?code=" }).first();
    await expect(errorPreview.locator("a.url-link")).toContainText("code=901");

    const errorIndex = await macroRowIndex(tester, "ERRORCODE");
    await macroValueInputAt(tester, errorIndex).fill("777");
    await expect(errorPreview.locator("a.url-link")).toContainText("code=777");
  });
});

/**
 * The value input of the row whose key input currently holds `key`. React sets
 * input values as properties, not attributes, so a CSS [value=...] selector
 * cannot find them; index the rows by live value instead.
 */
async function macroRowIndex(tester: TesterPage, key: string): Promise<number> {
  const index = await tester.macroRows.evaluateAll((rows, target) => {
    return rows.findIndex((row) => (row.querySelector("input") as HTMLInputElement | null)?.value === target);
  }, key);
  expect(index, `macro row for ${key}`).toBeGreaterThanOrEqual(0);
  return index;
}

function macroValueInputAt(tester: TesterPage, index: number) {
  return tester.macroRows.nth(index).locator('input[aria-label="Macro value"]');
}

async function readMacroEntries(tester: TesterPage): Promise<Record<string, string>> {
  return tester.macroRows.evaluateAll((rows) => {
    const entries: Record<string, string> = {};
    for (const row of rows) {
      const inputs = row.querySelectorAll("input");
      const key = (inputs[0] as HTMLInputElement).value;
      if (key) {
        entries[key] = (inputs[1] as HTMLInputElement).value;
      }
    }
    return entries;
  });
}
