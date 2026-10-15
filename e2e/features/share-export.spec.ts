import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import JSZip from "jszip";

import { fixtureById } from "../fixtures/index.js";
import { installVastRoutes } from "../lib/routes.js";
import { TesterPage } from "../lib/tester.js";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function readClipboard(tester: TesterPage): Promise<string> {
  return tester.page.evaluate(() => navigator.clipboard.readText());
}

test.describe("share and export", () => {
  test("the report preview reflects the current run", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("missing-required"));
    await tester.openSection("export");

    const preview = page.locator(".report-preview");
    await expect(preview).toContainText("Counts: 4 error(s)");
    await expect(preview).toContainText("Validity: not valid");
    await expect(preview).toContainText("Source: Editor XML");
    await expect(preview).toContainText("Top findings:");
  });

  test("copy share link round-trips the whole session", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    const fixture = fixtureById("missing-required");

    await tester.goto();
    await tester.runFixture(fixture);
    await tester.lens("ssai-safe").click();
    await tester.waitForIdle();

    await tester.openSection("export");
    // The status bar carries an icon button with the same accessible name.
    await tester.clickInView(tester.section("export").getByRole("button", { name: "Copy share link", exact: true }));
    await expect(tester.successBanner).toHaveText("Share link copied to clipboard.");

    const shareUrl = await readClipboard(tester);
    expect(shareUrl).toContain("#session=");

    // A fresh navigation to the link must restore payload, action, and lens.
    await page.goto(shareUrl);
    await tester.waitForIdle();

    await expect(tester.xmlInput).toHaveValue(fixture.payload);
    expect(await tester.status()).toBe("ready");
    expect(await tester.metric("valid")).toBe("no");
    await expect(tester.lens("ssai-safe")).toHaveClass(/active/);
  });

  test("copy report summary puts the exact preview text on the clipboard", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));
    await tester.openSection("export");

    await tester.clickInView(tester.button("Copy summary"));
    await expect(tester.successBanner).toHaveText("Summary copied to clipboard.");

    const copied = await readClipboard(tester);
    const preview = await page.locator(".report-preview").textContent();
    expect(copied).toBe(preview);
  });

  test("copy error findings lists every failing rule", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    const fixture = fixtureById("missing-required");

    await tester.goto();
    await tester.runFixture(fixture);
    await tester.openSection("export");

    await tester.clickInView(tester.button("Copy errors"));
    await expect(tester.successBanner).toHaveText("Error findings copied to clipboard.");

    const copied = await readClipboard(tester);
    for (const ruleId of fixture.expect.ruleIds ?? []) {
      expect(copied).toContain(ruleId);
    }
  });

  test("copy error findings degrades to a status note on a clean tag", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));
    await tester.openSection("export");

    await tester.clickInView(tester.button("Copy errors"));
    await expect(tester.successBanner).toHaveText("No error findings. Status note copied to clipboard.");
  });

  test("text and JSON reports download with the validation result", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("missing-required"));
    await tester.openSection("export");

    const txtDownload = page.waitForEvent("download");
    await tester.clickInView(tester.button("Download text"));
    const txt = await txtDownload;
    expect(txt.suggestedFilename()).toBe("vast-validator-report-custom.txt");
    const txtBody = readFileSync((await txt.path()) ?? "", "utf8");
    expect(txtBody).toContain("Counts: 4 error(s)");

    const jsonDownload = page.waitForEvent("download");
    await tester.clickInView(tester.button("Download JSON"));
    const json = await jsonDownload;
    expect(json.suggestedFilename()).toBe("vast-validator-report-custom.json");

    const report = JSON.parse(readFileSync((await json.path()) ?? "", "utf8")) as {
      sourceMode: string;
      validation: { valid: boolean | null; errors: number };
      issues: Array<{ id: string }>;
      compliance: { profiles: Array<{ id: string }> };
    };
    expect(report.sourceMode).toBe("xml");
    expect(report.validation.valid).toBe(false);
    expect(report.validation.errors).toBe(4);
    expect(report.issues.length).toBeGreaterThanOrEqual(4);
    expect(report.compliance.profiles).toHaveLength(4);
  });

  test("the artifact bundle contains the full evidence set", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    const fixture = fixtureById("inline-clean");

    await tester.goto();
    await tester.runFixture(fixture);
    await tester.openSection("export");

    const downloadEvent = page.waitForEvent("download");
    await tester.clickInView(tester.button("Download bundle"));
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("vast-validator-artifacts-custom.zip");

    const zip = await JSZip.loadAsync(readFileSync((await download.path()) ?? ""));
    for (const path of [
      "README.txt",
      "report.txt",
      "report.json",
      "source/request.xml",
      "source/root.xml",
      "runtime/macros.json",
      "runtime/tracking-waterfall.json",
      "runtime/tracking-history.json",
      "runtime/timeline.json",
      "runtime/playback.json",
      "validation/wrapper-chain.json",
      "validation/resolved-ads.json",
      "validation/issues.json",
      "validation/compliance.json",
      "validation/destination.json",
      "validation/asset-audit.json",
    ]) {
      expect(zip.file(path), path).not.toBeNull();
    }

    const requestXml = await zip.file("source/request.xml")?.async("string");
    expect(requestXml).toBe(fixture.payload);

    const report = JSON.parse((await zip.file("report.json")?.async("string")) ?? "{}") as {
      validation: { valid: boolean | null };
    };
    expect(report.validation.valid).toBe(true);
  });
});
