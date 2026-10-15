import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { expect, test, type Page } from "@playwright/test";

const playerSource = transpileModule(
  readFileSync(new URL("../../src/qa/simidPlayer.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ModuleKind.ES2022, target: ScriptTarget.ES2022 } },
).outputText;

interface Probe {
  steps: string[];
  messages: Array<{ type: string; messageId: number }>;
  send(type: string, messageId: number, args?: Record<string, unknown>): void;
  start(): void;
}

async function mountPlayer(page: Page) {
  await page.goto("./");
  await page.evaluate(async (source) => {
    const moduleURL = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const { SimidPlayer } = await import(moduleURL);
    URL.revokeObjectURL(moduleURL);
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const steps: string[] = [];
    const messages: Array<{ type: string; messageId: number }> = [];
    iframe.contentWindow!.addEventListener("message", (event) => {
      messages.push(JSON.parse(String(event.data)));
    });
    const size = { x: 0, y: 0, width: 640, height: 360 };
    const host = {
      getVideo: () => null, getStageSize: () => size, getCreativeSize: () => size,
      clickThroughUrl: null, adParameters: null,
      skip() {}, stop() {}, pause() {}, play() {}, setMuted() {}, setVolume() {},
      setFullscreen() {}, setCreativeSize() {},
    };
    const player = new SimidPlayer(host, {
      id: "init-regression", role: "simid-linear", url: "about:blank", skipoffsetSec: 0,
    }, {
      onLog() {}, onClickThrough() {},
      onStep(step: string) { steps.push(step); if (step === "ready") player.startCreative(); },
    });
    player.attach(iframe);
    const probe = {
      steps, messages,
      start: () => player.startCreative(),
      send(type: string, messageId: number, args: Record<string, unknown> = {}) {
        window.dispatchEvent(new MessageEvent("message", {
          source: iframe.contentWindow,
          data: JSON.stringify({ sessionId: "init-regression", messageId, type, args, timestamp: Date.now() }),
        }));
      },
    };
    (window as unknown as { probe: Probe }).probe = probe;
    probe.send("createSession", 0);
  }, playerSource);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { probe: Probe }).probe.messages.some((message) => message.type === "SIMID:Player:init"),
  )).toBe(true);
}

async function acknowledge(page: Page, type: "resolve" | "reject") {
  await page.evaluate((ackType) => {
    const probe = (window as unknown as { probe: Probe }).probe;
    const init = probe.messages.find((message) => message.type === "SIMID:Player:init")!;
    probe.send(ackType, 100, { messageId: init.messageId, value: { errorCode: 1100, message: "Init rejected" } });
  }, type);
}

async function state(page: Page) {
  return page.evaluate(() => {
    const { steps, messages } = (window as unknown as { probe: Probe }).probe;
    return { steps, started: messages.some((message) => message.type === "SIMID:Player:startCreative") };
  });
}

test("SIMID waits for delayed init acceptance before startCreative", async ({ page }) => {
  await mountPlayer(page);
  await page.evaluate(() => (window as unknown as { probe: Probe }).probe.start());
  expect(await state(page)).toEqual({ steps: ["waiting-session", "init"], started: false });
  await acknowledge(page, "resolve");
  await expect.poll(() => state(page)).toEqual({ steps: ["waiting-session", "init", "ready", "started"], started: true });
});

test("SIMID init rejection fails without starting the creative", async ({ page }) => {
  await mountPlayer(page);
  await acknowledge(page, "reject");
  await expect.poll(() => state(page)).toEqual({ steps: ["waiting-session", "init", "failed"], started: false });
  await page.evaluate(() => (window as unknown as { probe: Probe }).probe.start());
  expect((await state(page)).started).toBe(false);
});

test("SIMID missing init acknowledgment times out without starting", async ({ page }) => {
  await page.clock.install();
  await mountPlayer(page);
  await page.clock.runFor(8100);
  expect(await state(page)).toEqual({ steps: ["waiting-session", "init", "failed"], started: false });
});
