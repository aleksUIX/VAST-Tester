import { resolveQaAssetUrl } from "../resolveQaAssetUrl";
import { listProbeTargets } from "./evaluate";
import type { DestinationFinding, DestinationPack } from "./types";
import type { PlayerMediaFile } from "../playerProfiles";

const MISMATCH_RATIO = 0.35;
const PROBE_TIMEOUT_MS = 4000;

function skipHost(hostname: string): boolean {
  return hostname === "example.com"
    || hostname.endsWith(".example")
    || hostname === "cdn.adserver-demo.net"
    || hostname.endsWith(".adserver-demo.net");
}

function estimatedKbps(bytes: number, durationSec: number): number {
  return (bytes * 8) / durationSec / 1000;
}

function readContentLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function headOrRange(url: string, signal: AbortSignal): Promise<number | null> {
  try {
    const head = await fetch(url, { method: "HEAD", signal, mode: "cors" });
    const fromHead = readContentLength(head.headers);
    if (fromHead !== null) {
      return fromHead;
    }
  } catch {
    // HEAD is often blocked or unimplemented. Try a 1-byte range next.
  }

  try {
    const ranged = await fetch(url, {
      method: "GET",
      signal,
      mode: "cors",
      headers: { Range: "bytes=0-0" },
    });
    const contentRange = ranged.headers.get("content-range");
    const total = contentRange?.match(/\/(\d+)\s*$/)?.[1];
    if (total) {
      const value = Number(total);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    return readContentLength(ranged.headers);
  } catch {
    return null;
  }
}

export async function probeDestinationBitrates(
  pack: DestinationPack,
  xml: string | null,
  files: readonly PlayerMediaFile[],
): Promise<DestinationFinding[]> {
  const findings: DestinationFinding[] = [];
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    for (const target of listProbeTargets(xml, files)) {
      const resolved = resolveQaAssetUrl(target.url) ?? target.url;
      let hostname = "";
      try {
        hostname = new URL(resolved, typeof location === "object" ? location.origin : "http://localhost").hostname;
      } catch {
        continue;
      }
      if (skipHost(hostname)) {
        continue;
      }
      if (target.durationSec === null || target.durationSec <= 0) {
        continue;
      }

      const bytes = await headOrRange(resolved, controller.signal);
      if (bytes === null) {
        continue;
      }

      const probed = estimatedKbps(bytes, target.durationSec);
      const rounded = Math.round(probed);
      if (target.declaredKbps !== null && target.declaredKbps > 0) {
        const delta = Math.abs(probed - target.declaredKbps) / target.declaredKbps;
        if (delta > MISMATCH_RATIO) {
          findings.push({
            id: "DEST-bitrate-probe-mismatch",
            severity: "warning",
            message: `Fetched size is about ${String(rounded)} kbps over ${target.durationSec.toFixed(1)}s. Declared bitrate is ${String(target.declaredKbps)}. Size is not an encode probe.`,
            spec_ref: pack.docs,
            path: target.path,
          });
        }
      }
    }
  } finally {
    globalThis.clearTimeout(timer);
  }

  return findings;
}
