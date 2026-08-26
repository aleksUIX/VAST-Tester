import type { SimidInspectFinding, SimidInspectReport } from "./types";

const BODY_CAP = 512_000;
const SCRIPT_SRC = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

function header(headers: Headers, name: string): string | null {
  return headers.get(name);
}

function push(findings: SimidInspectFinding[], id: string, severity: SimidInspectFinding["severity"], message: string) {
  findings.push({ id, severity, message });
}

function looksLikeJavascript(contentType: string | null, body: string): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("javascript") || type.includes("ecmascript")) {
    return true;
  }
  const sample = body.slice(0, 400).toLowerCase();
  return sample.includes("getvpaidad") && !sample.includes("<html");
}

async function sameOriginScriptBodies(pageUrl: string, html: string): Promise<string> {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return "";
  }

  const urls: string[] = [];
  SCRIPT_SRC.lastIndex = 0;
  let match = SCRIPT_SRC.exec(html);
  while (match && urls.length < 8) {
    try {
      const resolved = new URL(match[1], pageUrl).toString();
      if (new URL(resolved).origin === origin && !urls.includes(resolved)) {
        urls.push(resolved);
      }
    } catch {
      // Ignore unparsable script URLs.
    }
    match = SCRIPT_SRC.exec(html);
  }

  const parts = await Promise.all(
    urls.map(async (href) => {
      try {
        const response = await fetch(href, { method: "GET", redirect: "follow" });
        if (!response.ok) {
          return "";
        }
        return (await response.text()).slice(0, BODY_CAP);
      } catch {
        return "";
      }
    }),
  );
  return parts.join("\n");
}

export async function inspectSimidCreative(url: string): Promise<SimidInspectReport> {
  const findings: SimidInspectFinding[] = [];

  let response: Response;
  try {
    response = await fetch(url, { method: "GET", redirect: "follow" });
  } catch (error) {
    return {
      url,
      ok: false,
      status: null,
      contentType: null,
      xFrameOptions: null,
      csp: null,
      redirected: false,
      finalUrl: null,
      corsBlocked: true,
      error: error instanceof Error ? error.message : String(error),
      findings: [
        {
          id: "SIMID-inspect-fetch",
          severity: "fail",
          message: "GET failed (often CORS). The iframe handshake can still run; this fetch cannot read headers.",
        },
      ],
    };
  }

  const contentType = header(response.headers, "content-type");
  const xFrameOptions = header(response.headers, "x-frame-options");
  const csp = header(response.headers, "content-security-policy");
  const body = (await response.text()).slice(0, BODY_CAP);
  const scan = `${body}\n${await sameOriginScriptBodies(response.url || url, body)}`;

  try {
    if (new URL(url).protocol === "http:") {
      push(
        findings,
        "SIMID-inspect-http-url",
        "fail",
        "Creative URL is http. An https player will blank the iframe as mixed content.",
      );
    }
  } catch {
    // Ignore unparsable inspect URLs.
  }

  if (!response.ok) {
    push(findings, "SIMID-inspect-status", "fail", `Creative URL returned HTTP ${String(response.status)}.`);
  }

  const type = (contentType ?? "").toLowerCase();
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
    push(findings, "SIMID-inspect-content-type", "fail", `Content-Type is ${contentType ?? "missing"}, expected text/html.`);
  }

  const xfo = (xFrameOptions ?? "").toUpperCase();
  if (xfo === "DENY" || xfo === "SAMEORIGIN") {
    push(findings, "SIMID-inspect-xfo", "fail", `X-Frame-Options: ${xFrameOptions} will block a cross-origin player iframe.`);
  }

  if (csp && /frame-ancestors/i.test(csp) && /frame-ancestors\s+['"]?none['"]?/i.test(csp)) {
    push(findings, "SIMID-inspect-csp", "fail", "CSP frame-ancestors none will block the player iframe.");
  }

  if (looksLikeJavascript(contentType, body)) {
    push(findings, "SIMID-inspect-javascript-body", "fail", "Body looks like JavaScript (getVPAIDAd), not an HTML document.");
  }

  if (!/<html/i.test(body)) {
    push(findings, "SIMID-inspect-html", "warning", "Response has no <html marker. Minified documents can false-negative.");
  }

  if (!/createSession/i.test(scan)) {
    push(findings, "SIMID-inspect-create-session", "warning", "No createSession string found. The creative speaks first in SIMID.");
  }

  if (!/postMessage/i.test(scan)) {
    push(findings, "SIMID-inspect-postmessage", "warning", "No postMessage string found. SIMID only talks over postMessage.");
  }

  if (!/SIMID:Player:init|Player:init/i.test(scan)) {
    push(findings, "SIMID-inspect-init", "warning", "No SIMID:Player:init handler string found.");
  }

  if (!/environmentData/.test(scan) && /SIMID:Player:init/.test(scan) && /(?:args|event|data)\.environment\b/.test(scan)) {
    push(
      findings,
      "SIMID-inspect-environment-shape",
      "warning",
      "Creative looks up init.environment. SIMID 1.1 sends environmentData and creativeData.",
    );
  }

  if (!/SIMID:Player:startCreative|Player:startCreative/i.test(scan)) {
    push(findings, "SIMID-inspect-start", "warning", "No SIMID:Player:startCreative handler string found.");
  }

  if (/getVPAIDAd/.test(scan)) {
    push(findings, "SIMID-inspect-vpaid-leftover", "fail", "getVPAIDAd is a VPAID leftover. A SIMID player will not call it.");
  }

  if (/Math\.random\s*\(/.test(scan) && !/getRandomValues|randomUUID/.test(scan)) {
    push(findings, "SIMID-inspect-session-random", "warning", "Session ids appear to use Math.random. SIMID 1.2 wants crypto.getRandomValues or randomUUID.");
  }

  if (/src\s*=\s*['"]http:\/\//i.test(body) || /src=['"]http:\/\//i.test(body)) {
    push(findings, "SIMID-inspect-mixed-content", "fail", "HTML references an http:// subresource. Mixed content will blank the iframe.");
  }

  if (findings.length === 0) {
    push(findings, "SIMID-inspect-ok", "pass", "Fetch looks like HTML a SIMID player can load.");
  }

  return {
    url,
    ok: response.ok && !findings.some((finding) => finding.severity === "fail"),
    status: response.status,
    contentType,
    xFrameOptions,
    csp,
    redirected: response.redirected,
    finalUrl: response.url,
    corsBlocked: false,
    error: null,
    findings,
  };
}
