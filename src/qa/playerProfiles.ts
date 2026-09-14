import { rankMediaFiles, type VastResolvedAd } from "vastlint-client";

export type SimidProtocolVersion = "1.0" | "1.1" | "1.2";
export type SimidSupport = SimidProtocolVersion | "off";

export interface PlayerProfile {
  id: string;
  label: string;
  summary: string;
  supportedMimeTypes: string[];
  preferredMimeTypes: string[];
  preferredDelivery: string[];
  targetWidth: number;
  targetHeight: number;
  targetBitrate?: number;
  maxBitrate?: number;
  vpaid: boolean;
  simid: SimidSupport;
  omid: boolean;
}

export interface PlayerMediaFile {
  url: string;
  mimeType: string;
  delivery: string;
  width: string;
  height: string;
  bitrate: string;
  apiFramework: string | null;
  codec: string | null;
}

export type PlayerMediaStatus = "picked" | "playable" | "dropped";

export interface PlayerMediaVerdict {
  file: PlayerMediaFile;
  status: PlayerMediaStatus;
  score: number | null;
  reasons: string[];
}

export interface PlayerMediaEvaluation {
  selected: PlayerMediaFile | null;
  rows: PlayerMediaVerdict[];
}

export const PLAYER_PROFILES: readonly PlayerProfile[] = [
  {
    id: "web-browser",
    label: "Web browser",
    summary: "Chrome-like: MP4 and WebM, HLS listed, no VPAID, SIMID 1.1, OM SDK.",
    supportedMimeTypes: ["video/mp4", "video/webm", "application/x-mpegURL"],
    preferredMimeTypes: ["video/mp4", "video/webm"],
    preferredDelivery: ["progressive", "streaming"],
    targetWidth: 1280,
    targetHeight: 720,
    vpaid: false,
    simid: "1.1",
    omid: true,
  },
  {
    id: "ima",
    label: "IMA (web)",
    summary: "Google IMA: MP4 over HLS, VPAID on, SIMID 1.1, OM SDK.",
    supportedMimeTypes: ["video/mp4", "video/webm", "application/x-mpegURL", "application/javascript"],
    preferredMimeTypes: ["video/mp4", "application/x-mpegURL"],
    preferredDelivery: ["progressive", "streaming"],
    targetWidth: 1280,
    targetHeight: 720,
    vpaid: true,
    simid: "1.1",
    omid: true,
  },
  {
    id: "exoplayer",
    label: "ExoPlayer",
    summary: "Android: HLS then DASH then MP4, no WebM, no VPAID, SIMID off, OM SDK.",
    supportedMimeTypes: ["video/mp4", "application/x-mpegURL", "application/dash+xml"],
    preferredMimeTypes: ["application/x-mpegURL", "application/dash+xml", "video/mp4"],
    preferredDelivery: ["streaming", "progressive"],
    targetWidth: 1920,
    targetHeight: 1080,
    vpaid: false,
    simid: "off",
    omid: true,
  },
  {
    id: "fire-tv",
    label: "Fire TV",
    summary: "Fire OS: HLS then MP4, no WebM, no VPAID, SIMID off, OM SDK.",
    supportedMimeTypes: ["video/mp4", "application/x-mpegURL"],
    preferredMimeTypes: ["application/x-mpegURL", "video/mp4"],
    preferredDelivery: ["streaming", "progressive"],
    targetWidth: 1920,
    targetHeight: 1080,
    vpaid: false,
    simid: "off",
    omid: true,
  },
  {
    id: "roku-raf",
    label: "Roku RAF",
    summary: "HLS then MP4, no WebM, no VPAID, SIMID off, OM SDK.",
    supportedMimeTypes: ["video/mp4", "application/x-mpegURL"],
    preferredMimeTypes: ["application/x-mpegURL", "video/mp4"],
    preferredDelivery: ["streaming", "progressive"],
    targetWidth: 1920,
    targetHeight: 1080,
    vpaid: false,
    simid: "off",
    omid: true,
  },
  {
    id: "tvos",
    label: "tvOS",
    summary: "AVPlayer: HLS then MP4, no WebM, no VPAID, SIMID 1.1, OM SDK.",
    supportedMimeTypes: ["video/mp4", "application/x-mpegURL"],
    preferredMimeTypes: ["application/x-mpegURL", "video/mp4"],
    preferredDelivery: ["streaming", "progressive"],
    targetWidth: 1920,
    targetHeight: 1080,
    vpaid: false,
    simid: "1.1",
    omid: true,
  },
];

export const DEFAULT_PLAYER_PROFILE_ID = PLAYER_PROFILES[0].id;

export function playerProfileById(id: string): PlayerProfile {
  return PLAYER_PROFILES.find((profile) => profile.id === id) ?? PLAYER_PROFILES[0];
}

export function mediaSelectionOptions(profile: PlayerProfile) {
  return {
    supportedMimeTypes: profile.supportedMimeTypes,
    preferredMimeTypes: profile.preferredMimeTypes,
    preferredDelivery: profile.preferredDelivery,
    targetWidth: profile.targetWidth,
    targetHeight: profile.targetHeight,
    targetBitrate: profile.targetBitrate,
    maxBitrate: profile.maxBitrate,
  };
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

function mediaFileFromElement(el: Element): PlayerMediaFile | null {
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
    bitrate: attr(el, "bitrate") || attr(el, "minBitrate"),
    apiFramework: attr(el, "apiFramework") || null,
    codec: attr(el, "codec") || null,
  };
}

function mediaFileFromResolved(mediaFile: VastResolvedAd["mediaFiles"][number]): PlayerMediaFile {
  return {
    url: mediaFile.url,
    mimeType: mediaFile.mimeType,
    delivery: mediaFile.delivery,
    width: mediaFile.width,
    height: mediaFile.height,
    bitrate: mediaFile.bitrate,
    apiFramework: null,
    codec: null,
  };
}

function mergeMediaFiles(files: PlayerMediaFile[]): PlayerMediaFile[] {
  const seen = new Set<string>();
  const merged: PlayerMediaFile[] = [];
  for (const file of files) {
    const key = `${file.mimeType}|${file.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(file);
  }
  return merged;
}

export function collectPlayerMediaFiles(
  xml: string | null,
  resolvedAds: readonly VastResolvedAd[],
): PlayerMediaFile[] {
  const fromXml: PlayerMediaFile[] = [];
  if (xml) {
    const doc = parseDocument(xml);
    if (doc) {
      for (const node of Array.from(doc.querySelectorAll("Linear MediaFile"))) {
        const file = mediaFileFromElement(node);
        if (file) {
          fromXml.push(file);
        }
      }
    }
  }

  const fromAds = resolvedAds.flatMap((ad) => ad.mediaFiles.map(mediaFileFromResolved));
  return mergeMediaFiles(fromXml.length > 0 ? fromXml : fromAds);
}

function isVpaid(file: PlayerMediaFile): boolean {
  return (file.apiFramework ?? "").toLowerCase() === "vpaid"
    || file.mimeType.toLowerCase() === "application/javascript";
}

function dropReason(profile: PlayerProfile, file: PlayerMediaFile): string | null {
  if (isVpaid(file) && !profile.vpaid) {
    return "VPAID is off on this player.";
  }
  const mime = file.mimeType.trim().toLowerCase();
  const supported = profile.supportedMimeTypes.map((value) => value.toLowerCase());
  if (supported.length > 0 && (!mime || !supported.includes(mime))) {
    return `MIME ${file.mimeType || "(missing)"} is not supported.`;
  }
  return null;
}

function toRankedMediaFile(file: PlayerMediaFile) {
  return {
    url: file.url,
    mimeType: file.mimeType,
    delivery: file.delivery,
    width: file.width,
    height: file.height,
    bitrate: file.bitrate,
  };
}

export function evaluatePlayerMedia(
  profile: PlayerProfile,
  files: readonly PlayerMediaFile[],
): PlayerMediaEvaluation {
  const dropped: PlayerMediaVerdict[] = [];
  const playable: PlayerMediaFile[] = [];
  for (const file of files) {
    const reason = dropReason(profile, file);
    if (reason) {
      dropped.push({ file, status: "dropped", score: null, reasons: [reason] });
      continue;
    }
    playable.push(file);
  }

  const ranked = rankMediaFiles(playable.map(toRankedMediaFile), mediaSelectionOptions(profile));
  const selectedUrl = ranked[0]?.mediaFile.url ?? null;
  const selectedMime = ranked[0]?.mediaFile.mimeType ?? null;
  const scoreByKey = new Map(
    ranked.map((candidate) => [`${candidate.mediaFile.mimeType}|${candidate.mediaFile.url}`, candidate]),
  );

  const playableRows: PlayerMediaVerdict[] = playable.map((file) => {
    const candidate = scoreByKey.get(`${file.mimeType}|${file.url}`);
    const picked = file.url === selectedUrl && file.mimeType === (selectedMime ?? file.mimeType);
    return {
      file,
      status: picked ? "picked" : "playable",
      score: candidate?.score ?? null,
      reasons: candidate?.reasons ?? ["Supported, not the top-ranked file."],
    };
  });

  const selected = playableRows.find((row) => row.status === "picked")?.file ?? null;
  const rows = files.map((file) => {
    const droppedRow = dropped.find((row) => row.file.url === file.url && row.file.mimeType === file.mimeType);
    if (droppedRow) {
      return droppedRow;
    }
    return playableRows.find((row) => row.file.url === file.url && row.file.mimeType === file.mimeType)
      ?? { file, status: "dropped" as const, score: null, reasons: ["Not ranked."] };
  });

  return { selected, rows };
}

export function isStreamingMime(mimeType: string): boolean {
  const mime = mimeType.toLowerCase();
  return mime === "application/x-mpegurl" || mime === "application/dash+xml" || mime === "application/vnd.apple.mpegurl";
}

export function simidVersionForProfile(profile: PlayerProfile): SimidProtocolVersion {
  return profile.simid === "off" ? "1.1" : profile.simid;
}
