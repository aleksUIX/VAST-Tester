import type { VastResolvedAd, VastWrapperHop } from "vastlint-client";

import { resolveQaAssetUrl } from "./resolveQaAssetUrl";
import type { OmidNotExecutedReason, OmidScript, OmidScriptStatus } from "./omidTypes";

function textOf(el: Element | null): string {
  return el?.textContent?.trim() ?? "";
}

function attr(el: Element | null, name: string): string {
  return el?.getAttribute(name)?.trim() ?? "";
}

function parseDocument(xml: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) {
      return null;
    }
    return doc;
  } catch {
    return null;
  }
}

function notExecutedUrlsFrom(verification: Element): string[] {
  return Array.from(verification.querySelectorAll("Tracking"))
    .filter((node) => attr(node, "event") === "verificationNotExecuted")
    .map((node) => textOf(node))
    .filter((url) => url.length > 0);
}

function scriptsFromDocument(xml: string, origin: string): OmidScript[] {
  const doc = parseDocument(xml);
  if (!doc) {
    return [];
  }

  return Array.from(doc.querySelectorAll("Verification")).map((verification, index) => {
    const js = Array.from(verification.querySelectorAll("JavaScriptResource")).find(
      (node) => attr(node, "apiFramework").toLowerCase() === "omid",
    ) ?? null;
    const executable = verification.querySelector("ExecutableResource");
    const resource = js ?? executable;
    const jsUrl = textOf(js);
    const execUrl = textOf(executable);
    const kind: OmidScript["kind"] = jsUrl ? "javascript" : "executable";
    const url = jsUrl || execUrl;
    const apiFramework = attr(resource, "apiFramework") || null;

    return {
      id: `${origin}-${String(index)}-${url}`,
      vendor: attr(verification, "vendor") || "unknown",
      url,
      apiFramework,
      kind,
      browserOptional: attr(resource, "browserOptional") || null,
      parameters: textOf(verification.querySelector("VerificationParameters")) || null,
      notExecutedUrls: notExecutedUrlsFrom(verification),
      status: "pending" as const,
      probeStatus: null,
      probeType: null,
      probeError: null,
      reason: null,
    } satisfies OmidScript;
  }).filter((script) => script.url.length > 0);
}

function mergeScripts(scripts: OmidScript[]): OmidScript[] {
  const seen = new Set<string>();
  const merged: OmidScript[] = [];
  for (const script of scripts) {
    const key = `${script.vendor}|${script.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({ ...script, id: `omid-${String(merged.length)}` });
  }
  return merged;
}

export function collectOmidScripts(
  resolvedAds: readonly VastResolvedAd[],
  wrapperChain: readonly VastWrapperHop[],
  rootXml: string | null,
): OmidScript[] {
  const fromXml: OmidScript[] = [];
  if (rootXml) {
    fromXml.push(...scriptsFromDocument(rootXml, "root"));
  }
  for (const hop of wrapperChain) {
    fromXml.push(...scriptsFromDocument(hop.xml, `hop-${String(hop.index)}`));
  }

  const fromAds: OmidScript[] = resolvedAds.flatMap((ad, adIndex) =>
    ad.adVerifications.map((verification, verificationIndex) => {
      const resource = verification.resources.find((item) => item.kind === "javascript")
        ?? verification.resources[0]
        ?? null;
      return {
        id: `ad-${String(adIndex)}-${String(verificationIndex)}`,
        vendor: verification.vendor ?? "unknown",
        url: resource?.url ?? "",
        apiFramework: resource?.apiFramework ?? null,
        kind: resource?.kind ?? "javascript",
        browserOptional: resource?.browserOptional ?? null,
        parameters: verification.verificationParameters,
        notExecutedUrls: [],
        status: "pending" as OmidScriptStatus,
        probeStatus: null,
        probeType: null,
        probeError: null,
        reason: null,
      };
    }).filter((script) => script.url.length > 0),
  );

  const merged = mergeScripts([...fromXml, ...fromAds]);
  const urlsByVendorUrl = new Map(fromXml.map((script) => [`${script.vendor}|${script.url}`, script.notExecutedUrls]));
  return merged.map((script) => ({
    ...script,
    notExecutedUrls: script.notExecutedUrls.length > 0
      ? script.notExecutedUrls
      : urlsByVendorUrl.get(`${script.vendor}|${script.url}`) ?? [],
  }));
}

export function omidScriptsToInject(scripts: readonly OmidScript[]): OmidScript[] {
  return scripts.filter((script) =>
    script.kind === "javascript"
    && (script.apiFramework == null || script.apiFramework.toLowerCase() === "omid")
    && (script.status === "injectable" || script.status === "opaque" || script.status === "pending"),
  );
}

export function resolveOmidScriptUrl(url: string): string {
  return resolveQaAssetUrl(url) ?? url;
}

export async function probeOmidScript(script: OmidScript): Promise<OmidScript> {
  if (script.kind !== "javascript") {
    return {
      ...script,
      status: "not-executed",
      reason: "2",
      probeError: "ExecutableResource is not injectable in this web OM SDK session.",
    };
  }

  const url = resolveOmidScriptUrl(script.url);
  try {
    const resolved = new URL(url, globalThis.location?.href ?? "https://localhost");
    if (resolved.protocol === "http:" && globalThis.location?.protocol === "https:") {
      return {
        ...script,
        status: "not-executed",
        reason: "1",
        probeError: "http URL. An https player will block mixed content.",
      };
    }
  } catch {
    // Keep going; OM Web still needs a string.
  }

  try {
    const response = await fetch(url, { method: "GET", redirect: "follow" });
    const contentType = response.headers.get("content-type");
    const type = (contentType ?? "").toLowerCase();
    const looksJs = type.includes("javascript") || type.includes("ecmascript") || type === "" || url.endsWith(".js");
    if (!response.ok) {
      return {
        ...script,
        status: "not-executed",
        reason: "1",
        probeStatus: response.status,
        probeType: contentType,
        probeError: `HTTP ${String(response.status)}`,
      };
    }
    return {
      ...script,
      status: looksJs ? "injectable" : "opaque",
      probeStatus: response.status,
      probeType: contentType,
      probeError: looksJs ? null : `Content-Type ${contentType ?? "missing"}`,
    };
  } catch (error) {
    return {
      ...script,
      status: "opaque",
      probeError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readLinearSkipoffset(xml: string | null): number | null {
  if (!xml) {
    return null;
  }
  const doc = parseDocument(xml);
  const value = attr(doc?.querySelector("Linear") ?? null, "skipoffset");
  if (!value) {
    return null;
  }
  if (/^\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isFinite(n))) {
    return null;
  }
  if (nums.length === 3) {
    return nums[0] * 3600 + nums[1] * 60 + nums[2];
  }
  return nums[0] * 60 + nums[1];
}
