import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";

import { REMOTE_VAST_DOCUMENTS, remoteVastBody } from "../fixtures/index.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
  "access-control-allow-headers": "*",
};

/** Hosts the fixtures pretend to be. Anything else off-origin is refused. */
const DEMO_HOST_PATTERN =
  /(adserver-demo|exchange-partner|bidder-partner|streaming-partner|vpaid-vendor-demo|ctv-cdn-demo|ctv-adserver-demo|legacy-cdn-demo|legacy-adserver-demo|legacy-brand-demo|brand-demo|measurement-demo|viewability-demo|privacy-demo|publisher-demo)\./;

/** Third parties the app loads in production that a test should block silently. */
const IGNORED_HOST_PATTERN = /(googletagmanager\.com|google-analytics\.com|doubleclick\.net|complianceomsdk\.iabtechlab\.com)/;

/** Placeholder-image CDN some scenario presets use for companion/icon previews. */
const PLACEHOLDER_IMAGE_PATTERN = /dummyimage\.com/;

/** A 1x1 transparent PNG, so preview <img> elements actually load. */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function localAsset(relativePath: string) {
  return readFileSync(join(PUBLIC_DIR, relativePath));
}

function isAppOrigin(url: string, baseURL: string | undefined) {
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    return true;
  }

  if (!baseURL) {
    return url.includes("localhost") || url.includes("127.0.0.1");
  }

  return url.startsWith(new URL(baseURL).origin);
}

export interface RouteRecorder {
  /** Off-origin URLs no fixture covers. A non-empty list means the run was not hermetic. */
  unexpectedRequests: string[];
  /** Beacon URLs the app actually fired, in order. */
  beacons: string[];
}

/**
 * Serves every remote asset the fixtures reference and refuses everything else,
 * so a run is reproducible offline and a stray third-party request fails loudly
 * instead of silently changing the result.
 *
 * Playwright checks routes in reverse registration order, so these are declared
 * broadest first: the catch-all guard is consulted last.
 */
export async function installVastRoutes(page: Page, baseURL?: string): Promise<RouteRecorder> {
  const recorder: RouteRecorder = { unexpectedRequests: [], beacons: [] };

  // 1. Guard: app origin passes through, anything else unrecognised is blocked.
  await page.route("**/*", async (route: Route) => {
    const url = route.request().url();

    if (isAppOrigin(url, baseURL)) {
      await route.continue();
      return;
    }

    if (!IGNORED_HOST_PATTERN.test(url)) {
      recorder.unexpectedRequests.push(url);
    }

    await route.abort("blockedbyclient");
  });

  // 1b. Placeholder preview images used by scenario presets.
  await page.route(PLACEHOLDER_IMAGE_PATTERN, async (route: Route) => {
    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "image/png" },
      body: PLACEHOLDER_PNG,
    });
  });

  // 1c. example.com beacons used by local scenario XML (impression, tracking, SIMID reportTracking).
  await page.route(/https?:\/\/example\.com\//, async (route: Route) => {
    recorder.beacons.push(route.request().url());
    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "image/gif" },
      body: "",
    });
  });

  // 2. Impression, tracking, error and click beacons on the demo hosts.
  await page.route(DEMO_HOST_PATTERN, async (route: Route) => {
    recorder.beacons.push(route.request().url());
    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "image/gif" },
      body: "",
    });
  });

  // 3. Creative media. Real bytes, so the playback console actually plays.
  await page.route(/^https?:\/\/[^/]+\/.*\.(mp4|webm)(\?.*)?$/, async (route: Route) => {
    const url = route.request().url();
    if (isAppOrigin(url, baseURL)) {
      await route.continue();
      return;
    }

    const isWebm = url.toLowerCase().includes(".webm");
    const fallback = isWebm ? "fixtures/video/360p30.webm" : "fixtures/video/360p30.mp4";
    let relative = fallback;
    try {
      const pathname = new URL(url).pathname;
      const named = pathname.match(/\/fixtures\/video\/([^/]+\.(mp4|webm))$/i);
      if (named) {
        const candidate = `fixtures/video/${named[1]}`;
        if (existsSync(join(PUBLIC_DIR, candidate))) {
          relative = candidate;
        }
      }
    } catch {
      // Keep the color-bar fallback if the URL cannot be parsed.
    }

    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": isWebm ? "video/webm" : "video/mp4" },
      body: localAsset(relative),
    });
  });

  // 4. Verification and VPAID scripts.
  await page.route(/^https?:\/\/[^/]+\/.*\.js(\?.*)?$/, async (route: Route) => {
    const url = route.request().url();
    if (isAppOrigin(url, baseURL)) {
      await route.continue();
      return;
    }

    const file = url.includes("vpaid") ? "fixtures/vpaid/vpaid-example.js" : "fixtures/omid/omid-session-client-v1.js";
    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "application/javascript" },
      body: localAsset(file),
    });
  });

  // 5. VAST documents, including every wrapper hop. Most specific, checked first.
  for (const url of Object.keys(REMOTE_VAST_DOCUMENTS)) {
    await page.route(url, async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, "content-type": "application/xml; charset=utf-8" },
        body: remoteVastBody(url) ?? "",
      });
    });
  }

  return recorder;
}
