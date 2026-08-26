import type {
  OverlaySurface,
  SimidDimensions,
  SimidHandshakeStep,
  SimidInspectFinding,
  SimidInspectReport,
  SimidLogEntry,
} from "./types";

export type SimidHealthStatus = "idle" | "waiting" | "held" | "healthy" | "incomplete" | "stopped" | "failed";

export interface SimidHeal {
  id: string;
  severity: "fail" | "warning" | "info";
  title: string;
  fix: string;
}

export interface SimidCoverageItem {
  type: string;
  side: "in" | "out";
  seen: boolean;
}

export interface SimidHealthFact {
  label: string;
  value: string;
}

export interface SimidHealthReport {
  status: SimidHealthStatus;
  headline: string;
  facts: SimidHealthFact[];
  heals: SimidHeal[];
  coverage: SimidCoverageItem[];
  trackingUrls: string[];
  handshake: {
    createSession: boolean;
    init: boolean;
    startCreative: boolean;
  };
}

export interface SimidHealthInput {
  step: SimidHandshakeStep;
  log: SimidLogEntry[];
  surface: OverlaySurface;
  inspect: SimidInspectReport | null;
  sessionId: string | null;
  iframeLoaded: boolean;
  autoStart: boolean;
  clickThroughUrl: string | null;
  skipOffsetSec: number;
  skipLeft: number;
  muted: boolean;
  creativeSize: SimidDimensions | null;
  creativeUrl: string | null;
  urlSwapped: boolean;
}

const COVERAGE: { type: string; side: "in" | "out"; aliases?: string[] }[] = [
  { type: "createSession", side: "in" },
  { type: "SIMID:Player:init", side: "out" },
  { type: "SIMID:Player:startCreative", side: "out" },
  { type: "SIMID:Player:resize", side: "out" },
  { type: "SIMID:Creative:getMediaState", side: "in" },
  { type: "SIMID:Creative:requestPause", side: "in" },
  { type: "SIMID:Creative:requestPlay", side: "in" },
  { type: "SIMID:Creative:requestSkip", side: "in" },
  { type: "SIMID:Creative:requestStop", side: "in" },
  { type: "SIMID:Creative:clickThru", side: "in", aliases: ["SIMID:Creative:clickThrough", "SIMID:Creative:requestNavigation"] },
  { type: "SIMID:Creative:reportTracking", side: "in" },
  { type: "SIMID:Creative:requestChangeVolume", side: "in", aliases: ["SIMID:Creative:requestVolume"] },
  { type: "SIMID:Creative:requestFullScreen", side: "in", aliases: ["SIMID:Creative:requestFullscreen"] },
  { type: "SIMID:Creative:requestResize", side: "in", aliases: ["SIMID:Creative:expandNonlinear", "SIMID:Creative:collapseNonlinear"] },
  { type: "SIMID:Creative:requestChangeAdDuration", side: "in" },
  { type: "SIMID:Player:adSkipped", side: "out" },
  { type: "SIMID:Player:adStopped", side: "out" },
  { type: "SIMID:Player:fatalError", side: "out" },
];

function logHas(log: SimidLogEntry[], type: string, aliases: string[] = []): boolean {
  const names = new Set([type, ...aliases]);
  return log.some((entry) => names.has(entry.type));
}

function inspectFinding(inspect: SimidInspectReport | null, id: string): SimidInspectFinding | undefined {
  return inspect?.findings.find((finding) => finding.id === id);
}

function shortUrl(url: string | null | undefined): string {
  if (!url) {
    return "missing";
  }
  return url.length > 72 ? `${url.slice(0, 69)}...` : url;
}

function mixedContentRisk(url: string | null): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") {
      return false;
    }
    const host = parsed.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")) {
      return false;
    }
    if (typeof globalThis.location === "object" && globalThis.location.protocol === "http:") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function trackingUrlsFromLog(log: SimidLogEntry[]): string[] {
  const found: string[] = [];
  for (const entry of log) {
    if (!entry.type.includes("reportTracking")) {
      continue;
    }
    const matches = entry.detail.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    for (const url of matches) {
      if (!found.includes(url)) {
        found.push(url);
      }
    }
  }
  return found;
}

function pushHeal(heals: SimidHeal[], heal: SimidHeal) {
  if (!heals.some((item) => item.id === heal.id)) {
    heals.push(heal);
  }
}

export function diagnoseSimidSession(input: SimidHealthInput): SimidHealthReport {
  const createSession = logHas(input.log, "createSession");
  const init = logHas(input.log, "SIMID:Player:init");
  const startCreative = logHas(input.log, "SIMID:Player:startCreative");
  const heals: SimidHeal[] = [];
  const clickThrough = input.clickThroughUrl || input.surface.clickThroughUrl;
  const trackingUrls = trackingUrlsFromLog(input.log);
  const xfo = inspectFinding(input.inspect, "SIMID-inspect-xfo");
  const csp = inspectFinding(input.inspect, "SIMID-inspect-csp");
  const mixed = inspectFinding(input.inspect, "SIMID-inspect-mixed-content");
  const vpaid = inspectFinding(input.inspect, "SIMID-inspect-vpaid-leftover");
  const jsBody = inspectFinding(input.inspect, "SIMID-inspect-javascript-body");
  const noCreateSessionScan = inspectFinding(input.inspect, "SIMID-inspect-create-session");
  const noInitScan = inspectFinding(input.inspect, "SIMID-inspect-init");
  const envShape = inspectFinding(input.inspect, "SIMID-inspect-environment-shape");
  const skipRejected = input.log.some((entry) => /Skip not allowed/i.test(entry.detail));
  const durationRejected = input.log.some((entry) => entry.detail.includes("variableDuration is not allowed"));
  const unsupported = input.log.find((entry) => entry.detail.includes("Unsupported message"));
  const clickThruEmpty = input.log.some(
    (entry) => entry.type.includes("clickThru") && /no click-through URL/i.test(entry.detail),
  );
  const handshakeFailed = input.step === "failed" && !createSession;

  if (vpaid) {
    pushHeal(heals, {
      id: "vpaid",
      severity: "fail",
      title: "This file is VPAID, not SIMID",
      fix: "Point InteractiveCreativeFile at HTML that posts createSession. A SIMID player will not call getVPAIDAd.",
    });
  }

  if (jsBody) {
    pushHeal(heals, {
      id: "js-body",
      severity: "fail",
      title: "Creative URL returned JavaScript",
      fix: "ICF must be text/html. Serve the SIMID page, not the .js library, as InteractiveCreativeFile.",
    });
  }

  if (mixedContentRisk(input.creativeUrl)) {
    pushHeal(heals, {
      id: "http-url",
      severity: "fail",
      title: "Creative URL is http",
      fix: "Serve the HTML over https. An https player will blank an http iframe as mixed content. Localhost http on an http tester is fine.",
    });
  }

  if (xfo) {
    pushHeal(heals, {
      id: "xfo",
      severity: "fail",
      title: "X-Frame-Options will block the player iframe",
      fix: "Ask the creative CDN to drop DENY/SAMEORIGIN, or set CSP frame-ancestors to include the publisher and this tester origin.",
    });
  }

  if (csp) {
    pushHeal(heals, {
      id: "csp",
      severity: "fail",
      title: "CSP frame-ancestors none blocks the iframe",
      fix: "Allow the player origin in frame-ancestors. none paints a blank overlay with no handshake.",
    });
  }

  if (mixed) {
    pushHeal(heals, {
      id: "mixed",
      severity: "fail",
      title: "HTML pulls an http subresource",
      fix: "Rewrite script/img/src to https. Mixed content blanks the creative inside an https player.",
    });
  }

  if (!input.surface.url) {
    pushHeal(heals, {
      id: "missing-icf",
      severity: "fail",
      title: "VAST has no SIMID HTML URL",
      fix: "Add InteractiveCreativeFile with apiFramework SIMID and a text/html URL.",
    });
  }

  if (handshakeFailed) {
    if (input.iframeLoaded && noCreateSessionScan) {
      pushHeal(heals, {
        id: "no-create-session",
        severity: "fail",
        title: "Iframe loaded, creative never called createSession",
        fix: "On load, construct SimidProtocol and post createSession to the parent. Do not wait for a click.",
      });
    } else if (input.iframeLoaded) {
      pushHeal(heals, {
        id: "silent-iframe",
        severity: "fail",
        title: "Iframe loaded, no createSession reached this player",
        fix: "Post to window.parent, not self. Session ids must be strings. Compare with the protocol explorer fixture.",
      });
    } else if (input.inspect?.corsBlocked) {
      pushHeal(heals, {
        id: "blank-cors",
        severity: "fail",
        title: "No handshake, and inspect cannot read CDN headers",
        fix: "If the stage is blank, ask the host for X-Frame-Options and CSP frame-ancestors. CORS on GET does not block a working iframe.",
      });
    } else {
      pushHeal(heals, {
        id: "timeout",
        severity: "fail",
        title: "Timed out waiting for createSession",
        fix: "Confirm the ICF URL loads as HTML in a new tab, then that it posts createSession within a few seconds of iframe load.",
      });
    }
  }

  if (input.step === "failed" && createSession) {
    pushHeal(heals, {
      id: "fatal",
      severity: "fail",
      title: "Session ended with a fatal error",
      fix: "Read the last fatalError / operator fatal in the log. Reload the creative after the fix.",
    });
  }

  if (input.step === "ready" && !input.autoStart) {
    pushHeal(heals, {
      id: "held",
      severity: "info",
      title: "Handshake is ready, overlay is still dark",
      fix: "Click Start creative. Many live players send startCreative only after the ad starts.",
    });
  }

  if (skipRejected) {
    pushHeal(heals, {
      id: "skipoffset",
      severity: "warning",
      title: "Skip was rejected by skipoffset",
      fix: `Wait ${String(input.skipOffsetSec)}s after startCreative, or raise Linear skipoffset in the VAST. Creatives should hide Skip until the player resolves requestSkip.`,
    });
  }

  if (durationRejected) {
    pushHeal(heals, {
      id: "variable-duration",
      severity: "warning",
      title: "Duration change rejected",
      fix: "Set InteractiveCreativeFile variableDuration=true if the creative extends or shortens the ad.",
    });
  }

  if (clickThruEmpty || (logHas(input.log, "SIMID:Creative:clickThru", ["SIMID:Creative:clickThrough"]) && !clickThrough)) {
    pushHeal(heals, {
      id: "clickthrough",
      severity: "warning",
      title: "clickThru has no URL",
      fix: "Add VideoClicks/ClickThrough or NonLinearClickThrough. This player also reads clickThruUrl from init creativeData.",
    });
  } else if (!clickThrough && input.step !== "idle") {
    pushHeal(heals, {
      id: "vast-clickthrough",
      severity: "info",
      title: "VAST has no ClickThrough",
      fix: "Ad ops: add a click URL on the linear or nonlinear creative, or the overlay cannot open a landing page when playerHandles is true.",
    });
  }

  if (unsupported) {
    pushHeal(heals, {
      id: "unsupported",
      severity: "warning",
      title: "Player rejected an unknown message",
      fix: `${unsupported.detail} Stick to SIMID 1.1 creative methods, or the publisher player will drop them too.`,
    });
  }

  if (noInitScan && (handshakeFailed || input.step === "waiting-session")) {
    pushHeal(heals, {
      id: "no-init-handler",
      severity: "warning",
      title: "No SIMID:Player:init handler string in the HTML/scripts",
      fix: "The creative must resolve init. This player sends environmentData and creativeData (clickThruUrl + clickThroughUrl).",
    });
  }

  if (envShape) {
    pushHeal(heals, {
      id: "env-shape",
      severity: "warning",
      title: "Creative may read the wrong init shape",
      fix: "SIMID 1.1 init args are environmentData and creativeData, not environment. Mismatched field names look like a dead overlay after handshake.",
    });
  }

  if (input.inspect?.corsBlocked && (input.step === "started" || input.step === "ready")) {
    pushHeal(heals, {
      id: "cors-ok",
      severity: "info",
      title: "Inspect GET is CORS-blocked; the iframe still ran",
      fix: "Ignore fetch-header fails for live CDNs. Use this handshake log as proof. Ask the CDN for headers only if the iframe itself is blank.",
    });
  }

  if (input.step === "started" && input.muted) {
    pushHeal(heals, {
      id: "muted",
      severity: "info",
      title: "Host starts muted",
      fix: "Autoplay policy. Unmute from the transport under the stage, not from native video controls.",
    });
  }

  if (trackingUrls.length > 0) {
    pushHeal(heals, {
      id: "tracking",
      severity: "info",
      title: `${String(trackingUrls.length)} reportTracking URL${trackingUrls.length === 1 ? "" : "s"} logged, not fetched`,
      fix: "Confirm pixels in Charles or the ad server. This tester will not fire partner URLs.",
    });
  }

  const failHeals = heals.some((heal) => heal.severity === "fail");
  let status: SimidHealthStatus = "idle";
  let headline = "No SIMID session yet.";

  if (input.step === "waiting-session" || input.step === "init") {
    status = "waiting";
    headline = "Waiting for createSession.";
  }
  if (input.step === "ready") {
    status = "held";
    headline = "Handshake ready. Start creative to paint the overlay.";
  }
  if (input.step === "started") {
    status = failHeals ? "incomplete" : "healthy";
    headline = failHeals ? "Handshake ran, with issues to heal." : "Handshake complete.";
  }
  if (input.step === "stopped") {
    status = "stopped";
    headline = "Session ended.";
  }
  if (input.step === "failed") {
    status = "failed";
    headline = heals.find((heal) => heal.severity === "fail")?.title ?? "Handshake failed.";
  }

  const skipLabel =
    input.step === "started" && input.skipLeft > 0
      ? `${String(input.skipOffsetSec)}s (${input.skipLeft.toFixed(0)}s left)`
      : `${String(input.skipOffsetSec)}s`;

  const facts: SimidHealthFact[] = [
    { label: "Step", value: input.step.replace("-", " ") },
    { label: "Session", value: input.sessionId ?? "none" },
    { label: "Creative", value: shortUrl(input.creativeUrl) },
    { label: "apiFramework", value: input.surface.apiFramework ?? "missing" },
    { label: "skipoffset", value: skipLabel },
    { label: "variableDuration", value: input.surface.variableDuration ?? "unset" },
    { label: "ClickThrough", value: shortUrl(clickThrough) },
    { label: "Muted", value: input.muted ? "yes" : "no" },
  ];

  if (input.surface.adParameters) {
    facts.push({
      label: "AdParameters",
      value:
        input.surface.adParameters.length > 48
          ? `${input.surface.adParameters.slice(0, 45)}...`
          : input.surface.adParameters,
    });
  }

  if (input.creativeSize) {
    facts.push({
      label: "Creative size",
      value: `${String(input.creativeSize.width)}x${String(input.creativeSize.height)} at ${String(input.creativeSize.x)},${String(input.creativeSize.y)}`,
    });
  }

  if (input.urlSwapped) {
    facts.push({ label: "URL", value: "swapped over VAST ICF" });
  }

  return {
    status,
    headline,
    facts,
    heals,
    coverage: COVERAGE.map((item) => ({
      type: item.type,
      side: item.side,
      seen: logHas(input.log, item.type, item.aliases),
    })),
    trackingUrls,
    handshake: { createSession, init, startCreative },
  };
}

export function formatSimidDiagnosis(report: SimidHealthReport): string {
  const lines = [report.headline, ""];
  for (const fact of report.facts) {
    lines.push(`${fact.label}: ${fact.value}`);
  }
  if (report.heals.length > 0) {
    lines.push("", "Heals");
    for (const heal of report.heals) {
      lines.push(`- ${heal.title}: ${heal.fix}`);
    }
  }
  if (report.trackingUrls.length > 0) {
    lines.push("", "Tracking URLs (logged, not fetched)");
    for (const url of report.trackingUrls) {
      lines.push(`- ${url}`);
    }
  }
  lines.push("", "Coverage");
  for (const item of report.coverage) {
    lines.push(`- ${item.seen ? "seen" : "not seen"} ${item.type}`);
  }
  return lines.join("\n");
}

export function formatSimidLogText(log: SimidLogEntry[]): string {
  return [...log]
    .reverse()
    .map((entry) => {
      const body = entry.payload && entry.payload.length > 0 ? entry.payload : entry.detail;
      return `${entry.at} ${entry.direction} ${entry.type} ${body}`.trim();
    })
    .join("\n");
}

export function formatSimidSessionJson(input: {
  report: SimidHealthReport;
  log: SimidLogEntry[];
  inspect: SimidInspectReport | null;
  lastInit: Record<string, unknown> | null;
  surface: OverlaySurface;
  creativeUrl: string | null;
}): string {
  return JSON.stringify(
    {
      at: new Date().toISOString(),
      headline: input.report.headline,
      status: input.report.status,
      handshake: input.report.handshake,
      creativeUrl: input.creativeUrl,
      vast: {
        id: input.surface.id,
        role: input.surface.role,
        apiFramework: input.surface.apiFramework,
        variableDuration: input.surface.variableDuration,
        skipoffsetSec: input.surface.skipoffsetSec,
        clickThroughUrl: input.surface.clickThroughUrl,
        adParameters: input.surface.adParameters,
        mimeType: input.surface.mimeType,
        url: input.surface.url,
      },
      lastInit: input.lastInit,
      heals: input.report.heals,
      coverage: input.report.coverage,
      trackingUrls: input.report.trackingUrls,
      inspect: input.inspect,
      log: [...input.log].reverse(),
    },
    null,
    2,
  );
}
