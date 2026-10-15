import { expect, test } from "@playwright/test";

import { installVastRoutes } from "../lib/routes.js";
import { TesterPage } from "../lib/tester.js";

async function openLibrary(tester: TesterPage) {
  if ((await tester.scenarioToggle.getAttribute("aria-expanded")) !== "true") {
    await tester.scenarioToggle.click();
  }
  await expect(tester.scenarioBody).toBeVisible();
}

async function runPreset(tester: TesterPage, label: string) {
  await openLibrary(tester);
  const more = tester.page.locator(".scenario-expand-toggle", { hasText: "more" });
  while ((await more.count()) > 0) {
    await more.first().click();
  }
  await tester.runAndWait(async () => {
    await tester.scenarioRow(label).click();
  });
}

test.describe("QA studio overlays and SIMID", () => {
  test("SIMID studio guide expands without branded media", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    await tester.goto();
    const toggle = page.getByRole("button", { name: /Learn how to test a SIMID session/i });
    await expect(toggle).toBeVisible();
    await expect(page.locator(".simid-guide-steps")).toHaveCount(0);
    await toggle.click();
    await expect(page.locator(".simid-guide-steps li")).toHaveCount(4);
    await expect(page.locator(".simid-guide-steps")).toContainText("accept initialization before starting");
    await expect(page.locator("[data-simid-guide]")).toHaveAttribute("data-simid-guide", "open");
    await expect(page.locator("[data-simid-guide] img, [data-simid-guide] video")).toHaveCount(0);
    await toggle.click();
    await expect(page.locator(".simid-guide-steps")).toHaveCount(0);
    await expect(page.locator("[data-simid-guide]")).toHaveAttribute("data-simid-guide", "closed");
  });

  test("non-linear overlay renders on the playback stage and in runtime", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "Non-linear overlay");

    await tester.openSection("playback");
    await expect(page.locator('[data-qa-stage="overlay"] img')).toBeVisible();

    await tester.openSection("runtime");
    expect(Number(await tester.sectionMetric("runtime", "overlays"))).toBeGreaterThanOrEqual(1);
    await expect(tester.section("runtime").locator(".section-label", { hasText: "Overlay" })).toBeVisible();
  });

  test("SIMID overlay banner handshakes and inspects the creative HTML", async ({ page, baseURL }) => {
    const routes = await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "SIMID overlay banner");

    await tester.openSection("playback");
    await tester.button("Prepare runner").click();
    await tester.waitForIdle();

    await expect(page.locator("[data-simid-iframe]")).toBeVisible();
    await expect(page.locator(".runner-video")).toHaveJSProperty("muted", true);
    await expect(page.locator(".runner-video")).not.toHaveAttribute("controls");
    await expect
      .poll(async () => page.locator(".runner-video").evaluate((node: HTMLVideoElement) => ({
        paused: node.paused,
        mp4: /bbb-360p\.mp4(?:$|\?)/.test(node.currentSrc),
      })), { timeout: 10_000 })
      .toEqual({ paused: false, mp4: true });
    await expect(page.locator("[data-simid-transport]")).toBeVisible();
    await expect
      .poll(async () => page.locator("[data-simid-step]").getAttribute("data-simid-step"), { timeout: 10_000 })
      .toBe("started");
    const overlayFrame = page.locator("[data-simid-iframe]").contentFrame();
    await expect(overlayFrame.locator("#root.live")).toBeVisible();
    await expect(overlayFrame.locator(".banner.shown")).toBeVisible({ timeout: 5_000 });
    await overlayFrame.getByRole("button", { name: "Pause ad" }).click();
    await expect(page.locator("[data-simid-log]")).toContainText("Creative:requestPause");
    await expect(overlayFrame.getByRole("button", { name: "Resume ad" })).toBeVisible();
    await overlayFrame.getByRole("button", { name: "Resume ad" }).click();
    await expect(page.locator("[data-simid-log]")).toContainText("Creative:requestPlay");
    await expect(page.locator("[data-simid-log]")).toContainText("createSession");
    await expect(page.locator("[data-simid-log]")).toContainText("Player:startCreative");
    await expect(page.locator("[data-simid-health]")).toContainText(/Handshake complete|Handshake ran/);
    await expect(page.locator("[data-simid-health]")).toContainText("createSession");
    await expect(page.locator(".qa-simid-log-tools").getByRole("button", { name: "Copy session JSON", exact: true })).toBeVisible();
    await expect(page.locator(".qa-simid-log-tools").getByRole("button", { name: "Copy log", exact: true })).toBeVisible();

    await tester.openSection("runtime");
    expect(Number(await tester.sectionMetric("runtime", "simid"))).toBeGreaterThanOrEqual(1);
    await expect(page.locator("[data-qa='simid-inspect']")).toContainText("text/html");
    await expect
      .poll(async () => page.locator("[data-qa='simid-inspect']").innerText(), { timeout: 10_000 })
      .toMatch(/HTTP 200|Fetch looks like HTML|createSession/i);

    expect(routes.unexpectedRequests).toEqual([]);
  });

  test("IAB SIMID overlay handshakes over the JSON-string protocol", async ({ page, baseURL }) => {
    const routes = await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "IAB SIMID overlay");

    await tester.openSection("playback");
    await tester.button("Prepare runner").click();
    await tester.waitForIdle();

    await expect(page.locator("[data-simid-iframe]")).toBeVisible();
    await expect
      .poll(async () => page.locator("[data-simid-step]").getAttribute("data-simid-step"), { timeout: 10_000 })
      .toBe("started");
    await expect(page.locator("[data-simid-log]")).toContainText("createSession");
    await expect(page.locator("[data-simid-log]")).toContainText("Player:startCreative");
    await expect(page.locator("[data-simid-iframe]").contentFrame().getByRole("button", { name: "Request Pause" })).toBeVisible();

    expect(routes.unexpectedRequests).toEqual([]);
  });

  test("SIMID studio expands to fill the viewport", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "SIMID overlay banner");

    await tester.openSection("playback");
    await tester.button("Expand studio").click();

    const studio = page.locator('[data-simid-studio="expanded"]');
    await expect(studio).toBeVisible();
    const box = await studio.boundingBox();
    const viewport = page.viewportSize();
    expect(box?.width ?? 0).toBeGreaterThan((viewport?.width ?? 0) * 0.9);
    expect(box?.height ?? 0).toBeGreaterThan((viewport?.height ?? 0) * 0.9);
    await expect(page.locator("[data-simid-log]")).toBeVisible();
    await expect(page.locator("[data-qa-stage='overlay']")).toBeVisible();
    await expect(studio).toHaveCSS("background-color", "rgb(11, 11, 11)");
    await expect(page.locator("[data-simid-transport]").getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await page.locator("[data-simid-protocol] summary").click();
    await expect(page.getByRole("button", { name: "Duration +10s" })).toBeVisible();

    await tester.button("Exit studio").click();
    await expect(page.locator('[data-simid-studio="inline"]')).toBeVisible();
  });

  test("SIMID transport sits outside the video stage", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "SIMID overlay banner");

    await tester.openSection("playback");
    await tester.button("Prepare runner").click();
    await tester.waitForIdle();

    await expect
      .poll(async () => page.locator("[data-simid-step]").getAttribute("data-simid-step"), { timeout: 10_000 })
      .toBe("started");

    const stage = await page.locator('[data-qa-stage="overlay"]').boundingBox();
    const play = await page.locator("[data-simid-transport]").getByRole("button", { name: "Play", exact: true }).boundingBox();
    expect(stage).toBeTruthy();
    expect(play).toBeTruthy();
    expect(play?.y ?? 0).toBeGreaterThanOrEqual((stage?.y ?? 0) + (stage?.height ?? 0) - 2);

    await tester.button("Expand studio").click();
    await page.locator("[data-simid-protocol] summary").click();
    await tester.button("Send resize").click();
    await expect(page.locator("[data-simid-log]")).toContainText("Player:resize");
    await tester.button("Duration +10s").click();
    await expect(page.locator("[data-simid-log]")).toContainText("durationchange");
    await expect(page.locator(".qa-simid-log-tools").getByRole("button", { name: "Copy log", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy last" })).toBeVisible();
    const expanded = page.locator('[data-simid-studio="expanded"]');
    await expect(expanded).toHaveCSS("background-color", "rgb(11, 11, 11)");
    const expandedStage = await page.locator('[data-qa-stage="overlay"]').boundingBox();
    const expandedTransport = await page.locator("[data-simid-transport]").boundingBox();
    expect(expandedTransport?.y ?? 0).toBeGreaterThanOrEqual((expandedStage?.y ?? 0) + (expandedStage?.height ?? 0) - 2);
  });

  test("SIMID inline stage stays inside the frame at 1080 by 1350", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1080, height: 1350 });
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "SIMID overlay banner");
    await tester.openSection("playback");
    await tester.button("Prepare runner").click();
    await tester.waitForIdle();
    await expect
      .poll(async () => page.locator("[data-simid-step]").getAttribute("data-simid-step"), { timeout: 10_000 })
      .toBe("started");

    const frame = await page.locator(".simid-studio:not(.is-expanded) .runner-video-frame").boundingBox();
    const stage = await page.locator('[data-qa-stage="overlay"]').boundingBox();
    const video = await page.locator(".qa-stage .runner-video").boundingBox();
    const transport = await page.locator("[data-simid-transport]").boundingBox();
    const side = await page.locator(".qa-simid-side").boundingBox();
    expect(frame).toBeTruthy();
    expect(stage).toBeTruthy();
    expect(video).toBeTruthy();
    expect(transport).toBeTruthy();
    expect(side).toBeTruthy();

    expect(stage!.x).toBeGreaterThanOrEqual(frame!.x - 1);
    expect(stage!.y).toBeGreaterThanOrEqual(frame!.y - 1);
    expect(stage!.x + stage!.width).toBeLessThanOrEqual(frame!.x + frame!.width + 1);
    expect(stage!.y + stage!.height).toBeLessThanOrEqual(frame!.y + frame!.height + 1);
    expect(video!.width).toBeLessThanOrEqual(stage!.width + 1);
    expect(video!.x).toBeGreaterThanOrEqual(stage!.x - 1);
    expect(transport!.y).toBeGreaterThanOrEqual(stage!.y + stage!.height - 2);

    const overlapX = Math.min(stage!.x + stage!.width, side!.x + side!.width) - Math.max(stage!.x, side!.x);
    const overlapY = Math.min(stage!.y + stage!.height, side!.y + side!.height) - Math.max(stage!.y, side!.y);
    expect(overlapX <= 1 || overlapY <= 1).toBe(true);
  });

  test("SIMID protocol explorer pause request reaches the player", async ({ page, baseURL }) => {
    const routes = await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "SIMID protocol explorer");

    await tester.openSection("playback");
    await tester.button("Prepare runner").click();
    await tester.waitForIdle();

    await expect
      .poll(async () => page.locator("[data-simid-step]").getAttribute("data-simid-step"), { timeout: 10_000 })
      .toBe("started");

    const frame = page.frameLocator("[data-simid-iframe]");
    await frame.getByRole("button", { name: "requestPause" }).click();
    await expect(page.locator("[data-simid-log]")).toContainText("Creative:requestPause");

    await frame.getByRole("button", { name: "requestSkip" }).click();
    await expect(page.locator("[data-simid-log]")).toContainText("Rejected");
    await expect(page.locator("[data-simid-health]")).toContainText(/skipoffset/i);

    expect(routes.unexpectedRequests).toEqual([]);
  });

  test("VAST 4.4 pause static fills the stage", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "4.4 pause static");

    await tester.openSection("playback");
    const stageImage = page.locator('[data-overlay-layout="stage"] img');
    await expect(stageImage).toBeVisible();
    await expect(page.locator(".qa-stage-content")).toHaveCount(0);
  });

  test("VAST 4.4 pause SIMID handshakes on the stage", async ({ page, baseURL }) => {
    const routes = await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "4.4 pause SIMID");

    await tester.openSection("playback");
    await tester.button("Prepare runner").click();
    await tester.waitForIdle();

    await expect(page.locator("[data-simid-iframe]")).toBeVisible();
    await expect
      .poll(async () => page.locator("[data-simid-step]").getAttribute("data-simid-step"), { timeout: 10_000 })
      .toBe("started");
    await expect(page.locator("[data-simid-log]")).toContainText("createSession");

    expect(routes.unexpectedRequests).toEqual([]);
  });

  test("SIMID behind a wrapper handshakes only after resolve", async ({ page, baseURL }) => {
    const routes = await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "SIMID behind a wrapper");

    await tester.openSection("playback");
    await expect(page.locator("[data-simid-iframe]")).toBeVisible();
    await expect
      .poll(async () => page.locator("[data-simid-step]").getAttribute("data-simid-step"), { timeout: 10_000 })
      .toBe("started");
    const frame = page.locator("[data-simid-iframe]").contentFrame();
    await expect(frame.getByRole("button", { name: "Matte" })).toBeVisible();
    await expect(frame.getByRole("button", { name: "Gloss" })).toBeVisible();
    await expect(frame.locator("#headline")).toHaveText("Pick a finish");
    await frame.getByRole("button", { name: "Add 5 seconds" }).click();
    await expect(page.locator("[data-simid-log]")).toContainText("requestChangeAdDuration");
    await expect(page.locator("[data-simid-log]")).toContainText("resolve");

    expect(routes.unexpectedRequests).toEqual([]);
  });

  test("pod bumper stays non-interactive until the next ad", async ({ page, baseURL }) => {
    const routes = await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "Bumper then SIMID");

    await tester.openSection("playback");
    await expect(page.locator(".simid-studio-bar").first()).toContainText(/Ad 1 of 2/i);
    await expect(page.locator("[data-simid-iframe]")).toHaveCount(0);
    await expect.poll(async () => page.locator(".runner-video").evaluate((node: HTMLVideoElement) => node.currentSrc)).toMatch(/360p30\.mp4/);

    await page.getByRole("button", { name: "Next ad" }).click();
    await expect(page.locator(".simid-studio-bar").first()).toContainText(/Ad 2 of 2/i);
    await expect(page.locator("[data-simid-iframe]")).toBeVisible();
    await expect
      .poll(async () => page.locator("[data-simid-step]").getAttribute("data-simid-step"), { timeout: 10_000 })
      .toBe("started");
    await expect(page.locator("[data-simid-iframe]").contentFrame().getByRole("button", { name: "Pause ad" })).toBeVisible();
    await expect.poll(async () => page.locator(".runner-video").evaluate((node: HTMLVideoElement) => node.currentSrc)).toMatch(/bbb-360p\.mp4/);

    expect(routes.unexpectedRequests).toEqual([]);
  });

  test("VAST 4.4 pause video plays muted on the stage", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await runPreset(tester, "4.4 pause video");

    await tester.openSection("playback");
    const video = page.locator(".runner-video");
    await expect(video).toBeVisible();
    await expect(video).toHaveJSProperty("muted", true);
  });
});
