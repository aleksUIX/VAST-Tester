import type { DestinationPack, DestinationPackRaw, DestinationRendition } from "./types";

function isHttpsDocs(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function compileRendition(packId: string, raw: DestinationRendition): DestinationRendition {
  if (!raw.id || raw.id.trim().length === 0) {
    throw new Error(`${packId}: rendition is missing id`);
  }
  return raw;
}

export function compileDestinationPack(raw: DestinationPackRaw): DestinationPack {
  if (!raw.id.startsWith("destination/")) {
    throw new Error(`pack id must start with destination/: ${raw.id}`);
  }
  if (raw.source_level !== "official_vendor") {
    throw new Error(`${raw.id}: source_level must be official_vendor`);
  }
  if (!isHttpsDocs(raw.docs)) {
    throw new Error(`${raw.id}: docs must be an https URL`);
  }
  if (!raw.display_name.trim() || !raw.summary.trim()) {
    throw new Error(`${raw.id}: display_name and summary are required`);
  }
  if (raw.contract !== "generic" && raw.contract !== "hosted" && raw.contract !== "third_party") {
    throw new Error(`${raw.id}: contract is invalid`);
  }
  if (raw.match !== "any" && raw.match !== "all") {
    throw new Error(`${raw.id}: match must be any or all`);
  }
  if (!Array.isArray(raw.renditions) || raw.renditions.length === 0) {
    throw new Error(`${raw.id}: renditions are required`);
  }

  return {
    ...raw,
    source_level: "official_vendor",
    forbid_vpaid: raw.forbid_vpaid === true,
    forbid_qr: raw.forbid_qr === true,
    duration_tolerance_sec: raw.duration_tolerance_sec ?? 0.5,
    renditions: raw.renditions.map((rendition) => compileRendition(raw.id, rendition)),
  };
}

export function compileDestinationPacks(rawPacks: readonly DestinationPackRaw[]): DestinationPack[] {
  const packs = rawPacks.map(compileDestinationPack);
  const seen = new Set<string>();
  for (const pack of packs) {
    if (seen.has(pack.id)) {
      throw new Error(`duplicate destination pack id: ${pack.id}`);
    }
    seen.add(pack.id);
  }
  return packs;
}
