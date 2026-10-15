export type DestinationContract = "generic" | "hosted" | "third_party";
export type DestinationMatch = "any" | "all";
export type DestinationContainer = "mp4" | "mov";
export type DestinationSeverity = "error" | "warning" | "info";

export interface BitrateBound {
  min_kbps?: number;
  max_kbps?: number;
  min_kbps_exclusive?: number;
  max_kbps_exclusive?: number;
}

export interface DestinationResolution {
  width: number;
  height: number;
}

export interface DestinationRendition {
  id: string;
  required?: boolean;
  file_types?: string[];
  container?: DestinationContainer;
  resolutions?: DestinationResolution[];
  min_width?: number;
  min_height?: number;
  aspect_ratio?: "16:9";
  bitrate?: BitrateBound;
  codec_family?: "h264";
  duration_seconds?: number[];
  duration_min_seconds?: number;
  duration_max_seconds?: number;
}

export interface DestinationPackRaw {
  id: string;
  display_name: string;
  summary: string;
  source_level: string;
  docs: string;
  contract: DestinationContract;
  forbid_vpaid?: boolean;
  forbid_qr?: boolean;
  match: DestinationMatch;
  max_files?: number;
  duration_tolerance_sec?: number;
  renditions: DestinationRendition[];
}

export interface DestinationPack extends DestinationPackRaw {
  source_level: "official_vendor";
  forbid_vpaid: boolean;
  forbid_qr: boolean;
  duration_tolerance_sec: number;
}

export interface DestinationFinding {
  id: string;
  severity: DestinationSeverity;
  message: string;
  spec_ref: string;
  path: string;
}

export interface DestinationAssignment {
  rendition_id: string;
  kind: "mediafile" | "mezzanine";
  url: string;
  declared_kbps: number | null;
}

export interface DestinationEvaluation {
  pack: DestinationPack;
  status: "pass" | "fail";
  findings: DestinationFinding[];
  assignments: DestinationAssignment[];
}
