import { compileDestinationPacks } from "./compile";
import espnHosted from "./packs/espn-hosted.json";
import espnThirdParty from "./packs/espn-third-party.json";
import genericOtt from "./packs/generic-ott.json";
import hulu from "./packs/hulu.json";
import nbcuHosted from "./packs/nbcu-hosted.json";
import nbcuThirdParty from "./packs/nbcu-third-party.json";
import netflixHosted from "./packs/netflix-hosted.json";
import rokuHosted from "./packs/roku-hosted.json";
import rokuThirdParty from "./packs/roku-third-party.json";
import type { DestinationContract, DestinationPack, DestinationPackRaw } from "./types";

export const NONE_DESTINATION_ID = "none";

export const DESTINATION_PACKS: readonly DestinationPack[] = compileDestinationPacks([
  genericOtt,
  netflixHosted,
  rokuHosted,
  rokuThirdParty,
  espnHosted,
  espnThirdParty,
  hulu,
  nbcuHosted,
  nbcuThirdParty,
] as DestinationPackRaw[]);

const PACK_BY_ID = new Map(DESTINATION_PACKS.map((pack) => [pack.id, pack]));

export function destinationPackById(id: string | null | undefined): DestinationPack | null {
  if (!id || id === NONE_DESTINATION_ID) {
    return null;
  }
  return PACK_BY_ID.get(id) ?? null;
}

export function isDestinationPackId(value: string | null | undefined): value is string {
  return value === NONE_DESTINATION_ID || (typeof value === "string" && PACK_BY_ID.has(value));
}

export const DESTINATION_GROUPS: readonly { contract: DestinationContract; label: string }[] = [
  { contract: "generic", label: "Generic" },
  { contract: "hosted", label: "Hosted" },
  { contract: "third_party", label: "Third-party" },
];

export function packsForContract(contract: DestinationContract): DestinationPack[] {
  return DESTINATION_PACKS.filter((pack) => pack.contract === contract);
}

export { evaluateDestination } from "./evaluate";
export { probeDestinationBitrates } from "./probe";
export type { DestinationEvaluation, DestinationFinding, DestinationPack } from "./types";
