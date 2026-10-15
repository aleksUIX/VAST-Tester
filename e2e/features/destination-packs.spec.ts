import { expect, test } from "@playwright/test";

import { fixtureById } from "../fixtures/index.js";
import { installVastRoutes } from "../lib/routes.js";
import { TesterPage } from "../lib/tester.js";

function destinationSelect(tester: TesterPage) {
  return tester.page.locator("[data-destination-toolbar] select");
}

test.describe("destination packs", () => {
  test("default is spec only; generic OTT passes the clean 2,000 kbps 720p tag", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));

    await expect(destinationSelect(tester)).toHaveValue("none");
    await expect(page.locator("[data-destination-pack]")).toHaveCount(0);

    await destinationSelect(tester).selectOption("destination/generic-ott");
    await tester.openSection("playback");
    await expect(page.locator("[data-destination-pack]")).toHaveAttribute("data-destination-pack", "destination/generic-ott");
    await expect(page.locator("[data-destination-pack]")).toHaveAttribute("data-destination-status", "pass");
    await expect(page.locator("[data-dest-rule]")).toHaveCount(0);
    await expect(page.locator("[data-destination-assignments]")).toContainText("ott-floor");
  });

  test("Netflix hosted fails the same OTT-legal MediaFile", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));
    await destinationSelect(tester).selectOption("destination/netflix-hosted");
    await tester.openSection("playback");

    await expect(page.locator("[data-destination-pack]")).toHaveAttribute("data-destination-status", "fail");
    await expect(page.locator("[data-dest-rule-id='DEST-media-ineligible']")).toBeVisible();
    await expect(tester.section("findings").locator(".panel-head .pill").filter({ hasText: /Netflix/ })).toContainText("fail");
  });

  test("Roku third-party requires the full rendition set", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(fixtureById("inline-clean"));
    await destinationSelect(tester).selectOption("destination/roku-third-party");
    await tester.openSection("playback");

    await expect(page.locator("[data-destination-pack]")).toHaveAttribute("data-destination-status", "fail");
    const missing = page.locator("[data-dest-rule-id='DEST-rendition-missing']");
    await expect(missing).toHaveCount(2);
    await expect(page.locator("[data-destination-pack]")).toContainText("Missing med rendition");
    await expect(page.locator("[data-destination-pack]")).toContainText("Missing low rendition");
  });

  test("Netflix pack flags a QR Icon", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    const xml = fixtureById("inline-clean").payload.replace(
      "</Linear>",
      `<Icons><Icon program="QRCode" width="80" height="80"><StaticResource creativeType="image/png"><![CDATA[https://cdn.adserver-demo.net/qr-code.png]]></StaticResource></Icon></Icons></Linear>`,
    );

    await tester.goto();
    await tester.pasteXml(xml);
    await tester.validate();
    await destinationSelect(tester).selectOption("destination/netflix-hosted");
    await tester.openSection("playback");

    await expect(page.locator("[data-dest-rule-id='DEST-qr-forbidden']")).toBeVisible();
  });

  test("bitrate in bits/sec is normalized for Generic OTT", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    const xml = fixtureById("inline-clean").payload.replace('bitrate="2000"', 'bitrate="2000000"');

    await tester.goto();
    await tester.pasteXml(xml);
    await tester.validate();
    await destinationSelect(tester).selectOption("destination/generic-ott");
    await tester.openSection("playback");

    await expect(page.locator("[data-destination-pack]")).toHaveAttribute("data-destination-status", "pass");
    await expect(page.locator("[data-dest-rule-id='DEST-bitrate-unit']")).toBeVisible();
  });

  test("NBCU third-party fills mezzanine from the Mezzanine node", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<VAST version="4.2">
  <Ad id="nbcu-1"><InLine>
    <AdSystem>demo</AdSystem><AdTitle>nbcu set</AdTitle>
    <Impression><![CDATA[https://example.com/imp]]></Impression>
    <Creatives><Creative><Linear>
      <Duration>00:00:15</Duration>
      <MediaFiles>
        <MediaFile delivery="progressive" type="video/mp4" width="1920" height="1080" bitrate="4000"><![CDATA[https://cdn.adserver-demo.net/high.mp4]]></MediaFile>
        <MediaFile delivery="progressive" type="video/mp4" width="960" height="540" bitrate="1200"><![CDATA[https://cdn.adserver-demo.net/med.mp4]]></MediaFile>
        <MediaFile delivery="progressive" type="video/mp4" width="640" height="360" bitrate="400"><![CDATA[https://cdn.adserver-demo.net/low.mp4]]></MediaFile>
        <Mezzanine delivery="progressive" type="video/mp4" width="1920" height="1080" bitrate="20000"><![CDATA[https://cdn.adserver-demo.net/mezz.mp4]]></Mezzanine>
      </MediaFiles>
    </Linear></Creative></Creatives>
  </InLine></Ad>
</VAST>`;

    await tester.goto();
    await tester.pasteXml(xml);
    await tester.validate();
    await destinationSelect(tester).selectOption("destination/nbcu-third-party");
    await tester.openSection("playback");

    await expect(page.locator("[data-destination-pack]")).toHaveAttribute("data-destination-status", "pass");
    await expect(page.locator("[data-destination-assignments]")).toContainText("mezzanine ← Mezzanine 20000 kbps");
    await expect(page.locator("[data-dest-rule]")).toHaveCount(0);
  });

  test("Netflix hosted rejects declared HEVC on an otherwise eligible 1080p file", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    const xml = fixtureById("inline-clean").payload
      .replace('width="1280" height="720" bitrate="2000"', 'width="1920" height="1080" bitrate="15000" codec="hvc1"');

    await tester.goto();
    await tester.pasteXml(xml);
    await tester.validate();
    await destinationSelect(tester).selectOption("destination/netflix-hosted");
    await tester.openSection("playback");

    await expect(page.locator("[data-destination-pack]")).toHaveAttribute("data-destination-status", "fail");
    await expect(page.locator("[data-dest-rule='DEST-media-ineligible']")).toContainText("hvc1");
  });
});
