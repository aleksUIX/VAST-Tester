import { expect, test } from "@playwright/test";

import { FIXTURES, fixtureById } from "../fixtures/index.js";
import { installVastRoutes } from "../lib/routes.js";
import { TesterPage } from "../lib/tester.js";

test.describe("source panel", () => {
  test("the bundled sample validates on first load", async ({ page, baseURL }) => {
    const routes = await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();

    expect(await tester.status()).toBe("ready");
    await expect(tester.statusbar).toHaveAttribute("data-source", "xml");
    await expect(tester.statusbar).toHaveAttribute("data-action", "validate");
    expect(await tester.metric("valid")).toBe("yes");
    await expect(tester.xmlInput).toHaveValue(/<VAST/);
    expect(routes.unexpectedRequests).toEqual([]);
  });

  test("load sample restores the bundled tag after a clear", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.clear();
    await expect(tester.xmlInput).toHaveValue("");

    await tester.button("Load sample").click();
    await expect(tester.xmlInput).toHaveValue(/<VAST/);

    await tester.validate();
    expect(await tester.metric("valid")).toBe("yes");
  });

  test("run buttons disable while there is nothing to run", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.clear();

    for (const name of ["Validate", "Resolve wrappers", "Auto-fix", "Clear"]) {
      await expect(tester.button(name), name).toBeDisabled();
    }

    await tester.pasteXml("<VAST/>");
    await expect(tester.button("Validate")).toBeEnabled();
    await expect(tester.button("Clear")).toBeEnabled();
  });

  test("the URL field rejects anything that is not an http(s) URL", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.setUrl("not-a-url");

    await expect(tester.sourceTag).toHaveText("Remote URL is active");
    await expect(page.locator(".field-error")).toHaveText(/full http:\/\/ or https:\/\/ URL/);
    await expect(tester.button("Fetch and validate")).toBeDisabled();

    await tester.setUrl("https://ssp-demo.exchange-partner.net/vast/no-fill.xml");
    await expect(page.locator(".field-error")).toHaveCount(0);
    await expect(tester.button("Fetch and validate")).toBeEnabled();
  });

  test("editing either input switches the active source", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await expect(tester.sourceTag).toHaveText("Editor XML is active");

    await tester.setUrl("https://ssp-demo.exchange-partner.net/vast/no-fill.xml");
    await expect(tester.sourceTag).toHaveText("Remote URL is active");

    await tester.xmlInput.focus();
    await expect(tester.sourceTag).toHaveText("Editor XML is active");
  });

  test("a fetched response that is not VAST XML surfaces the blocked-fetch banner", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    // Registered after installVastRoutes, so it wins: the URL resolves, but to HTML.
    await page.route("https://cdn.adserver-demo.net/vast/not-vast.xml", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*", "content-type": "text/html" },
        body: "<html><body>an ad server error page</body></html>",
      });
    });
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.setUrl("https://cdn.adserver-demo.net/vast/not-vast.xml");
    await tester.fetchAndValidate();

    await expect(tester.errorBanner.filter({ hasText: "was not VAST XML" })).toBeVisible();
    expect(await tester.metric("valid")).toBe("no");
  });

  test("a fetch that fails outright surfaces an error banner", async ({ page, baseURL }) => {
    const routes = await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.setUrl("https://unknown-host.example.org/vast.xml");
    await tester.fetchAndValidate();

    await expect(tester.errorBanner).toBeVisible();
    // A failed direct fetch must not send the tag to an external proxy.
    expect(routes.unexpectedRequests.some((url) => url.includes("unknown-host.example.org"))).toBe(true);
    expect(routes.unexpectedRequests.some((url) => url.includes("vast-proxy"))).toBe(false);
  });

  test("auto-fix repairs the tag and apply-fix re-validates it", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    const fixture = fixtureById("insecure-media");

    await tester.goto();
    await tester.clear();
    await tester.pasteXml(fixture.payload);
    await tester.validate();

    const applyButton = tester.button("Apply fix and validate");
    await expect(applyButton).toBeDisabled();

    await tester.autoFix();
    await expect(tester.successBanner).toHaveText(/Applied \d+ deterministic fix/);
    await expect(applyButton).toBeEnabled();

    await tester.applyFix();
    const fixedXml = await tester.xmlInput.inputValue();
    expect(fixedXml).toContain("https://");
    expect(fixedXml).not.toMatch(/\bhttp:\/\//);
    expect(await tester.metric("valid")).toBe("yes");
    // Applying queues a plain validate, which discards the pending fix.
    await expect(applyButton).toBeDisabled();
  });

  test("editing after a run marks the inline markers as stale", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(FIXTURES[1]);
    await expect(page.locator(".editor-inline-marker").first()).toBeAttached();

    await tester.xmlInput.evaluate((node: HTMLTextAreaElement) => {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
    await tester.xmlInput.press("End");
    await tester.xmlInput.pressSequentially(" ");

    await expect(page.locator(".editor-status-note", { hasText: "Markers reflect the previous run" })).toBeVisible();
    await expect(page.locator(".editor-inline-marker")).toHaveCount(0);
  });
});
