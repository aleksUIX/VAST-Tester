export type OmidAccessMode = "full" | "limited" | "domain";

export type OmidSessionStatus =
  | "idle"
  | "probing"
  | "starting"
  | "running"
  | "finished"
  | "failed";

export type OmidScriptStatus = "pending" | "injectable" | "injected" | "not-executed" | "opaque";

/** VAST verificationNotExecuted [REASON] codes. */
export type OmidNotExecutedReason = "1" | "2" | "3";

export const OMID_REASON_LABELS: Record<OmidNotExecutedReason, string> = {
  "1": "Could not load",
  "2": "Could not verify",
  "3": "Rejected",
};

export const OMID_ACCESS_MODES: ReadonlyArray<{ id: OmidAccessMode; label: string }> = [
  { id: "full", label: "full" },
  { id: "limited", label: "limited" },
  { id: "domain", label: "domain" },
];

export interface OmidScript {
  id: string;
  vendor: string;
  url: string;
  apiFramework: string | null;
  kind: "javascript" | "executable";
  browserOptional: string | null;
  parameters: string | null;
  notExecutedUrls: string[];
  status: OmidScriptStatus;
  probeStatus: number | null;
  probeType: string | null;
  probeError: string | null;
  reason: OmidNotExecutedReason | null;
}

export interface OmidLogEntry {
  id: string;
  at: string;
  type: string;
  detail: string;
}

export interface OmidSessionSnapshot {
  status: OmidSessionStatus;
  accessMode: OmidAccessMode;
  supported: boolean | null;
  scripts: OmidScript[];
  dispatched: string[];
  log: OmidLogEntry[];
  error: string | null;
}

export function emptyOmidSnapshot(accessMode: OmidAccessMode = "full"): OmidSessionSnapshot {
  return {
    status: "idle",
    accessMode,
    supported: null,
    scripts: [],
    dispatched: [],
    log: [],
    error: null,
  };
}
