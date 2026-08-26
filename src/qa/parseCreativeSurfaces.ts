import type { OverlayLayout, OverlayResourceKind, OverlayRole, OverlaySurface, CreativeSurfaces } from "./types";

function text(el: Element | null): string {
  return el?.textContent?.trim() ?? "";
}

function attr(el: Element | null, name: string): string {
  return el?.getAttribute(name)?.trim() ?? "";
}

function parseSkipoffset(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  const parts = trimmed.split(":");
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

function isSimid(value: string | null): boolean {
  return (value ?? "").trim().toUpperCase() === "SIMID";
}

function resourceFrom(el: Element): { kind: OverlayResourceKind; mimeType: string; url: string } {
  const staticEl = el.querySelector("StaticResource");
  const iframeEl = el.querySelector("IFrameResource");
  const htmlEl = el.querySelector("HTMLResource");

  if (staticEl) {
    return { kind: "static", mimeType: attr(staticEl, "creativeType"), url: text(staticEl) };
  }
  if (iframeEl) {
    return { kind: "iframe", mimeType: attr(iframeEl, "type") || "text/html", url: text(iframeEl) };
  }
  if (htmlEl) {
    return { kind: "html", mimeType: attr(htmlEl, "creativeType") || "text/html", url: text(htmlEl) };
  }

  return { kind: "iframe", mimeType: "", url: "" };
}

function clickThroughFrom(el: Element): string | null {
  const url =
    text(el.querySelector("NonLinearClickThrough")) ||
    text(el.querySelector("ClickThrough"));
  return url.length > 0 ? url : null;
}

function mimeRank(type: string): number {
  const value = type.toLowerCase();
  if (value.includes("video/webm")) {
    return 0;
  }
  if (value.includes("video/mp4")) {
    return 1;
  }
  if (value.startsWith("video/")) {
    return 2;
  }
  return 9;
}

function firstVideoUrl(root: ParentNode, selector: string): string | null {
  const files = Array.from(root.querySelectorAll(selector)).sort(
    (left, right) => mimeRank(attr(left, "type")) - mimeRank(attr(right, "type")),
  );
  const chosen = files.find((file) => text(file).length > 0 && mimeRank(attr(file, "type")) < 9);
  return chosen ? text(chosen) : null;
}

function readPlcmt(doc: Document): number | null {
  const node = doc.querySelector("Extension[type='plcmt'] plcmt") ?? doc.querySelector("Extension[type='plcmt']");
  const value = Number.parseInt(text(node), 10);
  return Number.isFinite(value) ? value : null;
}

function layoutFor(nl: Element, hasLinear: boolean, plcmt: number | null): OverlayLayout {
  if (hasLinear) {
    return "overlay";
  }

  if (plcmt === 5 || plcmt === 6 || plcmt === 8 || plcmt === 9) {
    return "stage";
  }

  if (plcmt === 7) {
    return "overlay";
  }

  const width = Number(attr(nl, "width"));
  const height = Number(attr(nl, "height"));
  if (Number.isFinite(height) && height > 0 && height <= 160) {
    return "overlay";
  }
  if (Number.isFinite(width) && Number.isFinite(height) && width >= 640 && height >= 360) {
    return "stage";
  }

  return "overlay";
}

export function parseCreativeSurfaces(xml: string | null): CreativeSurfaces {
  const empty: CreativeSurfaces = { overlays: [], simid: [], stageVideoUrl: null };
  if (!xml || typeof window === "undefined") {
    return empty;
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return empty;
  }

  if (doc.querySelector("parsererror")) {
    return empty;
  }

  const overlays: OverlaySurface[] = [];
  const adParameters = text(doc.querySelector("AdParameters"));
  const hasLinear = Boolean(doc.querySelector("Linear"));
  const plcmt = readPlcmt(doc);
  const linearSkipoffsetSec = parseSkipoffset(attr(doc.querySelector("Linear"), "skipoffset"));

  Array.from(doc.querySelectorAll("NonLinear")).forEach((nl, index) => {
    const resource = resourceFrom(nl);
    const apiFramework = attr(nl, "apiFramework") || attr(nl.querySelector("IFrameResource"), "apiFramework") || null;
    const simid = isSimid(apiFramework) || isSimid(attr(nl.querySelector("IFrameResource"), "apiFramework"));
    const icf = nl.querySelector("InteractiveCreativeFile");
    const icfSimid = icf ? isSimid(attr(icf, "apiFramework")) : false;
    const mediaFileUrl = firstVideoUrl(nl, "MediaFile");
    const role: OverlayRole = simid || icfSimid ? "simid-nonlinear" : "nonlinear";
    const layout = layoutFor(nl, hasLinear, plcmt);

    let url = resource.url;
    let mimeType = resource.mimeType;
    let resourceKind: OverlayResourceKind = resource.kind;

    if (icfSimid) {
      url = text(icf);
      mimeType = attr(icf, "type") || "text/html";
      resourceKind = "iframe";
    } else if (!url && mediaFileUrl) {
      url = mediaFileUrl;
      mimeType = attr(nl.querySelector("MediaFile"), "type") || "video/mp4";
      resourceKind = "video";
    }

    overlays.push({
      id: `nonlinear-${String(index)}`,
      role,
      width: attr(nl, "width"),
      height: attr(nl, "height"),
      mimeType,
      apiFramework: icfSimid ? attr(icf, "apiFramework") : apiFramework,
      variableDuration: icf ? attr(icf, "variableDuration") || null : null,
      skipoffsetSec: parseSkipoffset(attr(nl.closest("Linear"), "skipoffset")) ?? linearSkipoffsetSec,
      url,
      clickThroughUrl: clickThroughFrom(nl),
      adParameters: adParameters || null,
      resourceKind: icfSimid || simid ? "iframe" : resourceKind,
      layout,
      mediaFileUrl,
    });
  });

  Array.from(doc.querySelectorAll("InteractiveCreativeFile")).forEach((icf, index) => {
    if (icf.closest("NonLinear")) {
      return;
    }

    overlays.push({
      id: `icf-${String(index)}`,
      role: isSimid(attr(icf, "apiFramework")) ? "simid-linear" : "simid-linear",
      width: "",
      height: "",
      mimeType: attr(icf, "type") || "text/html",
      apiFramework: attr(icf, "apiFramework") || null,
      variableDuration: attr(icf, "variableDuration") || null,
      skipoffsetSec: parseSkipoffset(attr(icf.closest("Linear"), "skipoffset")) ?? linearSkipoffsetSec,
      url: text(icf),
      clickThroughUrl: text(doc.querySelector("ClickThrough")) || null,
      adParameters: adParameters || null,
      resourceKind: "iframe",
      layout: "overlay",
      mediaFileUrl: firstVideoUrl(icf.closest("Linear") ?? doc, "MediaFile"),
    });
  });

  const nonlinearVideo = overlays.map((surface) => surface.mediaFileUrl).find((url): url is string => Boolean(url));
  const linearVideo = hasLinear ? firstVideoUrl(doc, "Linear MediaFile") : null;

  return {
    overlays,
    simid: overlays.filter((surface) => surface.role !== "nonlinear" && isSimid(surface.apiFramework)),
    stageVideoUrl: hasLinear ? linearVideo : nonlinearVideo ?? null,
  };
}

export function primarySimidSurface(surfaces: CreativeSurfaces): OverlaySurface | null {
  return surfaces.simid[0] ?? null;
}

export function staticOverlays(surfaces: CreativeSurfaces): OverlaySurface[] {
  return surfaces.overlays.filter((surface) => surface.role === "nonlinear" && surface.resourceKind === "static" && surface.url.length > 0);
}
