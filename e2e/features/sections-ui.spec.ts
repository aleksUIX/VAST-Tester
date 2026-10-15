import { expect, test } from "@playwright/test";

import { FIXTURES, fixtureById, type SectionId } from "../fixtures/index.js";
import { installVastRoutes } from "../lib/routes.js";
import { TesterPage } from "../lib/tester.js";

const ALL_SECTIONS: SectionId[] = [
  "findings",
  "wrappers",
  "resolved",
  "playback",
  "tracking",
  "runtime",
  "macros",
  "export",
];

test.describe("app chrome", () => {
  test("masthead links reference IAB standards and feedback", async ({ page, baseURL }) => {
    const routes = await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    await tester.goto();
    const links = [
      ["VAST spec", "https://iabtechlab.com/standards/vast/"],
      ["VAST on GitHub", "https://github.com/InteractiveAdvertisingBureau/VAST"],
      ["Report an issue", "https://github.com/IABTechLab/VAST-Tester/issues"],
    ];
    for (const [name, href] of links) {
      const link = page.locator(".masthead-links a", { hasText: name });
      await expect(link).toHaveAttribute("href", href);
      await expect(link).toHaveAttribute("target", "_blank");
    }
    await expect(page.locator('a[href*="vastlint.org"], a[href^="mailto:"]')).toHaveCount(0);
    expect(routes.unexpectedRequests).toEqual([]);
  });

  test("the footer links to IAB issue tracking", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    await tester.goto();
    const footer = page.locator(".app-footer");
    await expect(footer).toContainText("IAB Tech Lab VAST Tester");
    await expect(footer.locator('a[href="https://github.com/IABTechLab/VAST-Tester/issues"]')).toHaveText("Report an issue");
  });
});

test.describe("section behaviour", () => {
  test("every section header toggles open and closed", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    await tester.goto();

    for (const id of ALL_SECTIONS) {
      const before = await tester.sectionIsOpen(id);
      await tester.clickInView(tester.sectionHeader(id));
      await expect(tester.section(id), id).toHaveAttribute("data-open", String(!before));
      await tester.clickInView(tester.sectionHeader(id));
      await expect(tester.section(id), id).toHaveAttribute("data-open", String(before));
    }
  });

  test("a manually collapsed section stays collapsed until its content changes", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);

    await tester.goto();
    await tester.runFixture(FIXTURES[1]);
    await expect(tester.section("findings")).toHaveAttribute("data-open", "true");

    await tester.clickInView(tester.sectionHeader("findings"));
    await expect(tester.section("findings")).toHaveAttribute("data-open", "false");

    // Same tag, same finding count: the auto-open effect must not fight the user.
    await tester.validate();
    await expect(tester.section("findings")).toHaveAttribute("data-open", "false");

    // A clear resets the counts, so the next bad run re-opens it.
    await tester.clear();
    await tester.pasteXml(FIXTURES[1].payload);
    await tester.validate();
    await expect(tester.section("findings")).toHaveAttribute("data-open", "true");
  });

  test("the status bar mirrors the run context for URL runs", async ({ page, baseURL }) => {
    await installVastRoutes(page, baseURL);
    const tester = new TesterPage(page);
    const fixture = fixtureById("wrapper-chain");

    await tester.goto();
    await tester.runFixture(fixture);

    await expect(tester.statusbar).toHaveAttribute("data-source", "url");
    await expect(tester.statusbar).toHaveAttribute("data-action", "resolve");
    await expect(tester.statusbar).toContainText("remote URL");
    expect(await tester.metric("hops")).toBe("3");
  });
});
