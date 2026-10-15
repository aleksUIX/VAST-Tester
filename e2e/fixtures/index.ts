import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "vast");

export type LensId = "strict-iab" | "ctv-safe" | "ssai-safe" | "legacy-player";
export type LensStatus = "pass" | "attention" | "fail";
export type SectionId =
  | "findings"
  | "wrappers"
  | "resolved"
  | "playback"
  | "tracking"
  | "runtime"
  | "macros"
  | "export";

/** A numeric assertion: an exact value, or a bound. */
export type CountAssertion = number | { min?: number; max?: number };

export interface FixtureExpectations {
  /** Value of the "Valid" tile in the status bar. */
  valid: "yes" | "no" | "n/a";
  errors: CountAssertion;
  warnings?: CountAssertion;
  info?: CountAssertion;
  hops?: CountAssertion;
  ads?: CountAssertion;
  /** Rule ids that must show up in the findings table. */
  ruleIds?: string[];
  /** Compliance lens verdicts that must hold. */
  lens?: Partial<Record<LensId, LensStatus>>;
  /** Sections that must have opened themselves once the run finished. */
  sectionsOpen?: SectionId[];
}

export interface Fixture {
  id: string;
  /** Short label used in test titles and demo captions. */
  label: string;
  /** One line of adops context: why this tag matters. */
  context: string;
  mode: "xml" | "url";
  /** Inline XML payload (xml mode) or the tag URL to fetch (url mode). */
  payload: string;
  /** Action to run. "fix" runs auto-fix and then applies the result. */
  action: "validate" | "resolve" | "fix";
  expect: FixtureExpectations;
}

function xml(file: string) {
  return readFileSync(join(FIXTURE_DIR, file), "utf8");
}

/**
 * Remote VAST documents, keyed by the URL the app will request. Playwright
 * fulfils these from disk so the suite never touches the public internet while
 * still showing partner-shaped URLs on screen.
 */
export const REMOTE_VAST_DOCUMENTS: Record<string, string> = {
  "https://ssp-demo.exchange-partner.net/vast/wrapper-root.xml": "08-wrapper-root.xml",
  "https://dsp-demo.bidder-partner.net/vast/wrapper-hop2.xml": "08-wrapper-hop2.xml",
  "https://cdn.adserver-demo.net/vast/inline-final.xml": "08-wrapper-inline.xml",
  "https://ssp-demo.exchange-partner.net/vast/no-fill.xml": "09-no-fill.xml",
  "https://ssai-demo.streaming-partner.net/vast/ad-break.xml": "10-ssai-no-error.xml",
};

export function remoteVastBody(url: string): string | null {
  const file = REMOTE_VAST_DOCUMENTS[url];
  return file ? xml(file) : null;
}

export const FIXTURES: readonly Fixture[] = [
  {
    id: "inline-clean",
    label: "Clean VAST 4.2 inline",
    context: "The tag every buyer wishes they received: required nodes present, HTTPS assets, full quartile set.",
    mode: "xml",
    payload: xml("01-inline-clean.xml"),
    action: "validate",
    expect: {
      valid: "yes",
      errors: 0,
      warnings: 0,
      info: 0,
      hops: 1,
      ads: 1,
      lens: { "strict-iab": "pass", "ctv-safe": "pass", "ssai-safe": "pass", "legacy-player": "pass" },
      sectionsOpen: ["resolved", "tracking"],
    },
  },
  {
    id: "missing-required",
    label: "Missing required elements",
    context: "A partner tag with no AdSystem, no AdServingId, no Duration. This is the classic 'why won't it serve' ticket.",
    mode: "xml",
    payload: xml("02-missing-required.xml"),
    action: "validate",
    expect: {
      valid: "no",
      errors: 4,
      warnings: { min: 1 },
      ads: 1,
      ruleIds: [
        "VAST-2.0-inline-adsystem",
        "VAST-4.1-adservingid-present",
        "VAST-4.0-universaladid-present",
        "VAST-2.0-linear-duration",
      ],
      lens: { "strict-iab": "fail", "ctv-safe": "fail", "ssai-safe": "fail", "legacy-player": "fail" },
      sectionsOpen: ["findings"],
    },
  },
  {
    id: "insecure-media",
    label: "Insecure HTTP assets",
    context: "Every URL is plain HTTP. It will be blocked on an HTTPS page, and vastlint can repair it deterministically.",
    mode: "xml",
    payload: xml("03-insecure-media.xml"),
    action: "fix",
    expect: {
      valid: "yes",
      errors: 0,
      warnings: 0,
      ads: 1,
      lens: { "strict-iab": "pass", "legacy-player": "pass" },
      sectionsOpen: ["resolved"],
    },
  },
  {
    id: "vpaid-legacy",
    label: "Legacy VPAID unit",
    context: "A VAST 3.0 VPAID JavaScript creative. Fine on desktop web, dead on CTV.",
    mode: "xml",
    payload: xml("04-vpaid-legacy.xml"),
    action: "validate",
    expect: {
      valid: "yes",
      errors: 0,
      warnings: 0,
      ads: 1,
      lens: { "strict-iab": "pass", "ctv-safe": "fail" },
      sectionsOpen: ["runtime"],
    },
  },
  {
    id: "omid-verification",
    label: "OMID verification resources",
    context: "Two AdVerifications vendors with OM SDK scripts. Measurement teams need to see these resolve.",
    mode: "xml",
    payload: xml("05-omid-verification.xml"),
    action: "validate",
    expect: {
      valid: "yes",
      errors: 0,
      warnings: { min: 2 },
      ads: 1,
      ruleIds: ["VAST-4.1-verification-vendor-format", "VAST-4.1-verification-parameters"],
      sectionsOpen: ["runtime"],
    },
  },
  {
    id: "companion-icons",
    label: "Companion banner and AdChoices icon",
    context: "Linear plus a 300x250 companion and an AdChoices icon, rendered as real previews.",
    mode: "xml",
    payload: xml("06-companion-icons.xml"),
    action: "validate",
    expect: {
      valid: "yes",
      errors: 0,
      warnings: 0,
      ads: 1,
      lens: { "strict-iab": "pass" },
      sectionsOpen: ["runtime"],
    },
  },
  {
    id: "ctv-pod",
    label: "CTV ad pod",
    context: "A two-slot pod with sequence numbers and a 4K mezzanine, the shape a CTV publisher expects.",
    mode: "xml",
    payload: xml("07-ctv-pod.xml"),
    action: "validate",
    expect: {
      valid: "yes",
      errors: 0,
      warnings: 0,
      info: 0,
      ads: 2,
      lens: { "strict-iab": "pass", "ctv-safe": "pass", "ssai-safe": "pass", "legacy-player": "pass" },
      sectionsOpen: ["resolved"],
    },
  },
  {
    id: "pause-static",
    label: "CTV Ad Portfolio pause ad, static (VAST 4.2)",
    context: "A pause ad the way it has always shipped: one JPEG, one click-through.",
    mode: "xml",
    payload: xml("11-pause-static-4-2.xml"),
    action: "validate",
    expect: {
      valid: "yes",
      errors: 0,
      warnings: 0,
      info: 0,
      ads: 1,
    },
  },
  {
    id: "pause-video-4-4",
    label: "CTV Ad Portfolio pause ad, video (VAST 4.4 draft)",
    context: "Same placement, the new content model: real video, a QR code, and the AdCOM signals round-tripped from the bid.",
    mode: "xml",
    payload: xml("12-pause-video-4-4.xml"),
    action: "validate",
    expect: {
      valid: "yes",
      errors: 0,
      warnings: 0,
      info: { min: 1 },
      ads: 1,
      ruleIds: ["VAST-4.4-version-attribute"],
    },
  },
  {
    id: "wrapper-chain",
    label: "SSP to DSP wrapper chain",
    context: "Three hops: exchange wrapper, bidder wrapper, advertiser inline. Each hop adds its own trackers.",
    mode: "url",
    payload: "https://ssp-demo.exchange-partner.net/vast/wrapper-root.xml",
    action: "resolve",
    expect: {
      valid: "yes",
      errors: 0,
      hops: 3,
      ads: 1,
      lens: { "strict-iab": "pass" },
      sectionsOpen: ["wrappers", "resolved"],
    },
  },
  {
    id: "no-fill",
    label: "Empty VAST no-fill",
    context: "A valid document with no Ad. Players treat this as no-fill, and it is often mistaken for a broken tag.",
    mode: "url",
    payload: "https://ssp-demo.exchange-partner.net/vast/no-fill.xml",
    action: "validate",
    expect: {
      valid: "yes",
      errors: 0,
      warnings: 0,
      ads: 0,
    },
  },
  {
    id: "ssai-no-error",
    label: "SSAI tag with no Error element",
    context: "Server-side stitching cannot report a failure without an Error URL. The SSAI lens catches it.",
    mode: "url",
    payload: "https://ssai-demo.streaming-partner.net/vast/ad-break.xml",
    action: "validate",
    expect: {
      valid: "yes",
      errors: 0,
      warnings: 1,
      ads: 1,
      ruleIds: ["VAST-2.0-macro-unknown"],
      lens: { "ssai-safe": "fail" },
      sectionsOpen: ["resolved"],
    },
  },
];

export function fixtureById(id: string): Fixture {
  const fixture = FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Unknown fixture: ${id}`);
  }

  return fixture;
}
