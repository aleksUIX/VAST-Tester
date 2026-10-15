import { expect, type Locator, type Page } from "@playwright/test";

import type { Fixture, LensId, LensStatus, SectionId } from "../fixtures/index.js";

const METRIC_KEYS = ["errors", "warnings", "info", "hops", "ads", "valid"] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Record<MetricKey, string>;

const RUN_TIMEOUT = 30_000;

/** Session statuses that mean a run is still in flight. */
const TRANSIENT_STATUSES = new Set(["loading", "validating", "fixing"]);

/**
 * Page object for the tester UI. Everything the smoke suite and the demo
 * recorder touch goes through here, so a UI change is a one-file fix.
 */
export class TesterPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ---- navigation -------------------------------------------------------

  async goto() {
    // Relative, not "/": a deployment can live under a subpath.
    await this.page.goto("./");
    await expect(this.statusbar).toBeVisible();
    await this.waitForIdle();
  }

  // ---- locators ---------------------------------------------------------

  get statusbar(): Locator {
    return this.page.locator(".statusbar");
  }

  get urlInput(): Locator {
    return this.page.locator("#vast-url");
  }

  get xmlInput(): Locator {
    return this.page.locator("#vast-xml");
  }

  get sourcePanel(): Locator {
    return this.page.locator('[data-section="source"]');
  }

  button(name: string): Locator {
    return this.page.getByRole("button", { name, exact: true });
  }

  section(id: SectionId): Locator {
    return this.page.locator(`[data-section="${id}"]`);
  }

  sectionHeader(id: SectionId): Locator {
    return this.section(id).locator(".panel-head");
  }

  lens(id: LensId): Locator {
    return this.page.locator(`[data-lens="${id}"]`);
  }

  get findingsRows(): Locator {
    return this.section("findings").locator(".table-row");
  }

  get scenarioToggle(): Locator {
    return this.page.locator(".scenario-toggle");
  }

  get scenarioBody(): Locator {
    return this.page.locator(".scenario-body");
  }

  get scenarioRows(): Locator {
    return this.page.locator(".scenario-row");
  }

  scenarioRow(label: string): Locator {
    return this.scenarioRows.filter({ has: this.page.locator("strong", { hasText: label }) }).first();
  }

  /** The Version / Action / Surface selects, by their visible label. */
  scenarioFilter(name: "Version" | "Action" | "Surface"): Locator {
    return this.page.locator(".scenario-filter", { hasText: name }).locator("select");
  }

  get scenarioSearch(): Locator {
    return this.page.locator(".scenario-search input");
  }

  get successBanner(): Locator {
    return this.page.locator(".banner.success");
  }

  get errorBanner(): Locator {
    return this.page.locator(".banner.error");
  }

  get sourceTag(): Locator {
    return this.page.locator(".source-panel .panel-meta .tag");
  }

  get macroRows(): Locator {
    return this.page.locator(".macro-row");
  }

  get macroPresetSelect(): Locator {
    return this.page.locator(".macro-picker select");
  }

  get macroPreviewRows(): Locator {
    return this.page.locator(".macro-preview-list .timeline-item");
  }

  get runnerVideo(): Locator {
    return this.page.locator(".runner-video");
  }

  get waterfallRows(): Locator {
    return this.section("tracking").locator(".table-row");
  }

  waterfallRow(event: string): Locator {
    return this.waterfallRows.filter({
      has: this.page.locator('[data-label="Event"] strong', { hasText: new RegExp(`^${event}$`) }),
    });
  }

  get timelineItems(): Locator {
    return this.section("playback").locator(".timeline-item");
  }

  timelineItem(title: string): Locator {
    return this.timelineItems.filter({ has: this.page.locator("strong", { hasText: title }) });
  }

  get milestonesValue(): Locator {
    return this.section("playback").locator("dl div", { hasText: "Milestones" }).locator("dd");
  }

  /** Value of a metric tile inside a section, by its data-metric slug. */
  async sectionMetric(id: SectionId, slug: string): Promise<string> {
    const value = await this.section(id)
      .locator(`[data-metric="${slug}"] [data-metric-value]`)
      .getAttribute("data-metric-value");
    return value ?? "";
  }

  // ---- reads ------------------------------------------------------------

  async status(): Promise<string> {
    return (await this.statusbar.getAttribute("data-status")) ?? "";
  }

  /** Monotonic id of the run the UI is currently showing. */
  async runId(): Promise<string> {
    return (await this.statusbar.getAttribute("data-run")) ?? "";
  }

  async isBusy(): Promise<boolean> {
    return (await this.statusbar.getAttribute("data-busy")) === "true";
  }

  async metric(key: MetricKey): Promise<string> {
    const value = await this.statusbar
      .locator(`[data-metric="${key}"] [data-metric-value]`)
      .getAttribute("data-metric-value");
    return value ?? "";
  }

  async metrics(): Promise<Metrics> {
    const entries = await Promise.all(METRIC_KEYS.map(async (key) => [key, await this.metric(key)] as const));
    return Object.fromEntries(entries) as Metrics;
  }

  async lensStatus(id: LensId): Promise<LensStatus> {
    return ((await this.lens(id).getAttribute("data-lens-status")) ?? "pass") as LensStatus;
  }

  async sectionIsOpen(id: SectionId): Promise<boolean> {
    return (await this.section(id).getAttribute("data-open")) === "true";
  }

  async ruleIds(): Promise<string[]> {
    if (!(await this.sectionIsOpen("findings"))) {
      return [];
    }

    return this.section("findings").locator('[data-label="Rule"]').allInnerTexts();
  }

  /**
   * Every findings row as (severity, rule, location). Unlike ruleIds() this
   * opens the section first, so a clean run reports an empty table rather than
   * an unread one.
   */
  async findings(): Promise<Array<{ severity: string; rule: string; location: string }>> {
    await this.openSection("findings");

    return this.findingsRows.evaluateAll((rows) =>
      rows.map((row) => ({
        severity: row.querySelector('[data-label="Severity"]')?.textContent?.trim() ?? "",
        rule: row.querySelector("[data-rule]")?.getAttribute("data-rule") ?? "",
        location: row.querySelector('[data-label="Location"]')?.textContent?.trim() ?? "",
      })),
    );
  }

  // ---- actions ----------------------------------------------------------

  /**
   * Everything the UI derives from a run, as one string. Used to detect that
   * React has finished flushing: the session update arrives in a transition, so
   * the busy flag can clear a render before the results are on screen.
   */
  private async signature(): Promise<string> {
    return this.page.evaluate(() => {
      const statusbar = document.querySelector(".statusbar");
      const metrics = [...document.querySelectorAll(".statusbar [data-metric]")]
        .map((node) => `${node.getAttribute("data-metric") ?? ""}=${node.querySelector("[data-metric-value]")?.getAttribute("data-metric-value") ?? ""}`)
        .join(",");
      const lenses = [...document.querySelectorAll("[data-lens]")]
        .map((node) => `${node.getAttribute("data-lens") ?? ""}=${node.getAttribute("data-lens-status") ?? ""}`)
        .join(",");
      const sections = [...document.querySelectorAll("[data-section]")]
        .map((node) => `${node.getAttribute("data-section") ?? ""}=${node.getAttribute("data-open") ?? ""}`)
        .join(",");

      return [statusbar?.getAttribute("data-status"), statusbar?.getAttribute("data-run"), metrics, lenses, sections].join("|");
    });
  }

  async waitForIdle() {
    await expect.poll(async () => this.isBusy(), { timeout: RUN_TIMEOUT }).toBe(false);

    // The signature below only proves the DOM stopped changing, which a run
    // parked on a slow network fetch also satisfies: status stays "loading",
    // nothing else moves, and two identical reads look settled. Wait out the
    // transient statuses first so a slow deployment cannot read as finished.
    await expect
      .poll(async () => TRANSIENT_STATUSES.has(await this.status()), { timeout: RUN_TIMEOUT })
      .toBe(false);

    let previous = "";
    await expect
      .poll(
        async () => {
          const current = await this.signature();
          const stable = current === previous;
          previous = current;
          return stable;
        },
        { timeout: RUN_TIMEOUT, intervals: [120, 120, 150, 200, 250] },
      )
      .toBe(true);
  }

  /**
   * Clicks something that queues a run, then waits for that specific run to
   * land. Waiting on the busy flag alone would race: the click is processed a
   * tick before React marks the session as running.
   */
  async runAndWait(action: () => Promise<void>) {
    const before = await this.runId();
    await action();
    await expect.poll(async () => this.runId(), { timeout: RUN_TIMEOUT }).not.toBe(before);
    await this.waitForIdle();
  }

  async clear() {
    const clearButton = this.button("Clear");
    if (await clearButton.isEnabled()) {
      await this.runAndWait(async () => { await clearButton.click(); });
    }
  }

  async pasteXml(xml: string) {
    await this.xmlInput.fill(xml);
  }

  async setUrl(url: string) {
    await this.urlInput.fill(url);
  }

  async validate() {
    await this.runAndWait(async () => { await this.button("Validate").click(); });
  }

  async fetchAndValidate() {
    await this.runAndWait(async () => { await this.button("Fetch and validate").click(); });
  }

  async resolveWrappers() {
    await this.runAndWait(async () => { await this.button("Resolve wrappers").click(); });
  }

  async autoFix() {
    await this.runAndWait(async () => { await this.button("Auto-fix").click(); });
  }

  async applyFix() {
    await this.runAndWait(async () => { await this.button("Apply fix and validate").click(); });
  }

  /**
   * Centres a target before clicking. Scrolling it merely "into view" can park
   * it under the sticky status bar, which then swallows the click.
   */
  async clickInView(target: Locator, scrollAnchor?: Locator) {
    await (scrollAnchor ?? target).evaluate((node) => {
      node.scrollIntoView({ block: "center", inline: "nearest" });
    });
    await target.click();
  }

  async openSection(id: SectionId) {
    if (!(await this.sectionIsOpen(id))) {
      await this.sectionHeader(id).click();
    }

    await expect(this.section(id)).toHaveAttribute("data-open", "true");
  }

  async prepareRunner() {
    await this.openSection("playback");
    await this.button("Prepare runner").click();
    await this.waitForIdle();
  }

  /** Loads a fixture into the right input and runs its action. */
  async runFixture(fixture: Fixture) {
    await this.clear();

    if (fixture.mode === "url") {
      await this.setUrl(fixture.payload);
    } else {
      await this.pasteXml(fixture.payload);
    }

    if (fixture.action === "resolve") {
      await this.resolveWrappers();
      return;
    }

    if (fixture.action === "fix") {
      await this.validate();
      await this.autoFix();
      await this.applyFix();
      return;
    }

    if (fixture.mode === "url") {
      await this.fetchAndValidate();
      return;
    }

    await this.validate();
  }
}
