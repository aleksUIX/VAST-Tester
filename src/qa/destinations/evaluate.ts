import type { PlayerMediaFile } from "../playerProfiles";
import type {
  BitrateBound,
  DestinationAssignment,
  DestinationContainer,
  DestinationEvaluation,
  DestinationFinding,
  DestinationPack,
  DestinationRendition,
  DestinationSeverity,
} from "./types";

export interface DestinationInput {
  xml: string | null;
  files: readonly PlayerMediaFile[];
}

export interface DestinationProbeTarget {
  url: string;
  path: string;
  durationSec: number | null;
  declaredKbps: number | null;
  delivery: string;
  mimeType: string;
}

interface DestinationFile {
  url: string;
  mimeType: string;
  delivery: string;
  width: string;
  height: string;
  bitrate: string;
  minBitrate: string;
  maxBitrate: string;
  apiFramework: string | null;
  codec: string | null;
  kind: "mediafile" | "mezzanine";
}

interface LinearCreative {
  path: string;
  durationSec: number | null;
  files: DestinationFile[];
}

const QR_TOKEN = /(?:\bqr\b|qr[-_]?code)/i;
const BPS_FLOOR = 100_000;
const STREAMING_TYPES = /(?:mpegurl|dash\+xml|vnd\.apple\.mpegurl)/i;

function finding(
  pack: DestinationPack,
  id: string,
  message: string,
  path: string,
  severity: DestinationSeverity = "error",
): DestinationFinding {
  return { id, severity, message, spec_ref: pack.docs, path };
}

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

export function parseVastDuration(value: string): number | null {
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

function parseNumberAttr(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeDeclaredKbps(raw: string): { kbps: number | null; assumedBps: boolean } {
  const value = parseNumberAttr(raw);
  if (value === null) {
    return { kbps: null, assumedBps: false };
  }
  if (value >= BPS_FLOOR) {
    return { kbps: value / 1000, assumedBps: true };
  }
  return { kbps: value, assumedBps: false };
}

function declaredKbpsOf(file: DestinationFile): { kbps: number | null; assumedBps: boolean } {
  const primary = normalizeDeclaredKbps(file.bitrate);
  if (primary.kbps !== null) {
    return primary;
  }
  return normalizeDeclaredKbps(file.minBitrate);
}

function parseDim(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isVpaid(file: DestinationFile): boolean {
  return (file.apiFramework ?? "").toLowerCase() === "vpaid"
    || file.mimeType.toLowerCase() === "application/javascript";
}

function containerOf(file: DestinationFile): DestinationContainer | "unknown" {
  const mime = file.mimeType.toLowerCase();
  const url = file.url.toLowerCase();
  if (mime === "video/quicktime" || mime === "video/x-quicktime" || url.endsWith(".mov") || url.includes(".mov?")) {
    return "mov";
  }
  if (mime === "video/mp4" || url.endsWith(".mp4") || url.includes(".mp4?")) {
    return "mp4";
  }
  return "unknown";
}

function codecFamilyOf(codec: string | null): "h264" | "hevc" | "av1" | "unknown" {
  const value = (codec ?? "").toLowerCase();
  if (!value) {
    return "unknown";
  }
  if (/(?:avc1|avc3|h\.?264)/.test(value)) {
    return "h264";
  }
  if (/(?:hvc1|hev1|hevc|h\.?265)/.test(value)) {
    return "hevc";
  }
  if (/(?:av01|av1)/.test(value)) {
    return "av1";
  }
  return "unknown";
}

function destinationFileFromElement(el: Element, kind: DestinationFile["kind"]): DestinationFile | null {
  const url = textOf(el);
  if (!url) {
    return null;
  }
  return {
    url,
    mimeType: attr(el, "type") || attr(el, "creativeType"),
    delivery: attr(el, "delivery"),
    width: attr(el, "width"),
    height: attr(el, "height"),
    bitrate: attr(el, "bitrate"),
    minBitrate: attr(el, "minBitrate"),
    maxBitrate: attr(el, "maxBitrate"),
    apiFramework: attr(el, "apiFramework") || null,
    codec: attr(el, "codec") || null,
    kind,
  };
}

function fromPlayerFile(file: PlayerMediaFile): DestinationFile {
  return {
    url: file.url,
    mimeType: file.mimeType,
    delivery: file.delivery,
    width: file.width,
    height: file.height,
    bitrate: file.bitrate,
    minBitrate: "",
    maxBitrate: "",
    apiFramework: file.apiFramework,
    codec: file.codec,
    kind: "mediafile",
  };
}

function collectLinears(xml: string | null, fallbackFiles: readonly PlayerMediaFile[]): LinearCreative[] {
  if (xml) {
    const doc = parseDocument(xml);
    if (doc) {
      const collected: LinearCreative[] = [];
      Array.from(doc.querySelectorAll("Linear")).forEach((linear, index) => {
        const files = [
          ...Array.from(linear.querySelectorAll("MediaFile")).map((node) => destinationFileFromElement(node, "mediafile")),
          ...Array.from(linear.querySelectorAll("Mezzanine")).map((node) => destinationFileFromElement(node, "mezzanine")),
        ].filter((file): file is DestinationFile => file !== null);
        collected.push({
          path: `Linear[${String(index)}]`,
          durationSec: parseVastDuration(textOf(linear.querySelector("Duration"))),
          files,
        });
      });
      if (collected.some((linear) => linear.files.length > 0)) {
        return collected.filter((linear) => linear.files.length > 0);
      }
    }
  }

  if (fallbackFiles.length > 0) {
    return [{ path: "MediaFiles", durationSec: null, files: fallbackFiles.map(fromPlayerFile) }];
  }
  return [];
}

export function scanQrHits(xml: string | null): string[] {
  if (!xml) {
    return [];
  }
  const doc = parseDocument(xml);
  if (!doc) {
    return QR_TOKEN.test(xml) ? ["document"] : [];
  }

  const hits: string[] = [];
  const seen = new Set<string>();
  const add = (path: string) => {
    if (!seen.has(path)) {
      seen.add(path);
      hits.push(path);
    }
  };

  for (const el of Array.from(doc.querySelectorAll("*"))) {
    const name = el.localName;
    if (QR_TOKEN.test(name)) {
      add(name);
    }
    for (const attribute of Array.from(el.attributes)) {
      if (QR_TOKEN.test(attribute.name) || QR_TOKEN.test(attribute.value)) {
        add(`${name}/@${attribute.name}`);
      }
    }
    if (el.childElementCount === 0 && QR_TOKEN.test(el.textContent ?? "")) {
      add(name);
    }
  }
  return hits;
}

function durationFits(rendition: DestinationRendition, durationSec: number | null, tolerance: number): string | null {
  const needsDuration = (rendition.duration_seconds && rendition.duration_seconds.length > 0)
    || rendition.duration_min_seconds !== undefined
    || rendition.duration_max_seconds !== undefined;
  if (!needsDuration) {
    return null;
  }
  if (durationSec === null) {
    return "Linear Duration is missing";
  }
  if (rendition.duration_seconds && rendition.duration_seconds.length > 0) {
    const ok = rendition.duration_seconds.some((allowed) => Math.abs(durationSec - allowed) <= tolerance);
    if (!ok) {
      return `Duration ${durationSec.toFixed(1)}s is not in ${rendition.duration_seconds.join("/")}`;
    }
  }
  if (rendition.duration_min_seconds !== undefined && durationSec + tolerance < rendition.duration_min_seconds) {
    return `Duration ${durationSec.toFixed(1)}s is below ${String(rendition.duration_min_seconds)}s`;
  }
  if (rendition.duration_max_seconds !== undefined && durationSec - tolerance > rendition.duration_max_seconds) {
    return `Duration ${durationSec.toFixed(1)}s is above ${String(rendition.duration_max_seconds)}s`;
  }
  return null;
}

function bitrateFits(bound: BitrateBound, kbps: number): string | null {
  if (bound.min_kbps !== undefined && kbps < bound.min_kbps) {
    return `bitrate ${String(kbps)} is below ${String(bound.min_kbps)} kbps`;
  }
  if (bound.min_kbps_exclusive !== undefined && kbps <= bound.min_kbps_exclusive) {
    return `bitrate ${String(kbps)} is not greater than ${String(bound.min_kbps_exclusive)} kbps`;
  }
  if (bound.max_kbps !== undefined && kbps > bound.max_kbps) {
    return `bitrate ${String(kbps)} is above ${String(bound.max_kbps)} kbps`;
  }
  if (bound.max_kbps_exclusive !== undefined && kbps >= bound.max_kbps_exclusive) {
    return `bitrate ${String(kbps)} is not under ${String(bound.max_kbps_exclusive)} kbps`;
  }
  return null;
}

function fileLabel(file: DestinationFile): string {
  return file.kind === "mezzanine" ? "Mezzanine" : "MediaFile";
}

function fileMatchesRendition(
  rendition: DestinationRendition,
  file: DestinationFile,
  durationSec: number | null,
  tolerance: number,
): string[] {
  const reasons: string[] = [];
  const mime = file.mimeType.trim().toLowerCase();
  if (rendition.file_types && rendition.file_types.length > 0) {
    const allowed = rendition.file_types.map((value) => value.toLowerCase());
    if (!mime || !allowed.includes(mime)) {
      reasons.push(`type ${file.mimeType || "(missing)"} is not ${rendition.file_types.join(" or ")}`);
    }
  }

  const container = containerOf(file);
  if (rendition.container && container !== rendition.container) {
    reasons.push(`container is ${container}, pack wants ${rendition.container}`);
  }

  if (rendition.codec_family) {
    const family = codecFamilyOf(file.codec);
    if (family !== "unknown" && family !== rendition.codec_family) {
      reasons.push(`codec ${file.codec ?? family} is not ${rendition.codec_family}`);
    }
  }

  const width = parseDim(file.width);
  const height = parseDim(file.height);
  if (rendition.resolutions && rendition.resolutions.length > 0) {
    const ok = width !== null && height !== null
      && rendition.resolutions.some((size) => size.width === width && size.height === height);
    if (!ok) {
      reasons.push(
        `${file.width || "?"}x${file.height || "?"} is not ${rendition.resolutions.map((size) => `${String(size.width)}x${String(size.height)}`).join(" or ")}`,
      );
    }
  }
  if (rendition.min_width !== undefined && (width === null || width < rendition.min_width)) {
    reasons.push(`width ${file.width || "(missing)"} is below ${String(rendition.min_width)}`);
  }
  if (rendition.min_height !== undefined && (height === null || height < rendition.min_height)) {
    reasons.push(`height ${file.height || "(missing)"} is below ${String(rendition.min_height)}`);
  }
  if (rendition.aspect_ratio === "16:9") {
    if (width === null || height === null) {
      reasons.push("width/height missing for 16:9");
    } else if (Math.abs(width / height - 16 / 9) > 0.03) {
      reasons.push(`${String(width)}x${String(height)} is not 16:9`);
    }
  }

  if (rendition.bitrate) {
    const declared = declaredKbpsOf(file);
    if (declared.kbps === null) {
      reasons.push("declared bitrate is missing");
    } else {
      const miss = bitrateFits(rendition.bitrate, declared.kbps);
      if (miss) {
        reasons.push(miss);
      }
      const maxDeclared = parseNumberAttr(file.maxBitrate);
      if (maxDeclared !== null && rendition.bitrate.max_kbps !== undefined) {
        const maxKbps = maxDeclared >= BPS_FLOOR ? maxDeclared / 1000 : maxDeclared;
        if (maxKbps > rendition.bitrate.max_kbps) {
          reasons.push(`maxBitrate ${String(maxKbps)} is above ${String(rendition.bitrate.max_kbps)} kbps`);
        }
      }
    }
  }

  const durationMiss = durationFits(rendition, durationSec, tolerance);
  if (durationMiss) {
    reasons.push(durationMiss);
  }

  return reasons;
}

function assignmentOf(rendition: DestinationRendition, file: DestinationFile): DestinationAssignment {
  return {
    rendition_id: rendition.id,
    kind: file.kind,
    url: file.url,
    declared_kbps: declaredKbpsOf(file).kbps,
  };
}

function evaluateLinear(pack: DestinationPack, linear: LinearCreative): {
  findings: DestinationFinding[];
  assignments: DestinationAssignment[];
} {
  const out: DestinationFinding[] = [];
  const assignments: DestinationAssignment[] = [];

  for (const file of linear.files) {
    if (declaredKbpsOf(file).assumedBps) {
      out.push(finding(
        pack,
        "DEST-bitrate-unit",
        `${fileLabel(file)} bitrate looks like bits/sec, not kilobits. Checked as ${String(declaredKbpsOf(file).kbps)} kbps.`,
        `${linear.path}/${fileLabel(file)}`,
        "warning",
      ));
    }
  }

  if (pack.forbid_vpaid) {
    for (const file of linear.files) {
      if (isVpaid(file)) {
        out.push(finding(pack, "DEST-vpaid-forbidden", "VPAID MediaFile is not eligible on this destination.", `${linear.path}/MediaFile`));
      }
    }
  }

  if (pack.max_files !== undefined && linear.files.length > pack.max_files) {
    out.push(finding(
      pack,
      "DEST-file-count",
      `${String(linear.files.length)} MediaFiles/Mezzanine nodes; this destination allows at most ${String(pack.max_files)}.`,
      linear.path,
    ));
  }

  if (pack.match === "any") {
    const matched = linear.files.find((file) => pack.renditions.some((rendition) => (
      fileMatchesRendition(rendition, file, linear.durationSec, pack.duration_tolerance_sec).length === 0
    )));
    if (matched) {
      const rendition = pack.renditions.find((candidate) => (
        fileMatchesRendition(candidate, matched, linear.durationSec, pack.duration_tolerance_sec).length === 0
      ));
      if (rendition) {
        assignments.push(assignmentOf(rendition, matched));
      }
      return { findings: out, assignments };
    }
    const preferred = linear.files.find((file) => pack.renditions.some((rendition) => {
      const allowed = rendition.file_types?.map((value) => value.toLowerCase()) ?? [];
      return allowed.length === 0 || allowed.includes(file.mimeType.trim().toLowerCase());
    })) ?? linear.files[0];
    if (preferred && declaredKbpsOf(preferred).kbps === null && pack.renditions.some((rendition) => rendition.bitrate)) {
      out.push(finding(pack, "DEST-bitrate-undeclared", "MediaFile has no declared bitrate. This pack fails closed.", `${linear.path}/MediaFile`));
    }
    const detail = preferred
      ? fileMatchesRendition(
        pack.renditions.find((rendition) => fileMatchesRendition(rendition, preferred, linear.durationSec, pack.duration_tolerance_sec).length > 0) ?? pack.renditions[0],
        preferred,
        linear.durationSec,
        pack.duration_tolerance_sec,
      ).join("; ")
      : "no MediaFile";
    out.push(finding(
      pack,
      "DEST-media-ineligible",
      `No MediaFile meets ${pack.display_name}. ${detail}`,
      linear.path,
    ));
    return { findings: out, assignments };
  }

  const required = pack.renditions.filter((rendition) => rendition.required !== false);
  const unused = [...linear.files];
  const ordered = [...required].sort((left, right) => {
    const leftHits = unused.filter((file) => fileMatchesRendition(left, file, linear.durationSec, pack.duration_tolerance_sec).length === 0).length;
    const rightHits = unused.filter((file) => fileMatchesRendition(right, file, linear.durationSec, pack.duration_tolerance_sec).length === 0).length;
    return leftHits - rightHits;
  });

  const filled = new Map<string, DestinationFile>();
  for (const rendition of ordered) {
    const candidates = unused.filter((file) => (
      fileMatchesRendition(rendition, file, linear.durationSec, pack.duration_tolerance_sec).length === 0
    ));
    const file = rendition.id === "mezzanine"
      ? candidates.find((candidate) => candidate.kind === "mezzanine") ?? candidates[0]
      : candidates[0];
    if (!file) {
      continue;
    }
    unused.splice(unused.indexOf(file), 1);
    filled.set(rendition.id, file);
    assignments.push(assignmentOf(rendition, file));
  }

  for (const rendition of required) {
    if (filled.has(rendition.id)) {
      continue;
    }
    const undeclared = linear.files.filter((file) => declaredKbpsOf(file).kbps === null);
    const relevant = rendition.id === "mezzanine"
      ? undeclared.filter((file) => file.kind === "mezzanine")
      : undeclared.filter((file) => file.kind === "mediafile");
    if (relevant.length > 0 && rendition.bitrate) {
      out.push(finding(pack, "DEST-bitrate-undeclared", `Rendition ${rendition.id} needs a declared bitrate.`, `${linear.path}/${rendition.id === "mezzanine" ? "Mezzanine" : "MediaFile"}`));
    }
    out.push(finding(
      pack,
      "DEST-rendition-missing",
      `Missing ${rendition.id} rendition for ${pack.display_name}.`,
      linear.path,
    ));
  }

  return { findings: out, assignments };
}

export function listProbeTargets(xml: string | null, files: readonly PlayerMediaFile[]): DestinationProbeTarget[] {
  const targets: DestinationProbeTarget[] = [];
  for (const linear of collectLinears(xml, files)) {
    for (const [index, file] of linear.files.entries()) {
      if (STREAMING_TYPES.test(file.mimeType) || file.delivery.toLowerCase() === "streaming") {
        continue;
      }
      if (!file.url || file.url.startsWith("javascript:")) {
        continue;
      }
      targets.push({
        url: file.url,
        path: `${linear.path}/${fileLabel(file)}[${String(index)}]`,
        durationSec: linear.durationSec,
        declaredKbps: declaredKbpsOf(file).kbps,
        delivery: file.delivery,
        mimeType: file.mimeType,
      });
    }
  }
  return targets.slice(0, 4);
}

export function evaluateDestination(pack: DestinationPack, input: DestinationInput): DestinationEvaluation {
  const findings: DestinationFinding[] = [];
  const assignments: DestinationAssignment[] = [];

  if (pack.forbid_qr) {
    const hits = scanQrHits(input.xml);
    if (hits.length > 0) {
      findings.push(finding(
        pack,
        "DEST-qr-forbidden",
        `QR is not allowed on ${pack.display_name}. Hit: ${hits[0]}.`,
        hits[0],
      ));
    }
  }

  const linears = collectLinears(input.xml, input.files);
  if (linears.length === 0) {
    findings.push(finding(pack, "DEST-no-linear-media", "No Linear MediaFile to check against this destination.", "MediaFiles"));
  } else {
    for (const linear of linears) {
      const result = evaluateLinear(pack, linear);
      findings.push(...result.findings);
      assignments.push(...result.assignments);
    }
  }

  const unique = new Map<string, DestinationFinding>();
  for (const item of findings) {
    unique.set(`${item.id}|${item.path}|${item.message}`, item);
  }
  const list = [...unique.values()];
  return {
    pack,
    status: list.some((item) => item.severity === "error") ? "fail" : "pass",
    findings: list,
    assignments,
  };
}
