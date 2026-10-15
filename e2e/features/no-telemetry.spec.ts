import { expect, test } from "@playwright/test";
import { fixtureById } from "../fixtures/index.js";
import { installVastRoutes } from "../lib/routes.js";
import { TesterPage } from "../lib/tester.js";

test("custom XML validates without a collection or proxy request", async ({ page, baseURL }) => {
  const routes = await installVastRoutes(page, baseURL);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const tester = new TesterPage(page);
  await tester.goto();
  const xml = fixtureById("inline-clean").payload.replace(/<AdTitle>[^<]*</, "<AdTitle>Partner creative<");
  await tester.xmlInput.focus();
  await page.evaluate((content) => {
    document.querySelector("#vast-xml")!.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true, clipboardData: (() => { const data = new DataTransfer(); data.setData("text", content); return data; })(),
    }));
  }, xml);
  await tester.pasteXml(xml);
  await tester.validate();
  expect(await tester.metric("valid")).toBe("yes");
  expect(requests.filter((url) => new URL(url).hostname === "vastlint.org")).toEqual([]);
  expect(routes.unexpectedRequests).toEqual([]);
});
