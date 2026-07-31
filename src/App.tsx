import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, Ref } from "react";
import JSZip from "jszip";
import { useVastPlayback, useVastSession, useVastTracker } from "vastlint-react";
import adIdentityXml from "./scenarios/ad-identity.xml?raw";
import adVerificationXml from "./scenarios/ad-verification.xml?raw";
import brokenXml from "./scenarios/broken-tag.xml?raw";
import clickTrackingXml from "./scenarios/click-tracking.xml?raw";
import closedCaptionsXml from "./scenarios/closed-captions.xml?raw";
import companionBannerXml from "./scenarios/companion-banner.xml?raw";
import fixableXml from "./scenarios/fixable-tag.xml?raw";
import iconFallbacksXml from "./scenarios/icon-fallbacks.xml?raw";
import mezzanineSupportXml from "./scenarios/mezzanine-support.xml?raw";
import nonLinearOverlayXml from "./scenarios/non-linear-overlay.xml?raw";
import pricingCategoryXml from "./scenarios/pricing-category.xml?raw";
import runtimeSurfacesXml from "./scenarios/runtime-surfaces.xml?raw";
import sampleXml from "./scenarios/sample-inline.xml?raw";
import skippableLinearXml from "./scenarios/skippable-linear.xml?raw";
import viewableImpressionXml from "./scenarios/viewable-impression.xml?raw";
import wrapperSignalsXml from "./scenarios/wrapper-signals.xml?raw";

import type { FixResult, Issue, ValidateOptions } from "vastlint";
import { createVastSession } from "vastlint-client";

import type {
  VastCompanionAd,
  VastCreativeResource,
  VastIcon,
  VastPlaybackViewability,
  VastResolvedAd,
  VastSessionSnapshot,
  VastSessionSource,
  VastTrackingDispatchResult,
  VastTrackingPlan,
  VastTrackingTarget,
  VastWrapperHop,
} from "vastlint-client";

type SourceMode = "xml" | "url";
type ActionMode = "validate" | "resolve" | "fix";
type SectionId = "findings" | "wrappers" | "resolved" | "playback" | "tracking" | "runtime" | "macros" | "export";

const SECTION_IDS: readonly SectionId[] = [
  "findings",
  "wrappers",
  "resolved",
  "playback",
  "tracking",
  "runtime",
  "macros",
  "export",
];

const COLLAPSED_SECTIONS: Record<SectionId, boolean> = {
  findings: true,
  wrappers: false,
  resolved: false,
  playback: false,
  tracking: false,
  runtime: false,
  macros: false,
  export: false,
};
type ComplianceProfileId = "strict-iab" | "ctv-safe" | "ssai-safe" | "legacy-player";
type ScenarioGroupId = "core" | "creative-types" | "measurement" | "ctv-ssai";
type ScenarioActionFilter = "all" | ActionMode;

interface RunRequest {
  id: number;
  sourceMode: SourceMode;
  action: ActionMode;
  payload: string;
}

interface ScenarioPreset {
  id: string;
  label: string;
  description: string;
  groupId: ScenarioGroupId;
  versionLabel: string;
  focusAreas: readonly string[];
  sourceMode: SourceMode;
  action: ActionMode;
  payload: string;
}

interface ScenarioGroupDefinition {
  id: ScenarioGroupId;
  label: string;
  description: string;
}

interface SharedSessionState {
  sourceMode: SourceMode;
  action: ActionMode;
  payload: string;
  activeScenarioId: string | null;
  selectedComplianceProfileId: ComplianceProfileId | null;
}

interface TimelineEntry {
  id: string;
  at: string;
  title: string;
  detail: string;
  kind: "ui" | "media" | "session" | "tracking";
}

interface RuntimeVerificationResource {
  id: string;
  adTitle: string;
  vendor: string;
  kind: string;
  apiFramework: string | null;
  url: string;
}

interface RuntimeCreativePreview {
  id: string;
  adTitle: string;
  title: string;
  resource: VastCreativeResource | null;
  clickThroughUrl: string | null;
}

interface RuntimeInspection {
  apiFrameworks: string[];
  verificationResources: RuntimeVerificationResource[];
  companions: RuntimeCreativePreview[];
  icons: RuntimeCreativePreview[];
  omidCount: number;
  vpaidCount: number;
}

interface MacroEntryDraft {
  id: string;
  key: string;
  value: string;
}

interface MacroPresetDefinition {
  id: string;
  label: string;
  description: string;
  macros: Record<string, string>;
}

type TrackingWaterfallStatus = "ready" | "ok" | "failed" | "linked";

interface TrackingWaterfallRow {
  id: string;
  event: string;
  kind: string;
  status: TrackingWaterfallStatus;
  originalUrl: string;
  expandedUrl: string;
  hopIndex: number;
  sourceUrl: string | null;
  offset: string | null;
  dispatchCount: number;
  lastDispatchedAt: string | null;
  httpStatus: number | null;
  error: string | null;
}

type ComplianceProfileStatus = "pass" | "attention" | "fail";

interface ComplianceProfileVerdict {
  id: ComplianceProfileId;
  label: string;
  description: string;
  status: ComplianceProfileStatus;
  summary: string;
  reasons: string[];
}

type AssetRiskLevel = "ok" | "attention" | "risk";

interface AssetAuditRow {
  id: string;
  assetType: string;
  adTitle: string;
  format: string;
  dimensions: string;
  transport: string;
  riskLevel: AssetRiskLevel;
  riskLabel: string;
  detail: string;
  url: string | null;
}

type HopInspectorTone = "ok" | "warning" | "error";

interface WrapperHopInspector {
  id: string;
  hopIndex: number;
  title: string;
  adType: string;
  adSystem: string;
  duration: string;
  sourceLabel: string;
  nextHopLabel: string;
  fetchedAt: string;
  fetchMs: number;
  validationSummary: string;
  tone: HopInspectorTone;
  stats: string[];
  changes: string[];
}

interface EditorIssueMarker {
  id: string;
  line: number;
  severity: Issue["severity"];
  issueCount: number;
  summary: string;
  title: string;
  top: number;
}

// Inline markers are positioned by arithmetic, not by measuring the DOM, so the
// editor geometry has to live in one place. These values are pushed into the
// shell as custom properties: if CSS and JS disagree, every marker drifts by the
// difference multiplied by its line number.
const EDITOR_LINE_HEIGHT = 24;
const EDITOR_VERTICAL_PADDING = 12;
const EDITOR_GEOMETRY = {
  "--editor-line-height": `${String(EDITOR_LINE_HEIGHT)}px`,
  "--editor-padding-top": `${String(EDITOR_VERTICAL_PADDING)}px`,
} as CSSProperties;
const RULE_DOCS_BASE = "https://vastlint.org/docs/rules";
const DEFAULT_APP_ORIGIN = "http://localhost:5175";
const SCENARIO_FALLBACK_ASSET_ORIGIN = "https://iab-tech-lab-vast-tester.vastlint.org";
const APP_BASE_PATH = import.meta.env.BASE_URL ?? "/";

const PROFILE_RULE_DEFAULT_SEVERITIES: Record<string, Issue["severity"]> = {
  "VAST-2.0-flash-mediafile": "warning",
  "VAST-2.0-mediafile-https": "warning",
  "VAST-2.0-tracking-https": "warning",
  "VAST-4.0-universaladid-present": "error",
  "VAST-4.0-universaladid-idregistry": "error",
  "VAST-4.0-universaladid-idvalue": "error",
  "VAST-4.1-adservingid-present": "error",
  "VAST-4.1-ad-serving-id-empty": "warning",
  "VAST-4.1-universaladid-content": "error",
  "VAST-4.1-universaladid-idvalue-removed": "warning",
  "VAST-4.1-vpaid-apiframework": "warning",
  "VAST-4.1-vpaid-in-interactive-context": "warning",
  "VAST-4.1-mezzanine-recommended": "info",
};

const PROFILE_RULE_OVERRIDES: Record<ComplianceProfileId, Partial<Record<string, Issue["severity"]>>> = {
  "strict-iab": {},
  "ctv-safe": {
    "VAST-2.0-flash-mediafile": "error",
    "VAST-2.0-mediafile-https": "error",
    "VAST-2.0-tracking-https": "error",
    "VAST-4.1-vpaid-apiframework": "error",
    "VAST-4.1-vpaid-in-interactive-context": "error",
    "VAST-4.1-mezzanine-recommended": "error",
  },
  "ssai-safe": {
    "VAST-2.0-mediafile-https": "error",
    "VAST-2.0-tracking-https": "error",
    "VAST-4.1-ad-serving-id-empty": "error",
    "VAST-4.1-vpaid-apiframework": "error",
    "VAST-4.1-vpaid-in-interactive-context": "error",
    "VAST-4.1-mezzanine-recommended": "error",
  },
  "legacy-player": {
    "VAST-4.0-universaladid-present": "warning",
    "VAST-4.0-universaladid-idregistry": "warning",
    "VAST-4.0-universaladid-idvalue": "warning",
    "VAST-4.1-adservingid-present": "warning",
    "VAST-4.1-universaladid-content": "warning",
    "VAST-4.1-universaladid-idvalue-removed": "info",
    "VAST-4.1-vpaid-apiframework": "info",
  },
};

function isComplianceProfileId(value: string | null | undefined): value is ComplianceProfileId {
  return value === "strict-iab" || value === "ctv-safe" || value === "ssai-safe" || value === "legacy-player";
}

function buildComplianceValidateOptions(profileId: ComplianceProfileId): ValidateOptions | undefined {
  const ruleOverrides = PROFILE_RULE_OVERRIDES[profileId];
  return Object.keys(ruleOverrides).length > 0
    ? {
        rule_overrides: Object.fromEntries(Object.entries(ruleOverrides)) as Record<string, "warning" | "error" | "info" | "off">,
      }
    : undefined;
}

function getIssueSeverityForProfile(issue: Issue, profileId: ComplianceProfileId) {
  return PROFILE_RULE_OVERRIDES[profileId][issue.id] ?? PROFILE_RULE_DEFAULT_SEVERITIES[issue.id] ?? issue.severity;
}

function countIssuesForProfile(issues: readonly Issue[], profileId: ComplianceProfileId) {
  return issues.reduce(
    (summary, issue) => {
      summary[getIssueSeverityForProfile(issue, profileId)] += 1;
      return summary;
    },
    { error: 0, warning: 0, info: 0 },
  );
}

const SCENARIO_PRESETS: readonly ScenarioPreset[] = [
  {
    id: "inline-linear",
    label: "Inline linear",
    description: "Baseline inline linear ad with quartile tracking and playable media.",
    groupId: "core",
    versionLabel: "VAST 4.0",
    focusAreas: ["inline", "linear", "quartiles"],
    sourceMode: "xml",
    action: "validate",
    payload: sampleXml,
  },
  {
    id: "skippable-linear",
    label: "Skippable linear",
    description: "Linear playback with a real skip offset, skip beacon, and standard clickthrough handling.",
    groupId: "core",
    versionLabel: "VAST 4.1",
    focusAreas: ["skippable", "linear", "playback"],
    sourceMode: "xml",
    action: "validate",
    payload: skippableLinearXml,
  },
  {
    id: "broken-tag",
    label: "Broken tag",
    description: "Structural errors for missing required VAST 4.x elements.",
    groupId: "core",
    versionLabel: "VAST 4.2",
    focusAreas: ["errors", "required fields"],
    sourceMode: "xml",
    action: "validate",
    payload: brokenXml,
  },
  {
    id: "fixable-tag",
    label: "Fixable tag",
    description: "HTTPS upgrades that can be repaired deterministically.",
    groupId: "core",
    versionLabel: "VAST 4.1",
    focusAreas: ["repair", "https"],
    sourceMode: "xml",
    action: "validate",
    payload: fixableXml,
  },
  {
    id: "wrapper-chain",
    label: "Wrapper chain",
    description: "Local two-hop wrapper fixture for resolution demos.",
    groupId: "core",
    versionLabel: "VAST 4.x",
    focusAreas: ["wrapper", "resolve", "waterfall"],
    sourceMode: "url",
    action: "resolve",
    payload: "/scenarios/wrapper-root.xml",
  },
  {
    id: "pricing-category",
    label: "Pricing and category",
    description: "Commercial metadata coverage with pricing, content category, and progress beacons.",
    groupId: "core",
    versionLabel: "VAST 4.1",
    focusAreas: ["pricing", "category", "metadata"],
    sourceMode: "xml",
    action: "validate",
    payload: pricingCategoryXml,
  },
  {
    id: "non-linear-overlay",
    label: "Non-linear overlay",
    description: "Overlay creative coverage for non-linear placements and click-through handling.",
    groupId: "creative-types",
    versionLabel: "VAST 2.0",
    focusAreas: ["non-linear", "overlay"],
    sourceMode: "xml",
    action: "validate",
    payload: nonLinearOverlayXml,
  },
  {
    id: "companion-banner",
    label: "Companion banner",
    description: "Inline linear ad paired with a companion creative and companion click tracking.",
    groupId: "creative-types",
    versionLabel: "VAST 4.1",
    focusAreas: ["companion", "banner"],
    sourceMode: "xml",
    action: "validate",
    payload: companionBannerXml,
  },
  {
    id: "icon-fallbacks",
    label: "Icon fallbacks",
    description: "Ad icon payload with click fallback imagery for player-side disclosure handling.",
    groupId: "creative-types",
    versionLabel: "VAST 4.2",
    focusAreas: ["icons", "fallbacks", "overlay"],
    sourceMode: "xml",
    action: "validate",
    payload: iconFallbacksXml,
  },
  {
    id: "runtime-surfaces",
    label: "Runtime surfaces",
    description: "Companions, OMID verification resources, and VPAID markers.",
    groupId: "creative-types",
    versionLabel: "VAST 4.1",
    focusAreas: ["verification", "icons", "companions"],
    sourceMode: "xml",
    action: "validate",
    payload: runtimeSurfacesXml,
  },
  {
    id: "click-tracking",
    label: "Click tracking",
    description: "Video click-through, click tracking, and custom click URLs in one linear ad.",
    groupId: "measurement",
    versionLabel: "VAST 4.1",
    focusAreas: ["clicks", "tracking"],
    sourceMode: "xml",
    action: "validate",
    payload: clickTrackingXml,
  },
  {
    id: "viewable-impression",
    label: "Viewable impression",
    description: "Secondary impression reporting for viewable, not-viewable, and undetermined outcomes.",
    groupId: "measurement",
    versionLabel: "VAST 4.1",
    focusAreas: ["viewability", "impression"],
    sourceMode: "xml",
    action: "validate",
    payload: viewableImpressionXml,
  },
  {
    id: "ad-verification",
    label: "Ad verification",
    description: "OM SDK verification payloads with verification parameters and fallback tracking.",
    groupId: "measurement",
    versionLabel: "VAST 4.1",
    focusAreas: ["omid", "verification"],
    sourceMode: "xml",
    action: "validate",
    payload: adVerificationXml,
  },
  {
    id: "wrapper-signals",
    label: "Wrapper signals",
    description: "Wrapper-only measurement signals with inherited tracking, click beacons, and viewability hooks.",
    groupId: "measurement",
    versionLabel: "VAST 4.1",
    focusAreas: ["wrapper", "beacons", "measurement"],
    sourceMode: "xml",
    action: "validate",
    payload: wrapperSignalsXml,
  },
  {
    id: "ad-identity",
    label: "Ad identity",
    description: "Modern ad identity fields with AdServingId and UniversalAdId for partner QA.",
    groupId: "ctv-ssai",
    versionLabel: "VAST 4.1",
    focusAreas: ["adservingid", "universaladid"],
    sourceMode: "xml",
    action: "validate",
    payload: adIdentityXml,
  },
  {
    id: "mezzanine-support",
    label: "Mezzanine support",
    description: "CTV and SSAI-oriented tag carrying both ready-to-serve media and a mezzanine source.",
    groupId: "ctv-ssai",
    versionLabel: "VAST 4.1",
    focusAreas: ["ssai", "mezzanine"],
    sourceMode: "xml",
    action: "validate",
    payload: mezzanineSupportXml,
  },
  {
    id: "closed-captions",
    label: "Closed captions",
    description: "MediaFiles bundle with multiple caption resources for accessibility coverage.",
    groupId: "ctv-ssai",
    versionLabel: "VAST 4.2",
    focusAreas: ["captions", "accessibility"],
    sourceMode: "xml",
    action: "validate",
    payload: closedCaptionsXml,
  },
];

const SCENARIO_GROUPS: readonly ScenarioGroupDefinition[] = [
  {
    id: "core",
    label: "Core coverage",
    description: "Baseline inline, skippable, metadata, wrapper resolution, and known-bad regression tags.",
  },
  {
    id: "creative-types",
    label: "Creative formats",
    description: "Non-linear, companion, icons, and mixed runtime surfaces that stress player integrations.",
  },
  {
    id: "measurement",
    label: "Measurement",
    description: "Click, wrapper, viewability, and OMID verification cases that tend to break analytics pipelines.",
  },
  {
    id: "ctv-ssai",
    label: "CTV and SSAI",
    description: "Identity, mezzanine, and captioning samples for modern distribution workflows.",
  },
];

const SCENARIO_ROW_LIMIT = 5;

const GROUPED_SCENARIO_PRESETS = SCENARIO_GROUPS.map((group) => ({
  ...group,
  scenarios: SCENARIO_PRESETS.filter((scenario) => scenario.groupId === group.id),
}));

const ACTION_LABELS: Record<ActionMode, string> = {
  validate: "Validate",
  resolve: "Resolve wrappers",
  fix: "Auto-fix",
};

function buildSource(sourceMode: SourceMode, payload: string): VastSessionSource {
  if (sourceMode === "url") {
    return {
      kind: "url",
      url: payload,
      label: "Remote VAST tag",
    };
  }

  return {
    kind: "xml",
    xml: payload,
    label: "Editor XML",
  };
}

function isValidRemoteUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildLocalAssetUrl(path: string) {
  const origin = typeof globalThis.location === "object" ? globalThis.location.origin : DEFAULT_APP_ORIGIN;
  const appBaseUrl = new URL(APP_BASE_PATH, origin.endsWith("/") ? origin : `${origin}/`);
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(normalizedPath, appBaseUrl).toString();
}

function buildScenarioUrl(path: string) {
  return buildLocalAssetUrl(path);
}

function buildScenarioFixtureUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (typeof globalThis.location === "object" && globalThis.location.protocol === "https:") {
    return buildLocalAssetUrl(normalizedPath);
  }

  return new URL(normalizedPath, SCENARIO_FALLBACK_ASSET_ORIGIN).toString();
}

function absolutizeScenarioXmlLocalUrls(xml: string) {
  return xml.replace(/<!\[CDATA\[(\/[^\]]*)\]\]>/g, (_match, path: string) => {
    return `<![CDATA[${buildScenarioFixtureUrl(path)}]]>`;
  });
}

function createTimestamp() {
  return new Date().toISOString();
}

function createCacheBustingValue() {
  return Math.floor(Math.random() * 100000000)
    .toString()
    .padStart(8, "0");
}

function createDraftId(prefix: string) {
  return `${prefix}-${createTimestamp()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDimensions(width: string | null | undefined, height: string | null | undefined) {
  const normalizedWidth = width && width.trim().length > 0 ? width : "?";
  const normalizedHeight = height && height.trim().length > 0 ? height : "?";

  return normalizedWidth === "?" && normalizedHeight === "?"
    ? "n/a"
    : `${normalizedWidth} x ${normalizedHeight}`;
}

function describeTransport(url: string | null, inlineLabel = "inline") {
  if (!url) {
    return inlineLabel;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") {
      return "HTTPS";
    }

    if (parsed.protocol === "http:") {
      return "HTTP";
    }

    return parsed.protocol.replace(":", "").toUpperCase();
  } catch {
    return inlineLabel;
  }
}

function elevateRisk(current: AssetRiskLevel, candidate: AssetRiskLevel) {
  const order: Record<AssetRiskLevel, number> = {
    ok: 0,
    attention: 1,
    risk: 2,
  };

  return order[candidate] > order[current] ? candidate : current;
}

function formatAssetRiskLabel(level: AssetRiskLevel) {
  if (level === "ok") {
    return "ready";
  }

  if (level === "attention") {
    return "review";
  }

  return "high risk";
}

function buildEditorIssueMarkers(issues: readonly Issue[]) {
  const issuesByLine = new Map<number, Issue[]>();

  for (const issue of issues) {
    if (typeof issue.line !== "number" || !Number.isFinite(issue.line) || issue.line < 1) {
      continue;
    }

    const lineIssues = issuesByLine.get(issue.line) ?? [];
    lineIssues.push(issue);
    issuesByLine.set(issue.line, lineIssues);
  }

  return [...issuesByLine.entries()]
    .sort(([left], [right]) => left - right)
    .map(([line, lineIssues]) => {
      const severity = lineIssues.some((issue) => issue.severity === "error")
        ? "error"
        : lineIssues.some((issue) => issue.severity === "warning")
          ? "warning"
          : "info";
      const firstIssue = lineIssues[0];
      const summary = lineIssues.length > 1
        ? `${String(lineIssues.length)} findings on this line`
        : firstIssue.message;
      const title = lineIssues.map((issue) => `${issue.id}: ${issue.message}`).join("\n");

      return {
        id: `editor-line-${String(line)}`,
        line,
        severity,
        issueCount: lineIssues.length,
        summary,
        title,
        top: EDITOR_VERTICAL_PADDING + ((line - 1) * EDITOR_LINE_HEIGHT),
      } satisfies EditorIssueMarker;
    });
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = globalThis.atob(`${normalized}${padding}`);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function readSharedSessionState(): SharedSessionState | null {
  if (typeof globalThis.location !== "object") {
    return null;
  }

  const params = new URLSearchParams(globalThis.location.hash.replace(/^#/, ""));
  const encoded = params.get("session");
  if (!encoded) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(encoded)) as Partial<SharedSessionState>;
    if (!parsed || (parsed.sourceMode !== "xml" && parsed.sourceMode !== "url")) {
      return null;
    }

    if (parsed.action !== "validate" && parsed.action !== "resolve" && parsed.action !== "fix") {
      return null;
    }

    if (typeof parsed.payload !== "string" || parsed.payload.length === 0) {
      return null;
    }

    return {
      sourceMode: parsed.sourceMode,
      action: parsed.action,
      payload: parsed.payload,
      activeScenarioId: typeof parsed.activeScenarioId === "string" ? parsed.activeScenarioId : null,
      selectedComplianceProfileId: isComplianceProfileId(parsed.selectedComplianceProfileId)
        ? parsed.selectedComplianceProfileId
        : null,
    };
  } catch {
    return null;
  }
}

function formatRunSource(lastRun: RunRequest) {
  return lastRun.sourceMode === "xml" ? `Editor XML (${String(lastRun.payload.length)} bytes)` : lastRun.payload;
}

function formatClock(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "n/a";
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatMacroPlayhead(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "00:00:00.000";
  }

  const totalMilliseconds = Math.max(0, Math.floor(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1_000);
  const milliseconds = totalMilliseconds % 1_000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function summarizeWrapperValidation(validation: VastWrapperHop["validation"]) {
  if (!validation) {
    return "not validated";
  }

  return `${validation.summary.errors}e / ${validation.summary.warnings}w / ${validation.summary.infos}i`;
}

function buildWrapperChangeNotes(
  hop: VastWrapperHop,
  previous: VastWrapperHop | null,
  resolvedAd: VastResolvedAd | null,
) {
  const notes: string[] = [];

  if (!previous) {
    notes.push(
      hop.source.kind === "url"
        ? "Root document fetched from the requested URL."
        : "Root document loaded from the XML editor.",
    );
  }

  if (previous && previous.adType !== hop.adType) {
    notes.push(`Ad type ${previous.adType} -> ${hop.adType}.`);
  }

  if (previous && previous.adSystem !== hop.adSystem) {
    notes.push(`Ad system ${previous.adSystem || "unknown"} -> ${hop.adSystem || "unknown"}.`);
  }

  if (previous && previous.duration !== hop.duration) {
    notes.push(`Duration ${previous.duration || "n/a"} -> ${hop.duration || "n/a"}.`);
  }

  if (previous && previous.impressionCount !== hop.impressionCount) {
    notes.push(`Impression URLs ${String(previous.impressionCount)} -> ${String(hop.impressionCount)}.`);
  }

  if (previous && previous.trackingEventCount !== hop.trackingEventCount) {
    notes.push(`Tracking events ${String(previous.trackingEventCount)} -> ${String(hop.trackingEventCount)}.`);
  }

  if (previous && previous.companionCount !== hop.companionCount) {
    notes.push(`Companions ${String(previous.companionCount)} -> ${String(hop.companionCount)}.`);
  }

  if (hop.wrapperUri) {
    notes.push(`Next wrapper URI: ${hop.wrapperUri}`);
  } else if (hop.adType === "InLine") {
    notes.push("Resolution terminates here with inline creative content.");
  }

  if (resolvedAd) {
    notes.push(
      `Final payload from this hop includes ${String(resolvedAd.impressionUrls.length)} impression URL(s), ${String(resolvedAd.clickTrackingUrls.length)} click tracker(s), and ${String(resolvedAd.mediaFiles.length)} media file(s).`,
    );
  }

  if (notes.length === 0) {
    notes.push("No material metadata delta from the previous hop.");
  }

  return notes.slice(0, 4);
}

function buildWrapperInspectors(
  wrapperChain: readonly VastWrapperHop[],
  resolvedAds: readonly VastResolvedAd[],
) {
  const resolvedByHop = new Map<number, VastResolvedAd>();

  for (const resolvedAd of resolvedAds) {
    if (resolvedAd.finalHopIndex !== null) {
      resolvedByHop.set(resolvedAd.finalHopIndex, resolvedAd);
    }
  }

  return wrapperChain.map((hop, index) => ({
    id: `hop-${String(hop.index)}-${hop.url ?? hop.source.kind}`,
    hopIndex: hop.index,
    title: hop.adTitle || (hop.adType === "Wrapper" ? "Wrapper hop" : "Inline creative"),
    adType: hop.adType,
    adSystem: hop.adSystem || "unknown",
    duration: hop.duration || "n/a",
    sourceLabel: hop.url ?? (hop.source.kind === "url" ? hop.source.url : "Editor XML"),
    nextHopLabel: hop.wrapperUri ?? (hop.adType === "InLine" ? "Resolved inline segment" : "No next hop"),
    fetchedAt: hop.fetchedAt,
    fetchMs: hop.fetchMs,
    validationSummary: summarizeWrapperValidation(hop.validation),
    tone: hop.validation
      ? (hop.validation.summary.errors > 0 ? "error" : hop.validation.summary.warnings > 0 ? "warning" : "ok")
      : "warning",
    stats: [
      `${String(hop.fetchMs)} ms fetch`,
      `${String(hop.impressionCount)} impression${hop.impressionCount === 1 ? "" : "s"}`,
      `${String(hop.trackingEventCount)} tracker${hop.trackingEventCount === 1 ? "" : "s"}`,
      `${String(hop.companionCount)} companion${hop.companionCount === 1 ? "" : "s"}`,
      `${String(hop.mediaFiles.length)} media`,
    ],
    changes: buildWrapperChangeNotes(hop, wrapperChain[index - 1] ?? null, resolvedByHop.get(hop.index) ?? null),
  } satisfies WrapperHopInspector));
}

function buildAssetAuditRows(resolvedAds: readonly VastResolvedAd[]) {
  const rows: AssetAuditRow[] = [];

  for (const [adIndex, resolvedAd] of resolvedAds.entries()) {
    const adTitle = resolvedAd.adTitle || resolvedAd.adPod.adId || `Ad ${String(adIndex + 1)}`;

    resolvedAd.mediaFiles.forEach((mediaFile, mediaIndex) => {
      let riskLevel: AssetRiskLevel = "ok";
      const notes: string[] = [];
      const transport = describeTransport(mediaFile.url);

      if (transport === "HTTP") {
        riskLevel = elevateRisk(riskLevel, "risk");
        notes.push("Non-HTTPS media URL.");
      }

      if (!mediaFile.width || !mediaFile.height) {
        riskLevel = elevateRisk(riskLevel, "attention");
        notes.push("Missing declared dimensions.");
      }

      if (!/^video\/(mp4|webm)$/i.test(mediaFile.mimeType) && mediaFile.mimeType !== "application/x-mpegURL") {
        riskLevel = elevateRisk(riskLevel, "attention");
        notes.push("Uncommon playback MIME type.");
      }

      if (mediaFile.bitrate) {
        notes.push(`Bitrate ${mediaFile.bitrate}.`);
      }

      rows.push({
        id: `media-${String(adIndex)}-${String(mediaIndex)}`,
        assetType: "Media file",
        adTitle,
        format: [mediaFile.mimeType, mediaFile.delivery].filter(Boolean).join(" / "),
        dimensions: formatDimensions(mediaFile.width, mediaFile.height),
        transport,
        riskLevel,
        riskLabel: formatAssetRiskLabel(riskLevel),
        detail: notes.join(" ") || "Primary playable media asset.",
        url: mediaFile.url,
      });
    });

    resolvedAd.companions.forEach((companion, companionIndex) => {
      const resources = companion.resources.length > 0 ? companion.resources : [null];

      resources.forEach((resource, resourceIndex) => {
        let riskLevel: AssetRiskLevel = "ok";
        const notes: string[] = [];
        let format = "no creative resource";
        let transport = "inline";
        let url: string | null = companion.clickThroughUrl;

        if (resource) {
          format = [resource.kind, resource.creativeType].filter(Boolean).join(" / ");
          if (resource.kind === "html") {
            transport = "INLINE HTML";
            riskLevel = elevateRisk(riskLevel, "attention");
            notes.push("Inline HTML companion resource.");
          } else {
            transport = describeTransport(resource.content, resource.kind.toUpperCase());
            url = resource.content;
            if (transport === "HTTP") {
              riskLevel = elevateRisk(riskLevel, "risk");
              notes.push("Non-HTTPS companion resource.");
            }
          }

          if (resource.kind === "iframe") {
            riskLevel = elevateRisk(riskLevel, "attention");
            notes.push("Iframe rendering dependency.");
          }
        } else {
          riskLevel = elevateRisk(riskLevel, "attention");
          notes.push("Companion has no declared creative resource.");
        }

        if (!companion.clickThroughUrl) {
          notes.push("No click-through URL.");
        } else if (describeTransport(companion.clickThroughUrl) === "HTTP") {
          riskLevel = elevateRisk(riskLevel, "risk");
          notes.push("HTTP click-through URL.");
        }

        rows.push({
          id: `companion-${String(adIndex)}-${String(companionIndex)}-${String(resourceIndex)}`,
          assetType: "Companion",
          adTitle,
          format,
          dimensions: formatDimensions(companion.width, companion.height),
          transport,
          riskLevel,
          riskLabel: formatAssetRiskLabel(riskLevel),
          detail: notes.join(" ") || "Companion creative resource.",
          url,
        });
      });
    });

    resolvedAd.icons.forEach((icon, iconIndex) => {
      const resources = icon.resources.length > 0 ? icon.resources : [null];

      resources.forEach((resource, resourceIndex) => {
        let riskLevel: AssetRiskLevel = "ok";
        const notes: string[] = [];
        let format = "no creative resource";
        let transport = "inline";
        let url: string | null = icon.clickThroughUrl;

        if (resource) {
          format = [resource.kind, resource.creativeType].filter(Boolean).join(" / ");
          if (resource.kind === "html") {
            transport = "INLINE HTML";
            riskLevel = elevateRisk(riskLevel, "attention");
            notes.push("Inline HTML icon resource.");
          } else {
            transport = describeTransport(resource.content, resource.kind.toUpperCase());
            url = resource.content;
            if (transport === "HTTP") {
              riskLevel = elevateRisk(riskLevel, "risk");
              notes.push("Non-HTTPS icon resource.");
            }
          }
        } else {
          riskLevel = elevateRisk(riskLevel, "attention");
          notes.push("Icon has no declared creative resource.");
        }

        if (!icon.viewTrackingUrls.length) {
          notes.push("No icon view tracking URLs.");
        }

        rows.push({
          id: `icon-${String(adIndex)}-${String(iconIndex)}-${String(resourceIndex)}`,
          assetType: "Icon",
          adTitle,
          format,
          dimensions: formatDimensions(icon.width, icon.height),
          transport,
          riskLevel,
          riskLabel: formatAssetRiskLabel(riskLevel),
          detail: notes.join(" ") || "Overlay icon resource.",
          url,
        });
      });
    });

    resolvedAd.adVerifications.forEach((verification, verificationIndex) => {
      verification.resources.forEach((resource, resourceIndex) => {
        let riskLevel: AssetRiskLevel = "ok";
        const notes: string[] = [];
        const transport = describeTransport(resource.url);

        if (transport === "HTTP") {
          riskLevel = elevateRisk(riskLevel, "risk");
          notes.push("Non-HTTPS verification URL.");
        }

        if (resource.kind === "executable") {
          riskLevel = elevateRisk(riskLevel, "attention");
          notes.push("Executable verification dependency.");
        }

        if (!resource.apiFramework) {
          notes.push("No API framework declared.");
        }

        rows.push({
          id: `verification-${String(adIndex)}-${String(verificationIndex)}-${String(resourceIndex)}`,
          assetType: "Verification",
          adTitle,
          format: [resource.kind, resource.mimeType].filter(Boolean).join(" / "),
          dimensions: "n/a",
          transport,
          riskLevel,
          riskLabel: formatAssetRiskLabel(riskLevel),
          detail: [verification.vendor ?? "unknown vendor", resource.apiFramework, notes.join(" ")]
            .filter(Boolean)
            .join(" · "),
          url: resource.url,
        });
      });
    });
  }

  return rows;
}

function buildComplianceVerdict(
  id: ComplianceProfileId,
  label: string,
  description: string,
  failures: string[],
  cautions: string[],
): ComplianceProfileVerdict {
  const status: ComplianceProfileStatus = failures.length > 0 ? "fail" : cautions.length > 0 ? "attention" : "pass";
  const summary = status === "pass"
    ? "No blocking conditions found for this lens."
    : status === "attention"
      ? "Usable, but QA should review the highlighted edge cases."
      : "Likely blocked under this compatibility lens.";

  return {
    id,
    label,
    description,
    status,
    summary,
    reasons: failures.length > 0
      ? [...failures, ...cautions].slice(0, 4)
      : cautions.length > 0
        ? cautions.slice(0, 4)
        : ["No blocking conditions found for this lens."],
  };
}

function buildComplianceVerdicts(
  validationReady: boolean,
  issues: readonly Issue[],
  resolvedAds: readonly VastResolvedAd[],
  runtimeInspection: RuntimeInspection,
  wrapperChain: readonly VastWrapperHop[],
  assetAuditRows: readonly AssetAuditRow[],
) {
  if (!validationReady && resolvedAds.length === 0 && wrapperChain.length === 0) {
    return [
      {
        id: "strict-iab",
        label: "Strict IAB",
        description: "Raw spec posture for partner escalation.",
        status: "attention",
        summary: "Run validate, resolve, or prepare the runner to score this profile.",
        reasons: ["No validation or resolved inventory has been collected yet."],
      },
      {
        id: "ctv-safe",
        label: "CTV-safe",
        description: "TV playback with conservative runtime assumptions.",
        status: "attention",
        summary: "Run validate, resolve, or prepare the runner to score this profile.",
        reasons: ["No resolved media inventory is available yet."],
      },
      {
        id: "ssai-safe",
        label: "SSAI-safe",
        description: "Server-side stitching with transport and beacon discipline.",
        status: "attention",
        summary: "Run validate, resolve, or prepare the runner to score this profile.",
        reasons: ["No resolved tracking inventory is available yet."],
      },
      {
        id: "legacy-player",
        label: "Legacy player",
        description: "Older player stacks that prefer simpler media and overlays.",
        status: "attention",
        summary: "Run validate, resolve, or prepare the runner to score this profile.",
        reasons: ["No resolved asset inventory is available yet."],
      },
    ] satisfies ComplianceProfileVerdict[];
  }

  const strictCounts = countIssuesForProfile(issues, "strict-iab");
  const ctvCounts = countIssuesForProfile(issues, "ctv-safe");
  const ssaiCounts = countIssuesForProfile(issues, "ssai-safe");
  const legacyCounts = countIssuesForProfile(issues, "legacy-player");
  const mediaFiles = resolvedAds.flatMap((resolvedAd) => resolvedAd.mediaFiles);
  const hasMp4 = mediaFiles.some((mediaFile) => mediaFile.mimeType === "video/mp4");
  const hasHls = mediaFiles.some((mediaFile) => mediaFile.mimeType === "application/x-mpegURL");
  const hasSimpleVideo = mediaFiles.some((mediaFile) => /^video\/(mp4|webm)$/i.test(mediaFile.mimeType));
  const hasErrorTracking = resolvedAds.some((resolvedAd) => resolvedAd.errorUrls.length > 0);
  const hasImpressionTracking = resolvedAds.some((resolvedAd) => resolvedAd.impressionUrls.length > 0);
  const httpAssets = assetAuditRows.filter((row) => row.transport === "HTTP").length;
  const highRiskAssets = assetAuditRows.filter((row) => row.riskLevel === "risk").length;
  const reviewAssets = assetAuditRows.filter((row) => row.riskLevel === "attention").length;
  const verificationCount = runtimeInspection.verificationResources.length;
  const vpaidCount = runtimeInspection.vpaidCount;
  const iconCount = runtimeInspection.icons.length;

  return [
    buildComplianceVerdict(
      "strict-iab",
      "Strict IAB",
      "Raw spec posture for partner escalation.",
      strictCounts.error > 0 ? [`${String(strictCounts.error)} error-severity rule violation(s) remain.`] : [],
      [
        ...(strictCounts.warning > 0 ? [`${String(strictCounts.warning)} warning(s) still need review.`] : []),
        ...(wrapperChain.some((hop) => (hop.validation?.summary.warnings ?? 0) > 0)
          ? ["One or more wrapper hops carry warning-level findings."]
          : []),
      ],
    ),
    buildComplianceVerdict(
      "ctv-safe",
      "CTV-safe",
      "TV playback with conservative runtime assumptions.",
      [
        ...(ctvCounts.error > 0 ? [`${String(ctvCounts.error)} rule violation(s) fail this validation mode.`] : []),
        ...(mediaFiles.length === 0 ? ["No playable media assets were resolved."] : []),
        ...(!hasMp4 && !hasHls ? ["No MP4 or HLS media is available for TV-class playback."] : []),
        ...(vpaidCount > 0 ? [`${String(vpaidCount)} VPAID marker(s) are present and likely unsupported on CTV.`] : []),
      ],
      [
        ...(verificationCount > 0 ? [`${String(verificationCount)} verification resource(s) may require device-specific support.`] : []),
        ...(highRiskAssets > 0 ? [`${String(highRiskAssets)} asset(s) still rely on insecure or execution-heavy delivery.`] : []),
        ...(ctvCounts.warning > 0 ? [`${String(ctvCounts.warning)} additional warning(s) still need QA sign-off.`] : []),
      ],
    ),
    buildComplianceVerdict(
      "ssai-safe",
      "SSAI-safe",
      "Server-side stitching with transport and beacon discipline.",
      [
        ...(ssaiCounts.error > 0 ? [`${String(ssaiCounts.error)} rule violation(s) fail this validation mode.`] : []),
        ...(!hasImpressionTracking ? ["No impression tracking URLs are present."] : []),
        ...(!hasErrorTracking ? ["No error tracking URLs are present."] : []),
        ...(httpAssets > 0 ? [`${String(httpAssets)} asset URL(s) still use HTTP transport.`] : []),
      ],
      [
        ...(verificationCount > 0 || vpaidCount > 0
          ? ["Client-side verification or VPAID dependencies reduce SSAI portability."]
          : []),
        ...(wrapperChain.length > 2 ? [`Wrapper chain depth is ${String(wrapperChain.length)} hops.`] : []),
        ...(ssaiCounts.warning > 0 ? [`${String(ssaiCounts.warning)} additional warning(s) still need QA sign-off.`] : []),
        ...(reviewAssets > 0 ? [`${String(reviewAssets)} asset(s) merit manual review.`] : []),
      ],
    ),
    buildComplianceVerdict(
      "legacy-player",
      "Legacy player",
      "Older player stacks that prefer simpler media and overlays.",
      [
        ...(legacyCounts.error > 0 ? [`${String(legacyCounts.error)} rule violation(s) still block this compatibility mode.`] : []),
        ...(!hasSimpleVideo ? ["No simple MP4 or WebM file is available for older players."] : []),
      ],
      [
        ...(legacyCounts.warning > 0 ? [`${String(legacyCounts.warning)} warning(s) remain after compatibility downgrades.`] : []),
        ...(verificationCount > 0 ? [`${String(verificationCount)} verification resource(s) may exceed older player support.`] : []),
        ...(iconCount > 0 ? [`${String(iconCount)} icon resource(s) require additional player surface support.`] : []),
        ...(vpaidCount > 0 ? [`${String(vpaidCount)} VPAID marker(s) need explicit player testing.`] : []),
        ...(highRiskAssets > 0 ? [`${String(highRiskAssets)} asset(s) still need transport cleanup.`] : []),
      ],
    ),
  ];
}

function buildMacroEntryDrafts(macros: Record<string, string>) {
  return Object.entries(macros).map(([key, value], index) => ({
    id: `${key}-${String(index)}`,
    key,
    value,
  } satisfies MacroEntryDraft));
}

function buildMacroRecord(entries: readonly MacroEntryDraft[]) {
  return entries.reduce<Record<string, string>>((current, entry) => {
    const normalizedKey = entry.key.trim().toUpperCase();
    if (!normalizedKey) {
      return current;
    }

    current[normalizedKey] = entry.value;
    return current;
  }, {});
}

function expandTrackingPreviewUrl(
  url: string,
  macros: Record<string, string>,
  defaults: Record<string, string>,
) {
  const values: Record<string, string> = {
    ...defaults,
  };

  for (const [key, value] of Object.entries(macros)) {
    values[key.toUpperCase()] = String(value);
  }

  return url.replace(/\[([A-Z0-9_]+)\]|%%([A-Z0-9_]+)%%/gi, (match, bracketName, legacyName) => {
    const macroKey = String(bracketName ?? legacyName ?? "").toUpperCase();
    const replacement = values[macroKey];
    return replacement === undefined ? match : encodeURIComponent(replacement);
  });
}

function buildMacroPresetDefinitions(
  defaults: Record<string, string>,
  currentTimeSec: number | null,
  muted: boolean,
  viewability: VastPlaybackViewability | null,
  resolvedAd: VastResolvedAd | null,
) {
  const playhead = formatMacroPlayhead(currentTimeSec);
  const userAgent = typeof globalThis.navigator === "object"
    ? globalThis.navigator.userAgent
    : "Mozilla/5.0 (compatible; VastValidator/1.0)";
  const pageUrl = typeof globalThis.location === "object"
    ? globalThis.location.href
    : "https://publisher.example.com/player";
  const adSequence = String(resolvedAd?.adPod.sequence ?? 1);
  const adServingId = resolvedAd?.adPod.adId ?? resolvedAd?.adTitle ?? "demo-ad";
  const playerState = `muted=${muted ? "1" : "0"};viewability=${viewability ?? "unset"}`;

  return [
    {
      id: "web-browser",
      label: "Web browser",
      description: "Desktop browser autoplay-muted environment.",
      macros: {
        ...defaults,
        ERRORCODE: "901",
        CONTENTPLAYHEAD: playhead,
        PAGEURL: pageUrl,
        DEVICEUA: userAgent,
        PLAYERSTATE: playerState,
        PODSEQUENCE: adSequence,
      },
    },
    {
      id: "mobile-app",
      label: "Mobile app",
      description: "In-app SDK context with app bundle identifiers.",
      macros: {
        ...defaults,
        ERRORCODE: "402",
        CONTENTPLAYHEAD: playhead,
        PAGEURL: "app://publisher/feed/featured",
        APPBUNDLE: "com.publisher.mobile",
        DEVICEUA: "PublisherMobileSDK/7.2 (iPhone; iOS 18.0)",
        PLAYERSTATE: playerState,
      },
    },
    {
      id: "ctv-player",
      label: "CTV player",
      description: "Connected TV runtime with large-screen user agent values.",
      macros: {
        ...defaults,
        ERRORCODE: "901",
        CONTENTPLAYHEAD: playhead,
        APPBUNDLE: "com.publisher.ctv",
        DEVICEUA: "Roku/DVP-12.5 (519.10E04154A)",
        PAGEURL: "https://publisher.example.com/ctv/home",
        PODSEQUENCE: adSequence,
        PLAYERSTATE: playerState,
      },
    },
    {
      id: "ssai-proxy",
      label: "SSAI proxy",
      description: "Server-side ad insertion / stitcher macro set.",
      macros: {
        ...defaults,
        ERRORCODE: "303",
        CONTENTPLAYHEAD: playhead,
        PAGEURL: "https://ssai.publisher.example.com/live/master.m3u8",
        SERVERUA: "Akamai-SSAI/1.0",
        ADSERVINGID: adServingId,
        PODSEQUENCE: adSequence,
        PLAYERSTATE: playerState,
      },
    },
  ] satisfies MacroPresetDefinition[];
}

function buildTrackingHistoryKey(event: string, url: string, hopIndex: number, offset: string | null) {
  return `${event}:${String(hopIndex)}:${offset ?? ""}:${url}`;
}

function buildTrackingWaterfall(
  plan: VastTrackingPlan,
  history: readonly VastTrackingDispatchResult[],
  macros: Record<string, string>,
  defaults: Record<string, string>,
) {
  const historyByKey = new Map<string, VastTrackingDispatchResult[]>();

  for (const entry of history) {
    const key = buildTrackingHistoryKey(entry.event, entry.url, entry.hopIndex, entry.offset);
    const current = historyByKey.get(key) ?? [];
    current.push(entry);
    historyByKey.set(key, current);
  }

  const seededTargets: Array<{ event: string; target: VastTrackingTarget }> = [
    ...plan.impressions.map((target) => ({ event: "impression", target })),
    ...plan.errors.map((target) => ({ event: "error", target })),
    ...plan.clickTrackings.map((target) => ({ event: "clickTracking", target })),
    ...plan.clickThroughs.map((target) => ({ event: "clickThrough", target })),
    ...plan.events.map((target) => ({ event: target.event, target })),
  ];

  const eventOrder = new Map([
    ["impression", 0],
    ["creativeView", 1],
    ["start", 2],
    ["firstQuartile", 3],
    ["midpoint", 4],
    ["thirdQuartile", 5],
    ["complete", 6],
    ["pause", 7],
    ["resume", 8],
    ["mute", 9],
    ["unmute", 10],
    ["fullscreen", 11],
    ["exitFullscreen", 12],
    ["viewable", 13],
    ["notViewable", 14],
    ["viewUndetermined", 15],
    ["clickTracking", 16],
    ["clickThrough", 17],
    ["skip", 18],
    ["error", 19],
  ]);

  return seededTargets
    .map(({ event, target }, index) => {
      const key = buildTrackingHistoryKey(event, target.url, target.hopIndex, target.offset);
      const results = event === "clickThrough" ? [] : (historyByKey.get(key) ?? []);
      const latest = results.at(-1) ?? null;
      const status: TrackingWaterfallStatus = event === "clickThrough"
        ? "linked"
        : latest
          ? (latest.ok ? "ok" : "failed")
          : "ready";

      return {
        id: `${event}-${String(index)}-${target.url}`,
        event,
        kind: target.kind,
        status,
        originalUrl: target.url,
        expandedUrl: latest?.resolvedUrl ?? expandTrackingPreviewUrl(target.url, macros, defaults),
        hopIndex: target.hopIndex,
        sourceUrl: target.sourceUrl,
        offset: target.offset,
        dispatchCount: results.length,
        lastDispatchedAt: latest?.dispatchedAt ?? null,
        httpStatus: latest?.status ?? null,
        error: latest?.error ?? null,
      } satisfies TrackingWaterfallRow;
    })
    .sort((left, right) => {
      const leftOrder = eventOrder.get(left.event) ?? 99;
      const rightOrder = eventOrder.get(right.event) ?? 99;
      if (left.hopIndex !== right.hopIndex) {
        return left.hopIndex - right.hopIndex;
      }

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.originalUrl.localeCompare(right.originalUrl);
    });
}

function buildArtifactReadme(
  scenarioLabel: string | null,
  macroPreset: MacroPresetDefinition | null,
  complianceProfile: ComplianceProfileVerdict | null,
  waterfallCount: number,
  timelineCount: number,
  assetCount: number,
) {
  return [
    "VAST Validator Artifact Bundle",
    `Scenario: ${scenarioLabel ?? "Custom input"}`,
    `Macro preset: ${macroPreset?.label ?? "Custom"}`,
    `Compliance lens: ${complianceProfile ? `${complianceProfile.label} (${complianceProfile.status})` : "n/a"}`,
    `Tracking rows: ${String(waterfallCount)}`,
    `Timeline entries: ${String(timelineCount)}`,
    `Asset audit rows: ${String(assetCount)}`,
    "",
    "Included artifacts:",
    "- report.txt / report.json: current validation summary",
    "- source/: original XML or URL references and optional fixed XML",
    "- runtime/: playback snapshot, timeline, macro set, and tracking waterfall",
    "- validation/: wrapper chain, compliance verdicts, asset audit, and resolved-ad metadata",
  ].join("\n");
}

function buildTrackingFetch(documentUrls: readonly string[]): typeof fetch {
  const documentUrlSet = new Set(documentUrls);

  return async (input, init) => {
    const inputUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const normalizedUrl = new URL(inputUrl, typeof globalThis.location === "object" ? globalThis.location.origin : "http://localhost").toString();
    const looksLikeDocument = documentUrlSet.has(normalizedUrl) || /\.xml(?:$|[?#])/i.test(normalizedUrl);

    if (looksLikeDocument) {
      return globalThis.fetch(input, init);
    }

    return new Response(null, {
      status: 204,
      statusText: "No Content",
    });
  };
}

const VAST_PROXY_ENDPOINT = "https://vastlint.org/api/vast-proxy";

async function fetchVastDocumentWithProxyFallback(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const targetUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  try {
    const response = await globalThis.fetch(input, init);
    if (response.ok) {
      const text = await response.text();
      if (text.trim().startsWith("<")) {
        return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      throw new Error("Direct fetch returned a non-XML response");
    }
  } catch {
    // Fall through to the proxy below — direct browser fetch failed or was intercepted.
  }

  const proxyResponse = await globalThis.fetch(`${VAST_PROXY_ENDPOINT}?url=${encodeURIComponent(targetUrl)}`, {
    signal: init?.signal ?? undefined,
  });

  if (!proxyResponse.ok) {
    let message = `Proxy fetch failed with HTTP ${proxyResponse.status}`;
    try {
      const errorBody = (await proxyResponse.json()) as { error?: unknown };
      if (typeof errorBody.error === "string") {
        message = errorBody.error;
      }
    } catch {
      // Proxy error body wasn't JSON — keep the default message.
    }
    throw new Error(message);
  }

  return proxyResponse;
}

function buildPlayableMediaUrl(mediaUrl: string | null) {
  if (!mediaUrl) {
    return null;
  }

  const origin = typeof globalThis.location === "object" ? globalThis.location.origin : "http://localhost:5175";

  try {
    const parsed = new URL(mediaUrl);
    const pathname = parsed.pathname.toLowerCase();
    if (parsed.hostname === "example.com" && pathname.endsWith("/fixtures/video/360p30.webm")) {
      return buildLocalAssetUrl("fixtures/video/360p30.webm");
    }

    if (parsed.hostname === "example.com" && pathname.endsWith("/fixtures/video/360p30.mp4")) {
      return buildLocalAssetUrl("fixtures/video/360p30.mp4");
    }
  } catch {
    return mediaUrl;
  }

  return mediaUrl;
}

function collectApiFrameworks(xml: string | null): string[] {
  if (!xml) {
    return [];
  }

  const frameworks = [...xml.matchAll(/apiFramework=(?:"([^"]+)"|'([^']+)')/gi)]
    .map((match) => (match[1] ?? match[2] ?? "").trim())
    .filter((value) => value.length > 0);

  return [...new Set(frameworks)];
}

function buildRuntimeInspection(rootXml: string | null, resolvedAds: readonly VastResolvedAd[]): RuntimeInspection {
  const apiFrameworks = collectApiFrameworks(rootXml);
  const verificationResources = resolvedAds.flatMap((resolvedAd, adIndex) =>
    resolvedAd.adVerifications.flatMap((verification, verificationIndex) =>
      verification.resources.map((resource, resourceIndex) => ({
        id: `${String(adIndex)}-${String(verificationIndex)}-${String(resourceIndex)}`,
        adTitle: resolvedAd.adTitle || resolvedAd.adPod.adId || `Ad ${String(adIndex + 1)}`,
        vendor: verification.vendor ?? "unknown",
        kind: resource.kind,
        apiFramework: resource.apiFramework,
        url: resource.url,
      })),
    ),
  );

  const companions = resolvedAds.flatMap((resolvedAd, adIndex) =>
    resolvedAd.companions.map((companion, companionIndex) => ({
      id: `companion-${String(adIndex)}-${String(companionIndex)}`,
      adTitle: resolvedAd.adTitle || resolvedAd.adPod.adId || `Ad ${String(adIndex + 1)}`,
      title: `${companion.width} x ${companion.height}`,
      resource: companion.resources[0] ?? null,
      clickThroughUrl: companion.clickThroughUrl,
    })),
  );

  const icons = resolvedAds.flatMap((resolvedAd, adIndex) =>
    resolvedAd.icons.map((icon, iconIndex) => ({
      id: `icon-${String(adIndex)}-${String(iconIndex)}`,
      adTitle: resolvedAd.adTitle || resolvedAd.adPod.adId || `Ad ${String(adIndex + 1)}`,
      title: `${icon.width} x ${icon.height}`,
      resource: icon.resources[0] ?? null,
      clickThroughUrl: icon.clickThroughUrl,
    })),
  );

  return {
    apiFrameworks,
    verificationResources,
    companions,
    icons,
    omidCount: verificationResources.filter((resource) => resource.apiFramework?.toLowerCase() === "omid").length,
    vpaidCount: apiFrameworks.filter((framework) => framework.toUpperCase() === "VPAID").length,
  };
}

function buildReportSummary(
  lastRun: RunRequest,
  snapshot: VastSessionSnapshot,
  severity: ReturnType<typeof countBySeverity>,
  issues: readonly Issue[],
  resolvedAds: readonly VastResolvedAd[],
  scenarioLabel: string | null,
  lastFix: FixResult | null,
  activeComplianceVerdict: ComplianceProfileVerdict | null,
) {
  const lines = [
    "VAST Validator Report",
    `Scenario: ${scenarioLabel ?? "Custom input"}`,
    `Source: ${formatRunSource(lastRun)}`,
    `Action: ${lastRun.action}`,
    `Status: ${snapshot.status}`,
    `Version: ${snapshot.validation?.version ?? "unknown"}`,
    `Validity: ${snapshot.validation?.summary.valid ? "valid" : "not valid"}`,
    `Compliance lens: ${activeComplianceVerdict ? `${activeComplianceVerdict.label} (${activeComplianceVerdict.status})` : "n/a"}`,
    `Counts: ${String(severity.error)} error(s), ${String(severity.warning)} warning(s), ${String(severity.info)} info`,
    `Wrapper hops: ${String(snapshot.wrapperChain.length)}`,
    `Resolved ads: ${String(resolvedAds.length)}`,
  ];

  if (activeComplianceVerdict) {
    lines.push(`Profile verdict: ${activeComplianceVerdict.summary}`);
  }

  if (lastFix) {
    lines.push(`Fixes applied: ${String(lastFix.applied.length)} deterministic repair(s)`);
    lines.push(`Remaining post-fix issues: ${String(lastFix.remaining.length)}`);
  }

  if (issues.length > 0) {
    lines.push("Top findings:");
    for (const issue of issues.slice(0, 5)) {
      lines.push(`- [${issue.severity}] ${issue.id} at ${formatIssueLocation(issue)}: ${issue.message}`);
    }
  } else {
    lines.push("Top findings: none");
  }

  if (resolvedAds.length > 0) {
    lines.push("Resolved inventory:");
    for (const resolvedAd of resolvedAds.slice(0, 3)) {
      lines.push(
        `- ${resolvedAd.adTitle || resolvedAd.adPod.adId || "Untitled ad"} | ${resolvedAd.adType} | ${String(resolvedAd.mediaFiles.length)} media file(s) | ${resolvedAd.duration || "n/a"}`,
      );
    }
  }

  return lines.join("\n");
}

function buildErrorClipboardText(
  lastRun: RunRequest,
  scenarioLabel: string | null,
  activeComplianceVerdict: ComplianceProfileVerdict | null,
  issues: readonly Issue[],
) {
  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const lines = [
    "VAST Validator Error Export",
    `Scenario: ${scenarioLabel ?? "Custom input"}`,
    `Source: ${formatRunSource(lastRun)}`,
    `Action: ${lastRun.action}`,
    `Compliance lens: ${activeComplianceVerdict ? `${activeComplianceVerdict.label} (${activeComplianceVerdict.status})` : "n/a"}`,
    `Exported: ${new Date().toISOString()}`,
    "",
  ];

  if (errorIssues.length === 0) {
    lines.push("No error-severity findings are present in the current run.");
  } else {
    lines.push(`Errors: ${String(errorIssues.length)}`);
    lines.push("");
    for (const [index, issue] of errorIssues.entries()) {
      lines.push(`${String(index + 1)}. ${issue.id}`);
      lines.push(`   Location: ${formatIssueLocation(issue)}`);
      lines.push(`   Message: ${issue.message}`);
      lines.push(`   Spec: ${issue.spec_ref}`);
    }
  }

  if (warningCount > 0) {
    lines.push("");
    lines.push(`Warnings not included in this export: ${String(warningCount)}`);
  }

  return lines.join("\n");
}

function countBySeverity(issues: readonly Issue[]) {
  return issues.reduce(
    (summary, issue) => {
      summary[issue.severity] += 1;
      return summary;
    },
    { error: 0, warning: 0, info: 0 },
  );
}

function ruleDocsUrl(ruleId: string) {
  return `${RULE_DOCS_BASE}/${encodeURIComponent(ruleId)}`;
}

function isFollowableUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function ExternalGlyph() {
  return (
    <svg aria-hidden="true" className="external-glyph" focusable="false" viewBox="0 0 12 12">
      <path d="M4.5 1.5h6v6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 1.5 5 7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8.5 9.5h-6v-6h3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/**
 * Renders a URL from validator output. Absolute http(s) values become
 * new-tab links; data URIs, macro-only templates and relative paths stay inert
 * text so the UI never advertises a link that cannot be followed.
 */
function UrlValue({
  url,
  variant = "code",
  className,
  fallback = "none",
  hint,
}: {
  url: string | null | undefined;
  variant?: "code" | "text";
  className?: string;
  fallback?: string;
  hint?: string;
}) {
  const value = typeof url === "string" ? url.trim() : "";
  const classes = [variant === "code" ? "url-code" : "url-text", className].filter(Boolean).join(" ");

  if (value.length === 0) {
    return <span className={classes}>{fallback}</span>;
  }

  if (!isFollowableUrl(value)) {
    return (
      <span className={classes} title={value}>
        {value}
      </span>
    );
  }

  return (
    <a
      className={`${classes} url-link`}
      href={value}
      rel="noreferrer noopener"
      target="_blank"
      title={hint ? `${hint}\n\n${value}` : `Opens in a new tab: ${value}`}
    >
      {value}
      <ExternalGlyph />
    </a>
  );
}

function formatIssueLocation(issue: Issue) {
  if (issue.line === null) {
    return issue.path ?? "document";
  }

  return `L${issue.line}${issue.col ? `:${issue.col}` : ""}`;
}

function buildOverviewTone(valid: boolean | null, issueCount: number, resolvedCount: number) {
  if (valid === true && resolvedCount > 0) {
    return "valid-resolved";
  }

  if (valid === false || issueCount > 0) {
    return "attention";
  }

  return "idle";
}

function App() {
  const sharedSession = useMemo(() => readSharedSessionState(), []);
  const [sourceMode, setSourceMode] = useState<SourceMode>(sharedSession?.sourceMode ?? "xml");
  const [xmlDraft, setXmlDraft] = useState(sharedSession?.sourceMode === "xml" ? sharedSession.payload : sampleXml);
  const [urlDraft, setUrlDraft] = useState("");
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(sharedSession?.activeScenarioId ?? null);
  const [scenarioVersionFilter, setScenarioVersionFilter] = useState("all");
  const [scenarioActionFilter, setScenarioActionFilter] = useState<ScenarioActionFilter>("all");
  const [scenarioSurfaceFilter, setScenarioSurfaceFilter] = useState("all");
  const [expandedScenarioGroups, setExpandedScenarioGroups] = useState<Record<string, boolean>>({});
  const [scenarioLibraryOpen, setScenarioLibraryOpen] = useState(false);
  const [lastRun, setLastRun] = useState<RunRequest>({
    id: 1,
    sourceMode: sharedSession?.sourceMode ?? "xml",
    action: sharedSession?.action ?? "validate",
    payload: sharedSession?.payload ?? sampleXml,
  });
  const [lastFix, setLastFix] = useState<FixResult | null>(null);
  // Starts true: the app always queues a run for the initial payload on mount.
  const [isRunning, setIsRunning] = useState(true);
  const [runError, setRunError] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [selectedComplianceProfileId, setSelectedComplianceProfileId] = useState<ComplianceProfileId>(sharedSession?.selectedComplianceProfileId ?? "strict-iab");
  const [selectedFindingLine, setSelectedFindingLine] = useState<number | null>(null);
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>(COLLAPSED_SECTIONS);
  const [runnerTimeline, setRunnerTimeline] = useState<TimelineEntry[]>([]);
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const findingsSectionRef = useRef<HTMLElement | null>(null);
  const runnerEventCounter = useRef(0);
  const runnerVideoRef = useRef<HTMLVideoElement | null>(null);
  const xmlTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const runnerProgressBucketRef = useRef(-1);
  const macroDefaultsRef = useRef({
    CACHEBUSTING: createCacheBustingValue(),
    TIMESTAMP: createTimestamp(),
  });
  const macroEntryCounterRef = useRef(0);

  useEffect(() => {
    if (sharedSession?.sourceMode === "url") {
      setUrlDraft(sharedSession.payload);
    }
  }, [sharedSession]);

  const sessionSource = useMemo(
    () => buildSource(lastRun.sourceMode, lastRun.payload),
    [lastRun],
  );
  const activeValidateOptions = useMemo(
    () => buildComplianceValidateOptions(selectedComplianceProfileId),
    [selectedComplianceProfileId],
  );

  const { snapshot, session } = useVastSession({
    source: sessionSource,
    autoLoad: false,
    autoValidate: false,
    validateOptions: activeValidateOptions,
    fetch: fetchVastDocumentWithProxyFallback,
  });

  useEffect(() => {
    let cancelled = false;

    async function runCurrentAction() {
      setRunError(null);

      if (lastRun.payload.trim().length === 0) {
        setIsRunning(false);
        return;
      }

      setIsRunning(true);

      try {
        if (lastRun.action === "fix") {
          const result = await session.fix();
          if (!cancelled) {
            setLastFix(result);
          }
          return;
        }

        if (lastRun.action === "resolve") {
          await session.resolve();
          if (!cancelled) {
            setLastFix(null);
          }
          return;
        }

        await session.validate();
        if (!cancelled) {
          setLastFix(null);
        }
      } catch (error) {
        if (!cancelled) {
          setRunError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setIsRunning(false);
        }
      }
    }

    void runCurrentAction();

    return () => {
      cancelled = true;
    };
  }, [lastRun.id, lastRun.action, lastRun.payload, session]);

  const issues = snapshot.validation?.issues ?? [];
  const severity = countBySeverity(issues);
  const suspectedBlockedFetch = lastRun.sourceMode === "url" && issues.some((issue) => issue.id === "VAST-2.0-root-element");
  const resolvedAds = snapshot.resolvedAds;
  const activeScenario = SCENARIO_PRESETS.find((scenario) => scenario.id === activeScenarioId) ?? null;
  const scenarioVersionOptions = useMemo(
    () => Array.from(new Set(SCENARIO_PRESETS.map((scenario) => scenario.versionLabel))),
    [],
  );
  const scenarioActionOptions = useMemo(
    () => Array.from(new Set(SCENARIO_PRESETS.map((scenario) => scenario.action))),
    [],
  );
  const scenarioSurfaceOptions = useMemo(
    () => Array.from(new Set(SCENARIO_PRESETS.flatMap((scenario) => scenario.focusAreas))).sort((left, right) => left.localeCompare(right)),
    [],
  );
  const filteredScenarioGroups = useMemo(
    () => GROUPED_SCENARIO_PRESETS.map((group) => ({
      ...group,
      scenarios: group.scenarios.filter((scenario) => {
        if (scenarioVersionFilter !== "all" && scenario.versionLabel !== scenarioVersionFilter) {
          return false;
        }

        if (scenarioActionFilter !== "all" && scenario.action !== scenarioActionFilter) {
          return false;
        }

        if (scenarioSurfaceFilter !== "all" && !scenario.focusAreas.includes(scenarioSurfaceFilter)) {
          return false;
        }

        return true;
      }),
    })).filter((group) => group.scenarios.length > 0),
    [scenarioActionFilter, scenarioSurfaceFilter, scenarioVersionFilter],
  );
  const filteredScenarioCount = useMemo(
    () => filteredScenarioGroups.reduce((count, group) => count + group.scenarios.length, 0),
    [filteredScenarioGroups],
  );
  const hasScenarioFilters = scenarioVersionFilter !== "all" || scenarioActionFilter !== "all" || scenarioSurfaceFilter !== "all";
  const activeScenarioMatchesFilters = activeScenario === null
    ? true
    : filteredScenarioGroups.some((group) => group.scenarios.some((scenario) => scenario.id === activeScenario.id));
  const overviewTone = buildOverviewTone(snapshot.validation?.summary.valid ?? null, issues.length, resolvedAds.length);
  const activePayload = sourceMode === "xml" ? xmlDraft : urlDraft;
  const trimmedPayload = activePayload.trim();
  const urlDraftTrimmed = urlDraft.trim();
  const urlDraftValid = isValidRemoteUrl(urlDraftTrimmed);
  const hasClearableInput = xmlDraft.length > 0 || urlDraft.length > 0 || lastRun.payload.length > 0;
  const canRun = sourceMode === "xml" ? trimmedPayload.length > 0 : urlDraftValid;
  const editorAnnotationsMatchPayload = sourceMode === "xml" && lastRun.sourceMode === "xml" && lastRun.payload === xmlDraft;
  const editorIssueMarkers = useMemo(
    () => editorAnnotationsMatchPayload ? buildEditorIssueMarkers(issues) : [],
    [editorAnnotationsMatchPayload, issues],
  );
  const editorDocumentIssueCount = useMemo(
    () => editorAnnotationsMatchPayload
      ? issues.filter((issue) => typeof issue.line !== "number" || !Number.isFinite(issue.line) || issue.line < 1).length
      : 0,
    [editorAnnotationsMatchPayload, issues],
  );
  const editorAnnotationsStale = sourceMode === "xml" && lastRun.sourceMode === "xml" && lastRun.payload !== xmlDraft && issues.length > 0;
  // Line numbers only address the editor when the editor is what was validated.
  // For URL runs they point at the fetched document, which is not on screen.
  const canJumpToEditorLine = lastRun.sourceMode === "xml" && lastRun.payload === xmlDraft && xmlDraft.length > 0;
  const displayedIssues = useMemo(
    () => selectedFindingLine === null ? issues : issues.filter((issue) => issue.line === selectedFindingLine),
    [issues, selectedFindingLine],
  );
  const runnerDocumentUrls = useMemo(() => {
    const urls = new Set<string>();
    if (lastRun.sourceMode === "url") {
      urls.add(lastRun.payload);
    }

    for (const hop of snapshot.wrapperChain) {
      if (hop.url) {
        urls.add(hop.url);
      }
    }

    if (snapshot.resolvedAd?.finalUrl) {
      urls.add(snapshot.resolvedAd.finalUrl);
    }

    return [...urls];
  }, [lastRun.payload, lastRun.sourceMode, snapshot.resolvedAd?.finalUrl, snapshot.wrapperChain]);
  const runnerFetch = useMemo(
    () => buildTrackingFetch(runnerDocumentUrls),
    [runnerDocumentUrls],
  );
  const runnerSession = useMemo(
    () => createVastSession({
      source: buildSource(lastRun.sourceMode, lastRun.payload),
      fetch: runnerFetch,
      maxWrapperDepth: 5,
      validateOptions: activeValidateOptions,
    }),
    [activeValidateOptions, lastRun.payload, lastRun.sourceMode, runnerFetch],
  );
  const playback = useVastPlayback({
    session: runnerSession,
    autoInitialize: false,
    mediaSelection: {
      supportedMimeTypes: ["video/mp4", "video/webm", "application/x-mpegURL"],
      preferredMimeTypes: ["video/mp4", "video/webm"],
    },
  });
  const runnerTracker = useVastTracker({ session: runnerSession });
  const runnerSnapshot = playback.snapshot;
  const inventoryAds = useMemo(
    () => (resolvedAds.length > 0 ? resolvedAds : runnerSnapshot.resolvedAd ? [runnerSnapshot.resolvedAd] : []),
    [resolvedAds, runnerSnapshot.resolvedAd],
  );
  const inspectionXml = snapshot.rootXml ?? (lastRun.sourceMode === "xml" ? lastRun.payload : null);
  const runtimeInspection = useMemo(
    () => buildRuntimeInspection(inspectionXml, inventoryAds),
    [inspectionXml, inventoryAds],
  );
  const runnerMediaUrl = useMemo(
    () => buildPlayableMediaUrl(runnerSnapshot.mediaSelection.selected?.url ?? null),
    [runnerSnapshot.mediaSelection.selected?.url],
  );
  const macroPresets = useMemo(
    () => buildMacroPresetDefinitions(
      macroDefaultsRef.current,
      runnerSnapshot.currentTimeSec,
      runnerSnapshot.muted,
      runnerSnapshot.viewability,
      runnerSnapshot.resolvedAd,
    ),
    [runnerSnapshot.currentTimeSec, runnerSnapshot.muted, runnerSnapshot.resolvedAd, runnerSnapshot.viewability],
  );
  const [selectedMacroPresetId, setSelectedMacroPresetId] = useState("web-browser");
  const [macroEntries, setMacroEntries] = useState<MacroEntryDraft[]>(() => buildMacroEntryDrafts({
    CACHEBUSTING: createCacheBustingValue(),
    TIMESTAMP: createTimestamp(),
    ERRORCODE: "901",
    CONTENTPLAYHEAD: "00:00:00.000",
    PAGEURL: "https://publisher.example.com/player",
  }));
  const activeMacroPreset = macroPresets.find((preset) => preset.id === selectedMacroPresetId) ?? macroPresets[0] ?? null;
  const activeMacros = useMemo(() => buildMacroRecord(macroEntries), [macroEntries]);
  const trackingWaterfallRows = useMemo(
    () => buildTrackingWaterfall(runnerTracker.tracking.plan, runnerTracker.tracking.history, activeMacros, macroDefaultsRef.current),
    [activeMacros, runnerTracker.tracking.history, runnerTracker.tracking.plan],
  );
  const waterfallSummary = useMemo(() => ({
    total: trackingWaterfallRows.length,
    ok: trackingWaterfallRows.filter((row) => row.status === "ok").length,
    failed: trackingWaterfallRows.filter((row) => row.status === "failed").length,
    pending: trackingWaterfallRows.filter((row) => row.status === "ready").length,
    linked: trackingWaterfallRows.filter((row) => row.status === "linked").length,
  }), [trackingWaterfallRows]);
  const macroPreviewRows = useMemo(() => {
    const rowsWithDifferences = trackingWaterfallRows.filter((row) => row.originalUrl !== row.expandedUrl);
    return (rowsWithDifferences.length > 0 ? rowsWithDifferences : trackingWaterfallRows).slice(0, 8);
  }, [trackingWaterfallRows]);
  const wrapperInspectors = useMemo(
    () => buildWrapperInspectors(snapshot.wrapperChain, inventoryAds),
    [inventoryAds, snapshot.wrapperChain],
  );
  const assetAuditRows = useMemo(() => buildAssetAuditRows(inventoryAds), [inventoryAds]);
  const assetAuditSummary = useMemo(() => ({
    total: assetAuditRows.length,
    ready: assetAuditRows.filter((row) => row.riskLevel === "ok").length,
    review: assetAuditRows.filter((row) => row.riskLevel === "attention").length,
    risk: assetAuditRows.filter((row) => row.riskLevel === "risk").length,
  }), [assetAuditRows]);
  const complianceVerdicts = useMemo(
    () => buildComplianceVerdicts(
      snapshot.validation !== null,
      issues,
      inventoryAds,
      runtimeInspection,
      snapshot.wrapperChain,
      assetAuditRows,
    ),
    [assetAuditRows, inventoryAds, issues, runtimeInspection, snapshot.validation, snapshot.wrapperChain],
  );
  const activeComplianceVerdict = complianceVerdicts.find((profile) => profile.id === selectedComplianceProfileId)
    ?? complianceVerdicts[0]
    ?? null;
  const timelineEntries = useMemo(() => {
    const sessionEntries = runnerSnapshot.session.events.map((event) => ({
      id: `session-${event.timestamp}-${event.type}`,
      at: event.timestamp,
      title: event.type,
      detail: event.detail ? JSON.stringify(event.detail) : "Session event",
      kind: "session" as const,
    }));

    const trackingEntries = runnerTracker.tracking.history.map((entry, index) => ({
      id: `tracking-${entry.dispatchedAt}-${String(index)}`,
      at: entry.dispatchedAt,
      title: `track:${entry.event}`,
      detail: `${entry.ok ? "ok" : "failed"} ${entry.url}`,
      kind: "tracking" as const,
    }));

    return [...runnerTimeline, ...sessionEntries, ...trackingEntries]
      .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
      .slice(0, 16);
  }, [runnerSnapshot.session.events, runnerTimeline, runnerTracker.tracking.history]);
  const reportSummary = useMemo(
    () => buildReportSummary(lastRun, snapshot, severity, issues, inventoryAds, activeScenario?.label ?? null, lastFix, activeComplianceVerdict),
    [activeComplianceVerdict, activeScenario?.label, inventoryAds, issues, lastFix, lastRun, severity, snapshot],
  );
  const reportData = useMemo(
    () => ({
      generatedAt: new Date().toISOString(),
      scenario: activeScenario?.label ?? null,
      sourceMode: lastRun.sourceMode,
      source: formatRunSource(lastRun),
      action: lastRun.action,
      status: snapshot.status,
      validation: {
        version: snapshot.validation?.version ?? null,
        valid: snapshot.validation?.summary.valid ?? null,
        errors: severity.error,
        warnings: severity.warning,
        infos: severity.info,
      },
      compliance: {
        activeProfile: activeComplianceVerdict
          ? {
              id: activeComplianceVerdict.id,
              label: activeComplianceVerdict.label,
              status: activeComplianceVerdict.status,
              summary: activeComplianceVerdict.summary,
            }
          : null,
        profiles: complianceVerdicts,
      },
      wrappers: snapshot.wrapperChain.map((hop) => ({
        index: hop.index,
        adType: hop.adType,
        adSystem: hop.adSystem,
        adTitle: hop.adTitle,
        duration: hop.duration,
        source: hop.wrapperUri ?? hop.url ?? "inline source",
        validation: hop.validation
          ? {
              errors: hop.validation.summary.errors,
              warnings: hop.validation.summary.warnings,
              infos: hop.validation.summary.infos,
            }
          : null,
      })),
      issues: issues.map((issue) => ({
        id: issue.id,
        severity: issue.severity,
        location: formatIssueLocation(issue),
        message: issue.message,
        specRef: issue.spec_ref,
      })),
      resolvedAds: inventoryAds.map((resolvedAd) => ({
        title: resolvedAd.adTitle || resolvedAd.adPod.adId || "Untitled ad",
        adType: resolvedAd.adType,
        sequence: resolvedAd.adPod.sequence,
        duration: resolvedAd.duration,
        mediaFiles: resolvedAd.mediaFiles.map((mediaFile) => ({
          mimeType: mediaFile.mimeType,
          delivery: mediaFile.delivery,
          width: mediaFile.width,
          height: mediaFile.height,
          url: mediaFile.url,
        })),
      })),
      assetAudit: assetAuditRows,
      fix: lastFix
        ? {
            applied: lastFix.applied,
            remaining: lastFix.remaining.length,
          }
        : null,
      runner: {
        status: runnerSnapshot.status,
        mediaUrl: runnerMediaUrl,
        clickThroughUrl: runnerSnapshot.clickThroughUrl,
        muted: runnerSnapshot.muted,
        fullscreen: runnerSnapshot.fullscreen,
        viewability: runnerSnapshot.viewability,
        milestones: runnerSnapshot.milestones,
        macroPreset: activeMacroPreset?.id ?? null,
        macros: activeMacros,
        trackingWaterfall: trackingWaterfallRows,
        trackingHistory: runnerTracker.tracking.history,
      },
    }),
    [activeComplianceVerdict, activeMacroPreset?.id, activeMacros, activeScenario?.label, assetAuditRows, complianceVerdicts, inventoryAds, issues, lastFix, lastRun, runnerMediaUrl, runnerSnapshot.clickThroughUrl, runnerSnapshot.fullscreen, runnerSnapshot.milestones, runnerSnapshot.muted, runnerSnapshot.status, runnerSnapshot.viewability, runnerTracker.tracking.history, severity, snapshot, trackingWaterfallRows],
  );

  useEffect(() => {
    if (complianceVerdicts.length === 0) {
      return;
    }

    if (complianceVerdicts.some((profile) => profile.id === selectedComplianceProfileId)) {
      return;
    }

    setSelectedComplianceProfileId(complianceVerdicts[0].id);
  }, [complianceVerdicts, selectedComplianceProfileId]);

  useEffect(() => {
    if (macroPresets.length === 0) {
      return;
    }

    const selectedPreset = macroPresets.find((preset) => preset.id === selectedMacroPresetId) ?? null;
    if (selectedPreset) {
      return;
    }

    const fallbackPreset = macroPresets[0];
    setSelectedMacroPresetId(fallbackPreset.id);
    setMacroEntries(buildMacroEntryDrafts(fallbackPreset.macros));
  }, [macroPresets, selectedMacroPresetId]);

  useEffect(() => {
    if (!reportNotice) {
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      setReportNotice(null);
    }, 2400);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [reportNotice]);

  useEffect(() => {
    setRunnerTimeline([]);
    runnerProgressBucketRef.current = -1;
  }, [runnerSession]);

  useEffect(() => {
    setEditorScrollTop(xmlTextareaRef.current?.scrollTop ?? 0);
  }, [editorAnnotationsMatchPayload, sourceMode]);

  useEffect(() => {
    if (sourceMode !== "xml" || editorAnnotationsStale) {
      setSelectedFindingLine(null);
      return;
    }

    if (selectedFindingLine === null) {
      return;
    }

    if (!editorIssueMarkers.some((marker) => marker.line === selectedFindingLine)) {
      setSelectedFindingLine(null);
    }
  }, [editorAnnotationsStale, editorIssueMarkers, selectedFindingLine, sourceMode]);

  useEffect(() => {
    const video = runnerVideoRef.current;
    if (!video) {
      return;
    }

    if (runnerSnapshot.status === "ended" || runnerSnapshot.status === "error") {
      video.pause();
    }
  }, [runnerSnapshot.status]);

  const sectionContentCounts = useMemo<Record<SectionId, number>>(() => ({
    findings: issues.length,
    // A one-entry chain is just the root document, not a chain worth opening.
    wrappers: Math.max(0, snapshot.wrapperChain.length - 1),
    resolved: inventoryAds.length,
    playback: runnerSnapshot.resolvedAd ? 1 : 0,
    tracking: trackingWaterfallRows.length,
    runtime: runtimeInspection.verificationResources.length
      + runtimeInspection.companions.length
      + runtimeInspection.icons.length
      + runtimeInspection.apiFrameworks.length,
    macros: 0,
    export: 0,
  }), [
    inventoryAds.length,
    issues.length,
    runnerSnapshot.resolvedAd,
    runtimeInspection.apiFrameworks.length,
    runtimeInspection.companions.length,
    runtimeInspection.icons.length,
    runtimeInspection.verificationResources.length,
    snapshot.wrapperChain.length,
    trackingWaterfallRows.length,
  ]);
  const sectionContentKey = SECTION_IDS.map((id) => `${id}:${String(sectionContentCounts[id])}`).join("|");

  // Reveal a section as soon as a run gives it something to show. Keyed on the
  // counts, so manually collapsing a section stays collapsed until they change.
  useEffect(() => {
    setOpenSections((current) => {
      const next = { ...current };
      let changed = false;

      for (const id of SECTION_IDS) {
        if (sectionContentCounts[id] > 0 && !current[id]) {
          next[id] = true;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [sectionContentKey, sectionContentCounts]);

  const toggleSection = (id: SectionId) => {
    setOpenSections((current) => ({ ...current, [id]: !current[id] }));
  };

  const appendRunnerTimeline = (kind: TimelineEntry["kind"], title: string, detail: string) => {
    runnerEventCounter.current += 1;
    setRunnerTimeline((current) => [
      {
        id: `${kind}-${String(runnerEventCounter.current)}`,
        at: createTimestamp(),
        title,
        detail,
        kind,
      },
      ...current,
    ].slice(0, 20));
  };

  const queueRun = (nextRun: Omit<RunRequest, "id">) => {
    setLastRun((current) => ({
      id: current.id + 1,
      ...nextRun,
    }));
  };

  const runAction = (action: ActionMode, modeOverride?: SourceMode) => {
    const mode = modeOverride ?? sourceMode;
    const draft = mode === "xml" ? xmlDraft : urlDraft;
    const trimmed = draft.trim();
    if (!trimmed) {
      setRunError(mode === "xml" ? "Paste VAST XML before running." : "Enter a VAST URL before running.");
      return;
    }

    if (mode === "url" && !isValidRemoteUrl(trimmed)) {
      setRunError("Enter a full http:// or https:// VAST URL.");
      return;
    }

    // XML runs keep the editor text verbatim: trimming it would break the
    // line numbers the inline markers are anchored to.
    const payload = mode === "xml" ? draft : trimmed;

    if (modeOverride && modeOverride !== sourceMode) {
      setSourceMode(modeOverride);
    }

    if (action !== "fix") {
      setLastFix(null);
    }

    queueRun({
      sourceMode: mode,
      action,
      payload,
    });
  };

  const loadSample = () => {
    setSourceMode("xml");
    setXmlDraft(sampleXml);
    setActiveScenarioId(null);
    setRunError(null);
    setLastFix(null);
  };

  const clearInputs = () => {
    setSourceMode("xml");
    setXmlDraft("");
    setUrlDraft("");
    setActiveScenarioId(null);
    setRunError(null);
    setLastFix(null);
    setReportNotice(null);
    setSelectedFindingLine(null);
    setEditorScrollTop(0);
    setOpenSections(COLLAPSED_SECTIONS);
    queueRun({
      sourceMode: "xml",
      action: "validate",
      payload: "",
    });
  };

  const runScenario = (scenario: ScenarioPreset) => {
    const payload = scenario.sourceMode === "url" ? buildScenarioUrl(scenario.payload) : absolutizeScenarioXmlLocalUrls(scenario.payload);
    setActiveScenarioId(scenario.id);
    setRunError(null);
    setLastFix(null);
    setSourceMode(scenario.sourceMode);
    setScenarioLibraryOpen(false);

    if (scenario.sourceMode === "xml") {
      setXmlDraft(payload);
    } else {
      setUrlDraft(payload);
    }

    queueRun({
      sourceMode: scenario.sourceMode,
      action: scenario.action,
      payload,
    });
  };

  const applyFixedXml = () => {
    if (!lastFix) {
      return;
    }

    const nextPayload = lastFix.xml;
    setSourceMode("xml");
    setXmlDraft(nextPayload);
    setActiveScenarioId(null);
    setRunError(null);
    queueRun({
      sourceMode: "xml",
      action: "validate",
      payload: nextPayload,
    });
  };

  const copyReportSummary = async () => {
    try {
      await globalThis.navigator.clipboard.writeText(reportSummary);
      setReportNotice("Summary copied to clipboard.");
    } catch {
      setReportNotice("Clipboard access unavailable. Use a download instead.");
    }
  };

  const copyErrorFindings = async () => {
    try {
      await globalThis.navigator.clipboard.writeText(
        buildErrorClipboardText(lastRun, activeScenario?.label ?? null, activeComplianceVerdict, issues),
      );
      setReportNotice(
        issues.some((issue) => issue.severity === "error")
          ? "Error findings copied to clipboard."
          : "No error findings. Status note copied to clipboard.",
      );
    } catch {
      setReportNotice("Error export copy failed. Clipboard access unavailable.");
    }
  };

  const copyShareLink = async () => {
    try {
      const sharePayload = encodeBase64Url(JSON.stringify({
        sourceMode: lastRun.sourceMode,
        action: lastRun.action,
        payload: lastRun.payload,
        activeScenarioId,
        selectedComplianceProfileId,
      } satisfies SharedSessionState));
      const shareUrl = new URL(globalThis.location.href);
      shareUrl.hash = new URLSearchParams({ session: sharePayload }).toString();
      await globalThis.navigator.clipboard.writeText(shareUrl.toString());
      setReportNotice("Share link copied to clipboard.");
    } catch {
      setReportNotice("Share link copy failed. Clipboard access unavailable.");
    }
  };

  const downloadReport = (kind: "txt" | "json") => {
    const content = kind === "json" ? JSON.stringify(reportData, null, 2) : reportSummary;
    const blob = new Blob([content], {
      type: kind === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `vast-validator-report-${activeScenario?.id ?? "custom"}.${kind}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    setReportNotice(kind === "json" ? "JSON report downloaded." : "Text report downloaded.");
  };

  const downloadArtifactBundle = async () => {
    const bundleBaseName = `vast-validator-artifacts-${activeScenario?.id ?? "custom"}`;
    const zip = new JSZip();

    zip.file(
      "README.txt",
      buildArtifactReadme(
        activeScenario?.label ?? null,
        activeMacroPreset,
        activeComplianceVerdict,
        trackingWaterfallRows.length,
        timelineEntries.length,
        assetAuditRows.length,
      ),
    );
    zip.file("report.txt", reportSummary);
    zip.file("report.json", JSON.stringify(reportData, null, 2));

    if (lastRun.sourceMode === "xml") {
      zip.file("source/request.xml", lastRun.payload);
    } else {
      zip.file("source/request-url.txt", `${lastRun.payload}\n`);
    }

    if (snapshot.rootXml) {
      zip.file("source/root.xml", snapshot.rootXml);
    }

    if (lastFix?.xml) {
      zip.file("source/fixed.xml", lastFix.xml);
    }

    zip.file("runtime/macros.json", JSON.stringify({
      preset: activeMacroPreset?.id ?? null,
      macros: activeMacros,
    }, null, 2));
    zip.file("runtime/tracking-waterfall.json", JSON.stringify(trackingWaterfallRows, null, 2));
    zip.file("runtime/tracking-history.json", JSON.stringify(runnerTracker.tracking.history, null, 2));
    zip.file("runtime/timeline.json", JSON.stringify(timelineEntries, null, 2));
    zip.file("runtime/playback.json", JSON.stringify({
      status: runnerSnapshot.status,
      mediaUrl: runnerMediaUrl,
      clickThroughUrl: runnerSnapshot.clickThroughUrl,
      currentTimeSec: runnerSnapshot.currentTimeSec,
      durationSec: runnerSnapshot.durationSec,
      muted: runnerSnapshot.muted,
      fullscreen: runnerSnapshot.fullscreen,
      viewability: runnerSnapshot.viewability,
      milestones: runnerSnapshot.milestones,
    }, null, 2));
    zip.file("validation/wrapper-chain.json", JSON.stringify(snapshot.wrapperChain, null, 2));
    zip.file("validation/resolved-ads.json", JSON.stringify(inventoryAds, null, 2));
    zip.file("validation/issues.json", JSON.stringify(issues, null, 2));
    zip.file("validation/compliance.json", JSON.stringify({
      activeProfile: activeComplianceVerdict,
      profiles: complianceVerdicts,
    }, null, 2));
    zip.file("validation/asset-audit.json", JSON.stringify(assetAuditRows, null, 2));

    const blob = await zip.generateAsync({ type: "blob" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${bundleBaseName}.zip`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    setReportNotice("Artifact bundle downloaded.");
  };

  const applyMacroPreset = (presetId: string) => {
    const preset = macroPresets.find((candidate) => candidate.id === presetId) ?? null;
    if (!preset) {
      return;
    }

    setSelectedMacroPresetId(presetId);
    setMacroEntries(buildMacroEntryDrafts(preset.macros));
  };

  const updateMacroEntry = (id: string, field: "key" | "value", value: string) => {
    setMacroEntries((current) => current.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }

      return {
        ...entry,
        [field]: field === "key" ? value.toUpperCase() : value,
      };
    }));
  };

  const addMacroEntry = () => {
    macroEntryCounterRef.current += 1;
    setMacroEntries((current) => [
      ...current,
      {
        id: `macro-${String(macroEntryCounterRef.current)}`,
        key: "",
        value: "",
      },
    ]);
  };

  const removeMacroEntry = (id: string) => {
    setMacroEntries((current) => {
      if (current.length === 1) {
        return current.map((entry) => entry.id === id ? { ...entry, key: "", value: "" } : entry);
      }

      return current.filter((entry) => entry.id !== id);
    });
  };

  const preparePlaybackRunner = async () => {
    try {
      const prepared = await playback.initialize();
      appendRunnerTimeline(
        "ui",
        "runner:prepare",
        prepared.mediaSelection.selected
          ? `Prepared ${prepared.mediaSelection.selected.mimeType} media.`
          : "Prepared session with no playable media selection.",
      );
    } catch (error) {
      appendRunnerTimeline("ui", "runner:error", error instanceof Error ? error.message : String(error));
    }
  };

  const setPlaybackViewability = async (viewability: VastPlaybackViewability) => {
    try {
      await playback.setViewability(viewability);
      appendRunnerTimeline("ui", `viewability:${viewability}`, "Updated playback viewability.");
    } catch (error) {
      appendRunnerTimeline("ui", "viewability:error", error instanceof Error ? error.message : String(error));
    }
  };

  const triggerRunnerClick = async () => {
    try {
      const result = await playback.click();
      appendRunnerTimeline(
        "ui",
        "runner:click",
        result.clickThroughUrl ? `Tracked click-through for ${result.clickThroughUrl}` : "Tracked click without click-through URL.",
      );
    } catch (error) {
      appendRunnerTimeline("ui", "runner:click-error", error instanceof Error ? error.message : String(error));
    }
  };

  const skipPlayback = async () => {
    try {
      await playback.skip();
      runnerVideoRef.current?.pause();
      appendRunnerTimeline("ui", "runner:skip", "Marked the current ad as skipped.");
    } catch (error) {
      appendRunnerTimeline("ui", "runner:skip-error", error instanceof Error ? error.message : String(error));
    }
  };

  const signalRunnerError = async () => {
    try {
      await playback.signalError({ macros: activeMacros });
      runnerVideoRef.current?.pause();
      appendRunnerTimeline("ui", "runner:signal-error", "Tracked an error against the current playback session.");
    } catch (error) {
      appendRunnerTimeline("ui", "runner:error", error instanceof Error ? error.message : String(error));
    }
  };

  const toggleRunnerMute = async () => {
    const video = runnerVideoRef.current;
    const nextMuted = !(video?.muted ?? runnerSnapshot.muted);
    if (video) {
      video.muted = nextMuted;
    }

    try {
      await playback.setMuted(nextMuted);
      appendRunnerTimeline("ui", nextMuted ? "runner:mute" : "runner:unmute", `Muted=${String(nextMuted)}.`);
    } catch (error) {
      appendRunnerTimeline("ui", "runner:mute-error", error instanceof Error ? error.message : String(error));
    }
  };

  const syncRunnerMuted = async () => {
    const video = runnerVideoRef.current;
    const nextMuted = video?.muted ?? runnerSnapshot.muted;

    try {
      await playback.setMuted(nextMuted);
    } catch (error) {
      appendRunnerTimeline("media", "video:mute-sync-error", error instanceof Error ? error.message : String(error));
    }
  };

  const handleRunnerPlay = async () => {
    try {
      if (runnerSnapshot.status === "paused") {
        await playback.resume();
        appendRunnerTimeline("media", "video:resume", "Resumed the media element.");
        return;
      }

      if (!runnerSnapshot.milestones.start) {
        await playback.start();
        appendRunnerTimeline("media", "video:start", "Started playback and dispatched impression/start tracking.");
      }
    } catch (error) {
      appendRunnerTimeline("media", "video:error", error instanceof Error ? error.message : String(error));
    }
  };

  const handleRunnerPause = async () => {
    const video = runnerVideoRef.current;
    if (video?.ended || runnerSnapshot.status !== "playing") {
      return;
    }

    try {
      await playback.pause();
      appendRunnerTimeline("media", "video:pause", "Paused the media element.");
    } catch (error) {
      appendRunnerTimeline("media", "video:pause-error", error instanceof Error ? error.message : String(error));
    }
  };

  const handleRunnerTimeUpdate = async () => {
    const video = runnerVideoRef.current;
    if (!video) {
      return;
    }

    const bucket = Math.floor(video.currentTime * 4);
    if (bucket === runnerProgressBucketRef.current) {
      return;
    }

    runnerProgressBucketRef.current = bucket;

    try {
      await playback.updateProgress(video.currentTime, Number.isFinite(video.duration) ? video.duration : undefined);
    } catch (error) {
      appendRunnerTimeline("media", "video:progress-error", error instanceof Error ? error.message : String(error));
    }
  };

  const handleRunnerEnded = async () => {
    try {
      await playback.complete();
      appendRunnerTimeline("media", "video:ended", "Completed playback for the current ad.");
    } catch (error) {
      appendRunnerTimeline("media", "video:end-error", error instanceof Error ? error.message : String(error));
    }
  };

  const focusFindingsForLine = (line: number) => {
    setSelectedFindingLine((current) => {
      const nextLine = current === line ? null : line;
      if (nextLine !== null) {
        setOpenSections((sections) => (sections.findings ? sections : { ...sections, findings: true }));
        globalThis.requestAnimationFrame(() => {
          findingsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }

      return nextLine;
    });
  };

  const revealEditorLine = (line: number) => {
    const textarea = xmlTextareaRef.current;
    if (!textarea) {
      return;
    }

    setSourceMode("xml");
    const lines = textarea.value.split("\n");
    const clamped = Math.min(Math.max(line, 1), lines.length);
    const start = lines.slice(0, clamped - 1).reduce((total, text) => total + text.length + 1, 0);

    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, start + lines[clamped - 1].length);
    // Park the target line a third of the way down rather than at the very top,
    // so the surrounding elements stay readable.
    const offset = Math.max(0, (clamped - 1) * EDITOR_LINE_HEIGHT - (textarea.clientHeight / 3));
    textarea.scrollTop = offset;
    setEditorScrollTop(textarea.scrollTop);
    textarea.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead-copy">
          <h1>Next-Gen VAST Tester</h1>
          <p className="lede">
            An independent, vastlint-powered rebuild of the legacy IAB Tech Lab VAST Tester. Validation, deterministic
            repair, wrapper inspection, playback and tracking QA, and partner-shareable reports across VAST 2.0-4.4.
          </p>
        </div>
        <nav className="masthead-links" aria-label="Reference and feedback">
          <a href={RULE_DOCS_BASE} rel="noreferrer noopener" target="_blank">
            Rule catalog
            <ExternalGlyph />
          </a>
          <a href="https://vastlint.org/docs/common-vast-errors" rel="noreferrer noopener" target="_blank">
            Common VAST errors
            <ExternalGlyph />
          </a>
          <a href="https://github.com/aleksUIX/vastlint/issues/new" rel="noreferrer noopener" target="_blank">
            Report an issue
            <ExternalGlyph />
          </a>
          <a href="https://github.com/aleksUIX/vastlint/discussions" rel="noreferrer noopener" target="_blank">
            Start a discussion
            <ExternalGlyph />
          </a>
          <a href="mailto:aleks@vastlint.org?subject=VAST%20Tester%20feedback">Send feedback</a>
        </nav>
      </header>

      <div
        className={`statusbar tone-${overviewTone}`}
        aria-label="Run status"
        data-status={snapshot.status}
        data-action={lastRun.action}
        data-source={lastRun.sourceMode}
        data-run={lastRun.id}
        data-busy={isRunning}
      >
        <div className="statusbar-run">
          <span className="status-dot" aria-hidden="true" />
          <strong>{snapshot.status}</strong>
          <span>
            {lastRun.action} · {lastRun.sourceMode === "xml" ? "editor XML" : "remote URL"} · VAST{" "}
            {snapshot.validation?.version ?? "n/a"} · {lastRun.payload.length} bytes
          </span>
        </div>
        <div className="statusbar-metrics">
          <Metric label="Errors" value={severity.error} accent={severity.error > 0 ? "error" : "neutral"} />
          <Metric label="Warnings" value={severity.warning} accent={severity.warning > 0 ? "warning" : "neutral"} />
          <Metric label="Info" value={severity.info} accent={severity.info > 0 ? "info" : "neutral"} />
          <Metric label="Hops" value={snapshot.wrapperChain.length} accent="neutral" />
          <Metric label="Ads" value={resolvedAds.length} accent="neutral" />
          <Metric
            label="Valid"
            value={snapshot.validation ? (snapshot.validation.summary.valid ? "yes" : "no") : "n/a"}
            accent={snapshot.validation ? (snapshot.validation.summary.valid ? "good" : "error") : "neutral"}
          />
        </div>
      </div>

      <main className="stack">
        <section className="panel panel-static source-panel" data-section="source" data-open="true">
          <div className="panel-head static">
            <h2>Source</h2>
            <span className="panel-meta">
              <span className="tag">{sourceMode === "url" ? "Remote URL is active" : "Editor XML is active"}</span>
            </span>
          </div>

          <div className="panel-body">
            <div className={`source-field${sourceMode === "url" ? " is-active" : ""}`}>
              <div className="field-head">
                <label className="field-label" htmlFor="vast-url">
                  Remote VAST URL
                </label>
                <span className="field-note">Fetched in the browser, so CORS on the target endpoint applies</span>
              </div>
              <div className="url-row">
                <input
                  id="vast-url"
                  onChange={(event) => {
                    setActiveScenarioId(null);
                    setSourceMode("url");
                    setUrlDraft(event.target.value);
                  }}
                  onFocus={() => {
                    if (urlDraftTrimmed.length > 0) {
                      setSourceMode("url");
                    }
                  }}
                  placeholder="https://example.com/vast.xml"
                  type="url"
                  value={urlDraft}
                />
                <button
                  className="secondary"
                  disabled={!urlDraftValid}
                  onClick={() => runAction("validate", "url")}
                  type="button"
                >
                  Fetch and validate
                </button>
              </div>
              {urlDraftTrimmed.length > 0 && !urlDraftValid ? (
                <p className="field-error">Use a full http:// or https:// URL. Relative paths are not accepted.</p>
              ) : null}
            </div>

            <div className="source-divider">
              <span>or paste a tag</span>
            </div>

            <div className={`source-field${sourceMode === "xml" ? " is-active" : ""}`}>
              <div className="field-head">
                <label className="field-label" htmlFor="vast-xml">
                  VAST XML
                </label>
                <span className="field-note">{xmlDraft.trim().length} bytes in the editor</span>
              </div>
              <div
                className={`editor-shell ${editorIssueMarkers.length > 0 ? "has-markers" : ""} ${editorAnnotationsStale ? "editor-stale" : ""}`}
                style={EDITOR_GEOMETRY}
              >
                {editorIssueMarkers.length > 0 ? (
                  <div className="editor-overlay" aria-label="Inline issue markers">
                    <div
                      className="editor-scroll-layer"
                      style={{ transform: `translateY(-${String(editorScrollTop)}px)` }}
                    >
                      {editorIssueMarkers.map((marker) => (
                        <div
                          className={`editor-inline-marker severity-${marker.severity}`}
                          key={marker.id}
                          style={{ top: `${String(marker.top)}px` }}
                        >
                          <button
                            aria-label={`Show findings for line ${String(marker.line)}`}
                            aria-pressed={selectedFindingLine === marker.line}
                            className={`chip editor-inline-chip ${selectedFindingLine === marker.line ? "active" : ""}`}
                            onClick={() => focusFindingsForLine(marker.line)}
                            title={`${marker.title}\n\nClick to filter findings for line ${String(marker.line)}.`}
                            type="button"
                          >
                            <strong>L{marker.line}</strong>
                            <span>{marker.summary}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <textarea
                  id="vast-xml"
                  ref={xmlTextareaRef}
                  className="annotated-textarea"
                  value={xmlDraft}
                  onChange={(event) => {
                    setActiveScenarioId(null);
                    setSourceMode("xml");
                    setXmlDraft(event.target.value);
                  }}
                  onFocus={() => setSourceMode("xml")}
                  onScroll={(event) => setEditorScrollTop(event.currentTarget.scrollTop)}
                  spellCheck={false}
                  wrap="off"
                />
              </div>

              {sourceMode === "xml" &&
              (editorAnnotationsStale || editorIssueMarkers.length > 0 || editorDocumentIssueCount > 0) ? (
                <div className="editor-status-row">
                  {editorIssueMarkers.length > 0 ? (
                    <span className="editor-status-note">
                      {editorIssueMarkers.length} inline marker{editorIssueMarkers.length === 1 ? "" : "s"} synced to the
                      last validated XML. Click one to filter findings.
                    </span>
                  ) : null}
                  {editorDocumentIssueCount > 0 ? (
                    <span className="editor-status-note">
                      {editorDocumentIssueCount} document-level finding{editorDocumentIssueCount === 1 ? "" : "s"} appear
                      only in the findings table.
                    </span>
                  ) : null}
                  {editorAnnotationsStale ? (
                    <span className="editor-status-note">
                      Markers reflect the previous run. Validate again to refresh them.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="action-row">
              <button className="primary" disabled={!canRun} onClick={() => runAction("validate")} type="button">
                Validate
              </button>
              <button className="secondary" disabled={!canRun} onClick={() => runAction("resolve")} type="button">
                Resolve wrappers
              </button>
              <button className="secondary" disabled={!canRun} onClick={() => runAction("fix")} type="button">
                Auto-fix
              </button>
              <button className="ghost" onClick={loadSample} type="button">
                Load sample
              </button>
              <button className="ghost" disabled={!lastFix} onClick={applyFixedXml} type="button">
                Apply fix and validate
              </button>
              <button
                className="ghost clear-button"
                disabled={!hasClearableInput}
                onClick={clearInputs}
                type="button"
              >
                Clear
              </button>
            </div>

            {runError || snapshot.error ? <div className="banner error">{runError ?? snapshot.error?.message}</div> : null}

            {suspectedBlockedFetch ? (
              <div className="banner error">
                The fetched response was not VAST XML (root element must be &lt;VAST&gt;). This request already retried
                through the server-side proxy, so either the URL doesn&apos;t point directly at a VAST tag (e.g. it
                returns VMAP, JSON, or an HTML page), or something is blocking both the direct and proxied fetch. Check
                your browser&apos;s network tab for the raw response to confirm.
              </div>
            ) : null}

            {lastFix ? (
              <div className="banner success">
                Applied {lastFix.applied.length} deterministic fix{lastFix.applied.length === 1 ? "" : "es"}. Remaining
                issues: {lastFix.remaining.length}.
              </div>
            ) : null}

            <div className="scenario-block">
              <button
                className="scenario-toggle"
                aria-expanded={scenarioLibraryOpen}
                onClick={() => setScenarioLibraryOpen((current) => !current)}
                type="button"
              >
                <span className={`panel-chevron${scenarioLibraryOpen ? " open" : ""}`} aria-hidden="true">
                  ▾
                </span>
                <strong>Scenario library</strong>
                <span className="scenario-toggle-note">
                  {activeScenario !== null
                    ? `Active: ${activeScenario.label}`
                    : `${String(SCENARIO_PRESETS.length)} presets across baseline, creative, measurement, and CTV coverage`}
                </span>
              </button>

              {scenarioLibraryOpen ? (
                <div className="scenario-body">
                  <div className="scenario-filter-grid">
                    <label className="scenario-filter">
                      <span>Version</span>
                      <select
                        value={scenarioVersionFilter}
                        onChange={(event) => setScenarioVersionFilter(event.target.value)}
                      >
                        <option value="all">All versions</option>
                        {scenarioVersionOptions.map((versionLabel) => (
                          <option key={versionLabel} value={versionLabel}>
                            {versionLabel}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="scenario-filter">
                      <span>Action</span>
                      <select
                        value={scenarioActionFilter}
                        onChange={(event) => setScenarioActionFilter(event.target.value as ScenarioActionFilter)}
                      >
                        <option value="all">All actions</option>
                        {scenarioActionOptions.map((action) => (
                          <option key={action} value={action}>
                            {ACTION_LABELS[action]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="scenario-filter">
                      <span>Surface</span>
                      <select
                        value={scenarioSurfaceFilter}
                        onChange={(event) => setScenarioSurfaceFilter(event.target.value)}
                      >
                        <option value="all">All surfaces</option>
                        {scenarioSurfaceOptions.map((surface) => (
                          <option key={surface} value={surface}>
                            {surface}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="ghost scenario-reset"
                      disabled={!hasScenarioFilters}
                      onClick={() => {
                        setScenarioVersionFilter("all");
                        setScenarioActionFilter("all");
                        setScenarioSurfaceFilter("all");
                      }}
                      type="button"
                    >
                      Reset
                    </button>
                  </div>

                  <p className="scenario-count">
                    Showing {String(filteredScenarioCount)} of {String(SCENARIO_PRESETS.length)} presets.{" "}
                    {activeScenario !== null && !activeScenarioMatchesFilters
                      ? `Active scenario "${activeScenario.label}" sits outside the current filters.`
                      : "Selecting one loads and runs it."}
                  </p>

                  <div className="scenario-groups">
                    {filteredScenarioGroups.map((group) => {
                      const isExpanded = expandedScenarioGroups[group.id] === true;
                      const visibleScenarios = isExpanded
                        ? group.scenarios
                        : group.scenarios.slice(0, SCENARIO_ROW_LIMIT);
                      const hiddenCount = group.scenarios.length - visibleScenarios.length;
                      return (
                        <section className="scenario-group" key={group.id}>
                          <div className="scenario-group-head">
                            <strong>{group.label}</strong>
                            <span>{group.description}</span>
                          </div>
                          <div className="scenario-list">
                            {visibleScenarios.map((scenario) => (
                              <button
                                key={scenario.id}
                                className={`scenario-row ${activeScenarioId === scenario.id ? "active" : ""}`}
                                onClick={() => runScenario(scenario)}
                                title={scenario.description}
                                type="button"
                              >
                                <span className="scenario-pill">{scenario.versionLabel}</span>
                                <span className="scenario-pill">
                                  {scenario.action === "resolve" ? "Resolve" : "Validate"}
                                </span>
                                <strong>{scenario.label}</strong>
                                <span className="scenario-row-description">{scenario.description}</span>
                                <span className="scenario-tag-row">
                                  {scenario.focusAreas.map((focusArea) => (
                                    <span className="scenario-chip" key={`${scenario.id}-${focusArea}`}>
                                      {focusArea}
                                    </span>
                                  ))}
                                </span>
                              </button>
                            ))}
                          </div>
                          {group.scenarios.length > SCENARIO_ROW_LIMIT ? (
                            <button
                              className="scenario-expand-toggle"
                              onClick={() =>
                                setExpandedScenarioGroups((current) => ({ ...current, [group.id]: !isExpanded }))
                              }
                              type="button"
                            >
                              {isExpanded ? "Show fewer" : `Show ${String(hiddenCount)} more`}
                            </button>
                          ) : null}
                        </section>
                      );
                    })}
                    {filteredScenarioCount === 0 ? (
                      <div className="scenario-empty">No presets match the current filters.</div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <Section
          id="findings"
          title="Findings"
          open={openSections.findings}
          onToggle={() => toggleSection("findings")}
          panelRef={findingsSectionRef}
          meta={
            <>
              {activeComplianceVerdict ? (
                <span className={`pill profile-${activeComplianceVerdict.status}`}>
                  {activeComplianceVerdict.label} {activeComplianceVerdict.status}
                </span>
              ) : null}
              <span className="badge">{displayedIssues.length}</span>
            </>
          }
        >
          <div className="lens-row" role="group" aria-label="Compliance lens">
            {complianceVerdicts.map((profile) => (
              <button
                className={`lens lens-${profile.status} ${profile.id === activeComplianceVerdict?.id ? "active" : ""}`}
                data-lens={profile.id}
                data-lens-status={profile.status}
                key={profile.id}
                onClick={() => setSelectedComplianceProfileId(profile.id)}
                type="button"
              >
                <span>{profile.label}</span>
                <span className={`pill profile-${profile.status}`}>{profile.status}</span>
              </button>
            ))}
          </div>

          {activeComplianceVerdict ? (
            <p className="lens-note">
              {activeComplianceVerdict.description} Severity overrides for this lens apply to the table below and to
              every copied or exported report.
            </p>
          ) : null}

          {activeComplianceVerdict && activeComplianceVerdict.reasons.length > 0 ? (
            <ul className="lens-reasons">
              {activeComplianceVerdict.reasons.map((reason) => (
                <li key={`${activeComplianceVerdict.id}-${reason}`}>{reason}</li>
              ))}
            </ul>
          ) : null}

          {selectedFindingLine !== null ? (
            <div className="findings-filter-row">
              <span className="findings-filter-note">Filtered to line {selectedFindingLine} from an editor marker.</span>
              <button className="ghost findings-clear" onClick={() => setSelectedFindingLine(null)} type="button">
                Show all findings
              </button>
            </div>
          ) : null}

          {displayedIssues.length === 0 ? (
            <EmptyState title="No findings for the current run" body="Run validate or resolve to populate rule output." />
          ) : (
            <div className="table-surface">
              <div className="table-head findings-columns">
                <span>Severity</span>
                <span>Rule</span>
                <span>Location</span>
                <span>Detail</span>
              </div>
              {displayedIssues.map((issue) => (
                <article
                  className={`table-row findings-columns severity-${issue.severity} ${selectedFindingLine !== null ? "findings-selected" : ""}`}
                  key={`${issue.id}-${issue.path ?? "document"}-${issue.line ?? 0}-${issue.col ?? 0}`}
                >
                  <div className="table-cell" data-label="Severity">
                    <span className="chip">{issue.severity}</span>
                  </div>
                  <strong className="table-cell" data-label="Rule">
                    <a
                      className="rule-link"
                      data-rule={issue.id}
                      href={ruleDocsUrl(issue.id)}
                      rel="noreferrer noopener"
                      target="_blank"
                      title={`Opens in a new tab: the ${issue.id} rule page on vastlint.org`}
                    >
                      {issue.id}
                      <ExternalGlyph />
                    </a>
                  </strong>
                  <span className="table-cell row-location" data-label="Location">
                    {issue.line !== null && canJumpToEditorLine ? (
                      <button
                        className="line-jump"
                        onClick={() => revealEditorLine(issue.line ?? 1)}
                        title={`Jump to line ${String(issue.line)} in the editor`}
                        type="button"
                      >
                        {formatIssueLocation(issue)}
                      </button>
                    ) : (
                      formatIssueLocation(issue)
                    )}
                  </span>
                  <div className="table-cell row-detail" data-label="Detail">
                    <p>{issue.message}</p>
                    <small>{issue.spec_ref}</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Section>

        <Section
          id="wrappers"
          title="Wrapper chain"
          open={openSections.wrappers}
          onToggle={() => toggleSection("wrappers")}
          meta={<span className="badge">{snapshot.wrapperChain.length}</span>}
        >
          {snapshot.wrapperChain.length === 0 ? (
            <EmptyState
              title="No wrapper data"
              body="Run resolve to inspect hop-by-hop fetch timing, validation counts, and metadata deltas."
            />
          ) : (
            <div className="hop-grid">
              {wrapperInspectors.map((hop) => (
                <article className={`hop-card hop-${hop.tone}`} key={hop.id}>
                  <div className="hop-topline">
                    <strong>
                      Hop {hop.hopIndex} · {hop.title}
                    </strong>
                    <span className={`pill hop-${hop.tone}`}>{hop.validationSummary}</span>
                  </div>
                  <p className="muted-copy">
                    {hop.adType} · {hop.adSystem} · {hop.duration}
                  </p>
                  <div className="pill-row">
                    {hop.stats.map((item) => (
                      <span className="pill muted" key={`${hop.id}-${item}`}>
                        {item}
                      </span>
                    ))}
                  </div>
                  <dl>
                    <div>
                      <dt>Source</dt>
                      <dd>
                        <UrlValue hint="Open this VAST document in a new tab" url={hop.sourceLabel} variant="text" />
                      </dd>
                    </div>
                    <div>
                      <dt>Next hop</dt>
                      <dd>
                        <UrlValue
                          fallback={hop.nextHopLabel}
                          hint="Open the next wrapper URI in a new tab"
                          url={hop.nextHopLabel}
                          variant="text"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Fetched</dt>
                      <dd>
                        {new Date(hop.fetchedAt).toLocaleTimeString()} · {hop.fetchMs} ms
                      </dd>
                    </div>
                  </dl>
                  <div className="compact-list hop-notes">
                    {hop.changes.map((note) => (
                      <span key={`${hop.id}-${note}`}>{note}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </Section>

        <Section
          id="resolved"
          title="Resolved ads and assets"
          open={openSections.resolved}
          onToggle={() => toggleSection("resolved")}
          meta={
            <>
              {assetAuditSummary.risk > 0 ? <span className="pill risk-risk">{assetAuditSummary.risk} high risk</span> : null}
              <span className="badge">{inventoryAds.length}</span>
            </>
          }
        >
          {inventoryAds.length === 0 ? (
            <EmptyState
              title="No resolved ads"
              body="Run resolve or prepare the runner to inspect the final ad pod and media inventory."
            />
          ) : (
            <>
              <div className="metric-strip">
                <Metric label="Assets" value={assetAuditSummary.total} accent="neutral" />
                <Metric label="Ready" value={assetAuditSummary.ready} accent={assetAuditSummary.ready > 0 ? "good" : "neutral"} />
                <Metric label="Review" value={assetAuditSummary.review} accent={assetAuditSummary.review > 0 ? "warning" : "neutral"} />
                <Metric label="High risk" value={assetAuditSummary.risk} accent={assetAuditSummary.risk > 0 ? "error" : "neutral"} />
              </div>

              <div className="table-surface asset-audit-table">
                <div className="table-head asset-columns">
                  <span>Asset</span>
                  <span>Format</span>
                  <span>Dimensions</span>
                  <span>Transport</span>
                  <span>Risk</span>
                  <span>Detail</span>
                </div>
                {assetAuditRows.map((row) => (
                  <article className={`table-row asset-columns asset-${row.riskLevel}`} key={row.id}>
                    <div className="table-cell row-detail compact" data-label="Asset">
                      <strong>{row.assetType}</strong>
                      <span>{row.adTitle}</span>
                    </div>
                    <span className="table-cell" data-label="Format">
                      {row.format}
                    </span>
                    <span className="table-cell" data-label="Dimensions">
                      {row.dimensions}
                    </span>
                    <span className="table-cell" data-label="Transport">
                      <span
                        className={`pill transport-${row.transport === "HTTP" ? "http" : row.transport === "HTTPS" ? "https" : "inline"}`}
                      >
                        {row.transport}
                      </span>
                    </span>
                    <span className="table-cell" data-label="Risk">
                      <span className={`pill risk-${row.riskLevel}`}>{row.riskLabel}</span>
                    </span>
                    <div className="table-cell row-detail compact" data-label="Detail">
                      <span>{row.detail}</span>
                      {row.url ? <UrlValue hint="Open this asset in a new tab" url={row.url} /> : null}
                    </div>
                  </article>
                ))}
              </div>

              <div className="subsection-heading">
                <strong>Ad cards</strong>
                <span>{inventoryAds.length} resolved</span>
              </div>

              <div className="resolved-grid">
                {inventoryAds.map((resolvedAd, index) => (
                  <ResolvedAdCard key={`${resolvedAd.adPod.adId ?? "ad"}-${index}`} index={index} resolvedAd={resolvedAd} />
                ))}
              </div>
            </>
          )}
        </Section>

        <Section
          id="playback"
          title="Playback console"
          open={openSections.playback}
          onToggle={() => toggleSection("playback")}
          meta={<span className="tag">{runnerSnapshot.status}</span>}
        >
          <div className="metric-strip">
            <Metric label="Status" value={runnerSnapshot.status} accent={runnerSnapshot.status === "error" ? "error" : runnerSnapshot.status === "playing" ? "good" : "neutral"} />
            <Metric label="Media" value={runnerSnapshot.mediaSelection.selected?.mimeType ?? "none"} accent="neutral" />
            <Metric
              label="Clock"
              value={`${formatClock(runnerSnapshot.currentTimeSec)} / ${formatClock(runnerSnapshot.durationSec)}`}
              accent="neutral"
            />
            <Metric label="Viewability" value={runnerSnapshot.viewability ?? "not set"} accent="neutral" />
          </div>

          <div className="runner-toolbar">
            <button className="secondary" onClick={() => void preparePlaybackRunner()} type="button">
              Prepare runner
            </button>
            <button className="ghost" disabled={!runnerMediaUrl} onClick={() => void toggleRunnerMute()} type="button">
              {runnerSnapshot.muted ? "Unmute" : "Mute"}
            </button>
            <button
              className="ghost"
              disabled={!runnerSnapshot.clickThroughUrl}
              onClick={() => void triggerRunnerClick()}
              type="button"
            >
              Track click
            </button>
            <button className="ghost" disabled={!runnerSnapshot.resolvedAd} onClick={() => void skipPlayback()} type="button">
              Skip ad
            </button>
            <button
              className="ghost"
              disabled={!runnerSnapshot.resolvedAd}
              onClick={() => void signalRunnerError()}
              type="button"
            >
              Signal error
            </button>
            <button
              className="ghost"
              disabled={!runnerSnapshot.resolvedAd}
              onClick={() => void setPlaybackViewability("viewable")}
              type="button"
            >
              Viewable
            </button>
            <button
              className="ghost"
              disabled={!runnerSnapshot.resolvedAd}
              onClick={() => void setPlaybackViewability("notViewable")}
              type="button"
            >
              Not viewable
            </button>
            <button
              className="ghost"
              disabled={!runnerSnapshot.resolvedAd}
              onClick={() => void setPlaybackViewability("viewUndetermined")}
              type="button"
            >
              Undetermined
            </button>
          </div>

          {runnerSnapshot.error ? <div className="banner error">{runnerSnapshot.error}</div> : null}

          <div className="playback-shell">
            <div className="runner-stage">
              {runnerMediaUrl ? (
                <div className="runner-video-frame">
                  <video
                    ref={runnerVideoRef}
                    className="runner-video"
                    controls
                    crossOrigin="anonymous"
                    onEnded={() => void handleRunnerEnded()}
                    onLoadedMetadata={() =>
                      appendRunnerTimeline("media", "video:metadata", "Loaded media metadata into the playback runner.")
                    }
                    onPause={() => void handleRunnerPause()}
                    onPlay={() => void handleRunnerPlay()}
                    onTimeUpdate={() => void handleRunnerTimeUpdate()}
                    onVolumeChange={() => void syncRunnerMuted()}
                    src={runnerMediaUrl}
                  />
                </div>
              ) : (
                <EmptyState
                  title="Runner not prepared"
                  body="Prepare the runner to resolve a playable media file and load it into the console."
                />
              )}

              <dl className="summary-list compact-list">
                <div>
                  <dt>Resolved ad</dt>
                  <dd>{runnerSnapshot.resolvedAd?.adTitle || "none"}</dd>
                </div>
                <div>
                  <dt>Click-through</dt>
                  <dd className="truncate-url">
                    <UrlValue
                      hint="Open the landing page in a new tab"
                      url={runnerSnapshot.clickThroughUrl}
                      variant="text"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Media file</dt>
                  <dd className="truncate-url">
                    <UrlValue
                      hint="Open the selected media file in a new tab"
                      url={runnerSnapshot.mediaSelection.selected?.url}
                      variant="text"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Milestones</dt>
                  <dd>
                    {Object.entries(runnerSnapshot.milestones)
                      .filter(([, reached]) => reached)
                      .map(([milestone]) => milestone)
                      .join(", ") || "none"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="timeline-panel">
              <div className="timeline-header">
                <strong>Runner timeline</strong>
                <span>{timelineEntries.length} entries</span>
              </div>
              {timelineEntries.length === 0 ? (
                <div className="timeline-empty">
                  Prepare the runner and interact with the media element to populate playback events.
                </div>
              ) : (
                <div className="timeline-list">
                  {timelineEntries.map((entry) => (
                    <article className={`timeline-item kind-${entry.kind}`} key={entry.id}>
                      <div className="timeline-topline">
                        <strong>{entry.title}</strong>
                        <span>{new Date(entry.at).toLocaleTimeString()}</span>
                      </div>
                      <p>{entry.detail}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Section>

        <Section
          id="tracking"
          title="Tracking waterfall"
          open={openSections.tracking}
          onToggle={() => toggleSection("tracking")}
          meta={
            <>
              {waterfallSummary.failed > 0 ? <span className="pill status-failed">{waterfallSummary.failed} failed</span> : null}
              <span className="badge">{waterfallSummary.total}</span>
            </>
          }
        >
          <div className="metric-strip">
            <Metric label="Targets" value={waterfallSummary.total} accent="neutral" />
            <Metric label="Succeeded" value={waterfallSummary.ok} accent={waterfallSummary.ok > 0 ? "good" : "neutral"} />
            <Metric label="Failed" value={waterfallSummary.failed} accent={waterfallSummary.failed > 0 ? "error" : "neutral"} />
            <Metric label="Pending" value={waterfallSummary.pending} accent={waterfallSummary.pending > 0 ? "warning" : "neutral"} />
            <Metric label="Linked only" value={waterfallSummary.linked} accent="neutral" />
          </div>

          {trackingWaterfallRows.length === 0 ? (
            <EmptyState
              title="No tracking targets resolved"
              body="Prepare the runner to inspect the full tracking plan and dispatch history."
            />
          ) : (
            <div className="table-surface waterfall-table">
              <div className="table-head waterfall-columns">
                <span>Event</span>
                <span>Status</span>
                <span>Expanded URL</span>
                <span>Detail</span>
              </div>
              {trackingWaterfallRows.map((row) => (
                <article className={`table-row waterfall-columns waterfall-${row.status}`} key={row.id}>
                  <div className="table-cell" data-label="Event">
                    <strong>{row.event}</strong>
                    <span className="pill muted waterfall-kind">{row.kind}</span>
                  </div>
                  <div className="table-cell" data-label="Status">
                    <span className={`pill status-${row.status}`}>{row.status}</span>
                  </div>
                  <div className="table-cell row-detail compact" data-label="Expanded URL">
                    <UrlValue hint="Opens in a new tab and fires this beacon for real" url={row.expandedUrl} />
                  </div>
                  <div className="table-cell row-detail compact" data-label="Detail">
                    <strong>{row.originalUrl}</strong>
                    <span>
                      Hop {row.hopIndex}
                      {row.offset ? ` · offset ${row.offset}` : ""}
                    </span>
                    <span>{row.dispatchCount > 0 ? `${String(row.dispatchCount)} dispatch(es)` : "Not dispatched yet"}</span>
                    {row.lastDispatchedAt ? <span>{new Date(row.lastDispatchedAt).toLocaleTimeString()}</span> : null}
                    {row.httpStatus !== null ? <span>HTTP {row.httpStatus}</span> : null}
                    {row.error ? <span>{row.error}</span> : null}
                    {row.sourceUrl ? <UrlValue hint="Open the hop this tracker came from" url={row.sourceUrl} /> : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </Section>

        <Section
          id="runtime"
          title="Runtime and verification"
          open={openSections.runtime}
          onToggle={() => toggleSection("runtime")}
          meta={
            <span className="tag">
              {runtimeInspection.omidCount} OMID · {runtimeInspection.vpaidCount} VPAID
            </span>
          }
        >
          <div className="metric-strip">
            <Metric label="OMID resources" value={runtimeInspection.omidCount} accent={runtimeInspection.omidCount > 0 ? "good" : "neutral"} />
            <Metric label="VPAID markers" value={runtimeInspection.vpaidCount} accent={runtimeInspection.vpaidCount > 0 ? "warning" : "neutral"} />
            <Metric label="Companions" value={runtimeInspection.companions.length} accent="neutral" />
            <Metric label="Icons" value={runtimeInspection.icons.length} accent="neutral" />
          </div>

          <div className="runtime-chip-row">
            {runtimeInspection.apiFrameworks.length > 0 ? (
              runtimeInspection.apiFrameworks.map((framework) => (
                <span className="runtime-chip" key={framework}>
                  {framework}
                </span>
              ))
            ) : (
              <span className="runtime-chip muted-chip">No apiFramework markers detected</span>
            )}
          </div>

          {runtimeInspection.verificationResources.length > 0 ? (
            <div className="table-surface runtime-table">
              <div className="table-head verification-columns">
                <span>Vendor</span>
                <span>Framework</span>
                <span>Resource</span>
              </div>
              {runtimeInspection.verificationResources.map((resource) => (
                <article className="table-row verification-columns" key={resource.id}>
                  <strong className="table-cell" data-label="Vendor">
                    {resource.vendor}
                  </strong>
                  <span className="table-cell" data-label="Framework">
                    {resource.apiFramework ?? resource.kind}
                  </span>
                  <div className="table-cell row-detail compact" data-label="Resource">
                    <strong>{resource.adTitle}</strong>
                    <UrlValue hint="Open this verification resource in a new tab" url={resource.url} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No verification resources detected"
              body="Load a tag with AdVerifications to inspect OM SDK and other verification payloads."
            />
          )}

          {runtimeInspection.companions.length > 0 || runtimeInspection.icons.length > 0 ? (
            <div className="preview-grid">
              {runtimeInspection.companions.map((companion) => (
                <CreativePreviewCard key={companion.id} item={companion} label="Companion" />
              ))}
              {runtimeInspection.icons.map((icon) => (
                <CreativePreviewCard key={icon.id} item={icon} label="Icon" />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No companion or icon assets detected"
              body="Load a tag with creative resources to inspect companion rendering surfaces."
            />
          )}
        </Section>

        <Section
          id="macros"
          title="Macro debugger"
          open={openSections.macros}
          onToggle={() => toggleSection("macros")}
          meta={<span className="tag">{activeMacroPreset?.label ?? "custom"}</span>}
        >
          <div className="macro-toolbar">
            <label className="macro-picker">
              <span>Preset</span>
              <select onChange={(event) => applyMacroPreset(event.target.value)} value={selectedMacroPresetId}>
                {macroPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary" onClick={() => applyMacroPreset(selectedMacroPresetId)} type="button">
              Reload preset
            </button>
            <button className="ghost" onClick={() => addMacroEntry()} type="button">
              Add macro
            </button>
          </div>

          <p className="muted-copy">
            {activeMacroPreset?.description ?? "Custom macro values."} The active set is also used when you trigger an
            error beacon from the runner.
          </p>

          <div className="macro-editor">
            {macroEntries.map((entry) => (
              <div className="macro-row" key={entry.id}>
                <input
                  aria-label="Macro key"
                  onChange={(event) => updateMacroEntry(entry.id, "key", event.target.value)}
                  placeholder="MACRO_NAME"
                  type="text"
                  value={entry.key}
                />
                <input
                  aria-label="Macro value"
                  onChange={(event) => updateMacroEntry(entry.id, "value", event.target.value)}
                  placeholder="Macro value"
                  type="text"
                  value={entry.value}
                />
                <button className="ghost" onClick={() => removeMacroEntry(entry.id)} type="button">
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="macro-preview-panel timeline-panel">
            <div className="timeline-header">
              <strong>Expanded URL preview</strong>
              <span>{macroPreviewRows.length} rows</span>
            </div>
            {macroPreviewRows.length === 0 ? (
              <div className="timeline-empty">
                Prepare the runner to preview how the active macro set expands tracking URLs.
              </div>
            ) : (
              <div className="macro-preview-list">
                {macroPreviewRows.map((row) => (
                  <article className="timeline-item" key={`macro-preview-${row.id}`}>
                    <div className="timeline-topline">
                      <strong>{row.event}</strong>
                      <span>{row.status}</span>
                    </div>
                    <p>{row.originalUrl}</p>
                    <UrlValue hint="Opens in a new tab and fires this beacon for real" url={row.expandedUrl} />
                  </article>
                ))}
              </div>
            )}
          </div>
        </Section>

        <Section
          id="export"
          title="Share and export"
          open={openSections.export}
          onToggle={() => toggleSection("export")}
          meta={<span className="tag">{activeComplianceVerdict?.label ?? "no lens"}</span>}
        >
          <div className="action-row">
            <button className="secondary" onClick={() => void copyShareLink()} type="button">
              Copy share link
            </button>
            <button className="secondary" onClick={() => void copyReportSummary()} type="button">
              Copy summary
            </button>
            <button className="secondary" onClick={() => void copyErrorFindings()} type="button">
              Copy errors
            </button>
            <button className="ghost" onClick={() => downloadReport("txt")} type="button">
              Download text
            </button>
            <button className="ghost" onClick={() => downloadReport("json")} type="button">
              Download JSON
            </button>
            <button className="ghost" onClick={() => void downloadArtifactBundle()} type="button">
              Download bundle
            </button>
          </div>

          {reportNotice ? <div className="banner success">{reportNotice}</div> : null}

          <pre className="report-preview">{reportSummary}</pre>
        </Section>
      </main>

      <footer className="app-footer">
        <p>
          Validation, repair, and wrapper resolution run on{" "}
          <a href="https://vastlint.org" rel="noreferrer" target="_blank">
            vastlint
          </a>
          , an open-source VAST validation engine with rules derived from published IAB Tech Lab specs and XSD schemas.
          This tester is an independent frontend for that engine, not an official IAB Tech Lab tool. See{" "}
          <a href="https://vastlint.org" rel="noreferrer" target="_blank">
            vastlint.org
          </a>{" "}
          for the hosted validator, CLI, and native Go, Rust, Python, and npm packages. Found a wrong result or want a
          new rule? <a href="https://github.com/aleksUIX/vastlint/issues/new" rel="noreferrer noopener" target="_blank">
            Report an issue
          </a>{" "}
          or{" "}
          <a href="https://github.com/aleksUIX/vastlint/discussions" rel="noreferrer noopener" target="_blank">
            start a discussion
          </a>{" "}
          on the vastlint GitHub repo.
        </p>
      </footer>
    </div>
  );
}

function Section({
  id,
  title,
  meta,
  open,
  onToggle,
  panelRef,
  children,
}: {
  id: SectionId;
  title: string;
  meta?: ReactNode;
  open: boolean;
  onToggle: () => void;
  panelRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <section className={`panel${open ? " is-open" : ""}`} data-section={id} data-open={open} ref={panelRef}>
      <button className="panel-head" aria-expanded={open} onClick={onToggle} type="button">
        <span className={`panel-chevron${open ? " open" : ""}`} aria-hidden="true">
          ▾
        </span>
        <h2>{title}</h2>
        <span className="panel-meta">{meta}</span>
      </button>
      {open ? <div className="panel-body">{children}</div> : null}
    </section>
  );
}

function Metric({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div className={`metric accent-${accent}`} data-metric={label.toLowerCase().replace(/\s+/g, "-")}>
      <span>{label}</span>
      <strong data-metric-value={String(value)}>{value}</strong>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function CreativePreviewCard({ item, label }: { item: RuntimeCreativePreview; label: string }) {
  return (
    <article className="preview-card">
      <div className="preview-header">
        <div>
          <span className="section-label">{label}</span>
          <h3>{item.adTitle}</h3>
        </div>
        <span className="runtime-chip muted-chip">{item.title}</span>
      </div>

      <div className="preview-frame">
        {item.resource ? <RenderableCreativeResource resource={item.resource} title={`${label} preview`} /> : <div className="preview-empty">No previewable resource.</div>}
      </div>

      <dl className="summary-list compact-list">
        <div>
          <dt>Resource kind</dt>
          <dd>{item.resource?.kind ?? "none"}</dd>
        </div>
        <div>
          <dt>Creative type</dt>
          <dd>{item.resource?.creativeType ?? "n/a"}</dd>
        </div>
        <div>
          <dt>Click-through</dt>
          <dd className="truncate-url">
            <UrlValue hint="Open the landing page in a new tab" url={item.clickThroughUrl} variant="text" />
          </dd>
        </div>
      </dl>
    </article>
  );
}

function RenderableCreativeResource({ resource, title }: { resource: VastCreativeResource; title: string }) {
  if (resource.kind === "static" && resource.creativeType?.startsWith("image/")) {
    return <img alt={title} className="preview-image" src={resource.content} />;
  }

  if (resource.kind === "html") {
    return <iframe className="preview-iframe" sandbox="allow-same-origin" srcDoc={resource.content} title={title} />;
  }

  if (resource.kind === "iframe") {
    return <iframe className="preview-iframe" sandbox="allow-same-origin allow-scripts" src={resource.content} title={title} />;
  }

  return <code className="preview-code">{resource.content}</code>;
}

function ResolvedAdCard({ index, resolvedAd }: { index: number; resolvedAd: VastResolvedAd }) {
  return (
    <article className="resolved-card">
      <div className="resolved-header">
        <div>
          <span className="section-label">Ad {index + 1}</span>
          <h3>{resolvedAd.adTitle || resolvedAd.adPod.adId || "Untitled ad"}</h3>
        </div>
        <span className={`pill ${resolvedAd.resolved ? "good" : "muted"}`}>{resolvedAd.resolved ? "resolved" : "partial"}</span>
      </div>

      <dl className="summary-list compact-list">
        <div>
          <dt>Type</dt>
          <dd>{resolvedAd.adType}</dd>
        </div>
        <div>
          <dt>System</dt>
          <dd>{resolvedAd.adSystem || "unknown"}</dd>
        </div>
        <div>
          <dt>Sequence</dt>
          <dd>{resolvedAd.adPod.sequence ?? "n/a"}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{resolvedAd.duration || "n/a"}</dd>
        </div>
        <div>
          <dt>Media files</dt>
          <dd>{resolvedAd.mediaFiles.length}</dd>
        </div>
        <div>
          <dt>Tracking targets</dt>
          <dd>{resolvedAd.trackingPlan.events.length + resolvedAd.trackingPlan.impressions.length}</dd>
        </div>
      </dl>

      <div className="media-list">
        {resolvedAd.mediaFiles.length === 0 ? (
          <p className="muted-copy">No media files resolved.</p>
        ) : (
          resolvedAd.mediaFiles.map((mediaFile) => (
            <div className="media-item" key={`${mediaFile.url}-${mediaFile.mimeType}`}>
              <strong>{mediaFile.mimeType}</strong>
              <span>{mediaFile.width} x {mediaFile.height}</span>
              <span>{mediaFile.delivery}</span>
              <UrlValue hint="Open this media file in a new tab" url={mediaFile.url} />
            </div>
          ))
        )}
      </div>
    </article>
  );
}

export default App;