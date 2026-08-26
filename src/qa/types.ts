export type OverlayRole = "nonlinear" | "simid-linear" | "simid-nonlinear";
export type OverlayResourceKind = "static" | "iframe" | "html" | "video";
export type OverlayLayout = "overlay" | "stage";

export interface OverlaySurface {
  id: string;
  role: OverlayRole;
  width: string;
  height: string;
  mimeType: string;
  apiFramework: string | null;
  variableDuration: string | null;
  skipoffsetSec: number | null;
  url: string;
  clickThroughUrl: string | null;
  adParameters: string | null;
  resourceKind: OverlayResourceKind;
  layout: OverlayLayout;
  mediaFileUrl: string | null;
}

export interface CreativeSurfaces {
  overlays: OverlaySurface[];
  simid: OverlaySurface[];
  stageVideoUrl: string | null;
}

export type SimidInspectSeverity = "pass" | "warning" | "fail";

export interface SimidInspectFinding {
  id: string;
  severity: SimidInspectSeverity;
  message: string;
}

export interface SimidInspectReport {
  url: string;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  xFrameOptions: string | null;
  csp: string | null;
  redirected: boolean;
  finalUrl: string | null;
  corsBlocked: boolean;
  error: string | null;
  findings: SimidInspectFinding[];
}

export type SimidLogDirection = "in" | "out" | "note";

export interface SimidLogEntry {
  id: string;
  at: string;
  direction: SimidLogDirection;
  type: string;
  detail: string;
  payload?: string;
}

export type SimidHandshakeStep =
  | "idle"
  | "waiting-session"
  | "init"
  | "ready"
  | "started"
  | "stopped"
  | "failed";

export interface SimidDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SimidPlayerMessage {
  sessionId: string;
  messageId: number;
  timestamp: number;
  type: string;
  args: Record<string, unknown>;
}
