import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { fixtureById } from "../fixtures/index.js";
import { installVastRoutes } from "../lib/routes.js";
import { TesterPage } from "../lib/tester.js";

const SCENARIO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "scenarios");

function scenarioXml(file: string) {
  return readFileSync(join(SCENARIO_DIR, file), "utf8");
}

async function prepare(tester: TesterPage) {
  await tester.prepareRunner();
  await expect(tester.runnerVideo).toBeVisible();
  await expect
    .poll(async () => tester.sectionMetric("playback", "media"), { timeout: 15_000 })
    .toMatch(/^video\//);
}

async function playVideo(page: Page) {
  await page.locator(".runner-video").evaluate((video: HTMLVideoElement) => video.play());
}

async function fastForward(page: Page, rate: number) {
  await page.locator(".runner-video").evaluate((video: HTMLVideoElement, target) => {
    video.playbackRate = target;
  }, rate);
}

test.describe("playback console", () => {
  test("runner controls stay disabled until the runner is prepared", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));
    await tester.openSection("playback");

    // Mute follows the stage URL, which the tag already supplies. The rest
    // of the toolbar waits on a prepared runner.
    await expect(tester.button("Unmute")).toBeEnabled();
    for (const name of ["Track click", "Skip ad", "Signal error", "Viewable", "Not viewable", "Undetermined"]) {
      await expect(tester.button(name), name).toBeDisabled();
    }
    await expect(tester.button("Prepare runner")).toBeEnabled();
  });

  test("prepare resolves playable media and start dispatches impression and start", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));
    await prepare(tester);

    await expect(tester.timelineItem("runner:prepare").first()).toBeVisible();
    await expect(tester.runnerVideo).toHaveAttribute("src", /brand-q3-15\.mp4/);

    await playVideo(page);

    await expect.poll(async () => tester.milestonesValue.textContent(), { timeout: 15_000 }).toContain("start");
    await expect(tester.waterfallRow("impression").locator('[data-label="Status"] .pill')).toHaveText("ok");
    await expect(tester.waterfallRow("start").locator('[data-label="Status"] .pill')).toHaveText("ok");
  });

  test("quartile milestones and completion fire as playback progresses", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));
    await prepare(tester);
    await playVideo(page);
    await expect.poll(async () => tester.milestonesValue.textContent(), { timeout: 15_000 }).toContain("start");

    // Play the 17s clip at 8x: quartiles fire through genuine continuous
    // progress (a seek past a quartile deliberately suppresses it).
    await fastForward(page, 8);
    for (const milestone of ["firstQuartile", "midpoint", "thirdQuartile", "complete"]) {
      await expect
        .poll(async () => tester.milestonesValue.textContent(), { timeout: 20_000 })
        .toContain(milestone);
    }
    await expect(tester.timelineItem("video:ended").first()).toBeVisible();

    for (const event of ["firstQuartile", "midpoint", "thirdQuartile", "complete"]) {
      await expect(
        tester.waterfallRow(event).locator('[data-label="Status"] .pill'),
        event,
      ).toHaveText("ok");
    }
  });

  test("mute, click, skip, and error controls drive tracking", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));
    await prepare(tester);

    await tester.button("Unmute").click();
    await expect(tester.button("Mute")).toBeVisible();
    await expect(tester.timelineItem("runner:unmute").first()).toBeVisible();
    expect(await tester.runnerVideo.evaluate((video: HTMLVideoElement) => video.muted)).toBe(false);

    await tester.button("Mute").click();
    await expect(tester.button("Unmute")).toBeVisible();
    await expect(tester.timelineItem("runner:mute").first()).toBeVisible();
    expect(await tester.runnerVideo.evaluate((video: HTMLVideoElement) => video.muted)).toBe(true);

    await tester.button("Track click").click();
    await expect(tester.timelineItem("runner:click").first()).toBeVisible();
    await expect(tester.waterfallRow("clickTracking").first().locator('[data-label="Status"] .pill')).toHaveText("ok");
    // Click-throughs are navigations, not beacons: never auto-fired.
    await expect(tester.waterfallRow("clickThrough").first().locator('[data-label="Status"] .pill')).toHaveText("linked");

    await tester.button("Signal error").click();
    await expect(tester.timelineItem("runner:signal-error").first()).toBeVisible();
    const errorRow = tester.waterfallRow("error").first();
    await expect(errorRow.locator('[data-label="Status"] .pill')).toHaveText("ok");
    // The ERRORCODE macro from the active set is expanded into the fired URL.
    await expect(errorRow).toContainText("code=901");

    await tester.button("Skip ad").click();
    await expect(tester.timelineItem("runner:skip").first()).toBeVisible();
  });

  test("viewability controls update state and tracking", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.clear();
    await tester.pasteXml(scenarioXml("viewable-impression.xml"));
    await tester.validate();
    await prepare(tester);

    expect(await tester.sectionMetric("playback", "viewability")).toBe("not set");

    await tester.button("Viewable").click();
    await expect(tester.timelineItem("viewability:viewable").first()).toBeVisible();
    await expect.poll(async () => tester.sectionMetric("playback", "viewability")).toBe("viewable");

    await tester.button("Not viewable").click();
    await expect.poll(async () => tester.sectionMetric("playback", "viewability")).toBe("notViewable");

    await tester.button("Undetermined").click();
    await expect.poll(async () => tester.sectionMetric("playback", "viewability")).toBe("viewUndetermined");
  });
});

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

test.describe("player profile media pick", () => {
  test("Roku RAF drops WebM and prefers HLS over MP4", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "Mezzanine support");
    await tester.openSection("playback");

    const panel = page.locator("[data-player-profile]");
    await expect(panel).toHaveAttribute("data-player-profile", "web-browser");
    await expect(panel.locator('[data-player-media-status="picked"]')).toContainText("video/mp4");
    await expect(panel.locator('[data-player-media-type="video/webm"]')).toHaveAttribute("data-player-media-status", "playable");
    await expect(panel.locator('[data-player-media-type="application/x-mpegURL"]')).toHaveAttribute("data-player-media-status", "playable");

    await page.getByLabel("Player profile").selectOption("roku-raf");
    await expect(panel).toHaveAttribute("data-player-profile", "roku-raf");
    await expect(panel.locator('[data-player-media-type="video/webm"]')).toHaveAttribute("data-player-media-status", "dropped");
    await expect(panel.locator('[data-player-media-type="video/webm"]')).toContainText("not supported");
    await expect(panel.locator('[data-player-media-status="picked"]')).toContainText("application/x-mpegURL");
    await expect(panel).toContainText("Chromium will not decode it here");
  });

  test("SIMID handshake stays up on Fire TV", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "SIMID overlay banner");
    await tester.openSection("playback");

    await expect(page.locator("[data-simid-iframe]")).toBeVisible();
    await page.getByLabel("Player profile").selectOption("fire-tv");
    await expect(page.locator("[data-player-profile]")).toHaveAttribute("data-player-profile", "fire-tv");
    await expect(page.locator("[data-player-profile]")).toContainText("SIMID 1.1");
    await expect(page.locator("[data-player-profile] .runtime-chip").filter({ hasText: "SIMID" })).toHaveAttribute("title", /studio speaks SIMID/);
    await expect(page.locator("[data-player-profile]")).not.toContainText("SIMID off");
    await expect(page.locator("[data-simid-iframe]")).toBeVisible();
  });
});
