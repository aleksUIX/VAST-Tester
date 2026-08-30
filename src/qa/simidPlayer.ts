import type { OverlaySurface, SimidDimensions, SimidHandshakeStep, SimidLogEntry, SimidPlayerMessage } from "./types";

const CREATE_SESSION = "createSession";
const RESOLVE = "resolve";
const REJECT = "reject";
const PLAYER_INIT = "SIMID:Player:init";
const PLAYER_START = "SIMID:Player:startCreative";
const PLAYER_SKIPPED = "SIMID:Player:adSkipped";
const PLAYER_STOPPED = "SIMID:Player:adStopped";
const PLAYER_FATAL = "SIMID:Player:fatalError";
const PLAYER_LOG = "SIMID:Player:log";
const PLAYER_RESIZE = "SIMID:Player:resize";
const MEDIA_PREFIX = "SIMID:Media:";
const DEFAULT_SKIP_OFFSET_SEC = 5;

export interface SimidHost {
  getVideo(): HTMLVideoElement | null;
  getStageSize(): SimidDimensions;
  getCreativeSize(): SimidDimensions;
  clickThroughUrl: string | null;
  adParameters: string | null;
  skip(): void;
  stop(): void;
  pause(): void;
  play(): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  setFullscreen(on: boolean): void;
  setCreativeSize(size: SimidDimensions | null): void;
}

export interface SimidPlayerCallbacks {
  onLog(entry: Omit<SimidLogEntry, "id" | "at">): void;
  onStep(step: SimidHandshakeStep, detail: string): void;
  onClickThrough(url: string | null): void;
}

function canonicalizeType(type: string): string {
  if (type === "createSession" || type === "resolve" || type === "reject") {
    return type;
  }
  if (type.startsWith("SIMID:")) {
    return type;
  }
  if (type.startsWith("Player:") || type.startsWith("Creative:") || type.startsWith("Media:")) {
    return `SIMID:${type}`;
  }
  return type;
}

function decodeMessage(data: unknown): SimidPlayerMessage | null {
  let parsed: unknown = data;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Partial<SimidPlayerMessage> & { args?: Record<string, unknown> };
  if (typeof record.type !== "string") {
    return null;
  }
  return {
    sessionId: typeof record.sessionId === "string" ? record.sessionId : "",
    messageId: typeof record.messageId === "number" ? record.messageId : 0,
    timestamp: typeof record.timestamp === "number" ? record.timestamp : Date.now(),
    type: canonicalizeType(record.type),
    args: record.args && typeof record.args === "object" ? record.args : {},
  };
}

function asDimensions(value: unknown): SimidDimensions | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const width = Number(record.width);
  const height = Number(record.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: Number.isFinite(Number(record.x)) ? Number(record.x) : 0,
    y: Number.isFinite(Number(record.y)) ? Number(record.y) : 0,
    width,
    height,
  };
}

function trackingUrlsFrom(args: Record<string, unknown>): string[] {
  const raw = Array.isArray(args.trackingUrls)
    ? args.trackingUrls
    : Array.isArray(args.urls)
      ? args.urls
      : [];
  return raw.filter((url): url is string => typeof url === "string" && url.length > 0);
}

export class SimidPlayer {
  private nextMessageId = 0;
  private sessionId: string | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private listener: ((event: MessageEvent) => void) | null = null;
  private started = false;
  private stopped = false;
  private sessionTimer: number | null = null;
  private epoch = 0;
  private startedAt = 0;
  private rejectNext = false;
  private durationOverride: number | null = null;
  private fullscreen = false;
  lastInit: Record<string, unknown> | null = null;
  skipOffsetSec: number;

  get activeSessionId(): string | null {
    return this.sessionId;
  }

  constructor(
    private readonly host: SimidHost,
    private readonly surface: OverlaySurface,
    private readonly callbacks: SimidPlayerCallbacks,
  ) {
    this.skipOffsetSec =
      surface.skipoffsetSec != null && surface.skipoffsetSec >= 0 ? surface.skipoffsetSec : DEFAULT_SKIP_OFFSET_SEC;
  }

  attach(iframe: HTMLIFrameElement) {
    this.detach();
    const epoch = this.epoch;
    this.iframe = iframe;
    this.listener = (event: MessageEvent) => this.onMessage(event);
    window.addEventListener("message", this.listener);
    this.callbacks.onStep("waiting-session", "Waiting for createSession from the creative.");
    this.sessionTimer = window.setTimeout(() => {
      if (epoch !== this.epoch) {
        return;
      }
      if (!this.sessionId && !this.stopped) {
        this.callbacks.onStep("failed", "Timed out waiting for createSession.");
      }
    }, 8000);
  }

  detach() {
    this.epoch += 1;
    if (this.listener) {
      window.removeEventListener("message", this.listener);
      this.listener = null;
    }
    if (this.sessionTimer !== null) {
      window.clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    this.iframe = null;
    this.sessionId = null;
    this.started = false;
    this.stopped = false;
    this.nextMessageId = 0;
    this.startedAt = 0;
    this.rejectNext = false;
    this.durationOverride = null;
    this.fullscreen = false;
    this.lastInit = null;
  }

  startCreative() {
    if (!this.sessionId || this.started || this.stopped) {
      return;
    }
    this.started = true;
    this.startedAt = Date.now();
    this.send(PLAYER_START, {});
    this.callbacks.onStep("started", "Sent SIMID:Player:startCreative.");
    const video = this.host.getVideo();
    if (!video) {
      this.sendMedia("play", this.mediaState());
    } else if (video.paused) {
      this.host.play();
    } else {
      this.sendMedia("play", this.mediaState());
    }
  }

  skip() {
    if (!this.sessionId || this.stopped) {
      return;
    }
    this.send(PLAYER_SKIPPED, {});
    this.finish("stopped", "Sent SIMID:Player:adSkipped.");
  }

  stop(code = 0) {
    if (!this.sessionId || this.stopped) {
      return;
    }
    this.send(PLAYER_STOPPED, { code });
    this.finish("stopped", "Sent SIMID:Player:adStopped.");
  }

  fatal(errorCode: number, message: string) {
    this.host.pause();
    this.send(PLAYER_FATAL, { errorCode, message });
    this.finish("failed", message);
  }

  sendLog(message: string) {
    this.send(PLAYER_LOG, { message });
  }

  sendResize() {
    if (!this.sessionId || this.stopped) {
      return;
    }
    this.send(PLAYER_RESIZE, {
      videoDimensions: this.host.getStageSize(),
      creativeDimensions: this.host.getCreativeSize(),
      fullscreen: this.fullscreen,
    });
  }

  sendMedia(event: string, args: Record<string, unknown> = {}) {
    if (!this.sessionId || this.stopped) {
      return;
    }
    this.send(`${MEDIA_PREFIX}${event}`, { ...this.mediaState(), ...args });
  }

  armRejectNext() {
    this.rejectNext = true;
  }

  allowSkipNow() {
    if (this.started && !this.stopped) {
      this.startedAt = 0;
    }
  }

  get advertisedDuration(): number | null {
    return this.durationOverride;
  }

  bumpDuration(deltaSec: number) {
    const current = Number(this.mediaState().duration);
    const next = Math.max(1, (Number.isFinite(current) && current > 0 ? current : 20) + deltaSec);
    this.durationOverride = next;
    const video = this.host.getVideo();
    if (video) {
      video.loop = true;
    }
    this.sendMedia("durationchange", this.mediaState());
  }

  setHostFullscreen(on: boolean) {
    this.fullscreen = on;
    this.host.setFullscreen(on);
    this.sendResize();
  }

  expandCreative() {
    this.host.setCreativeSize(this.host.getStageSize());
    this.sendResize();
  }

  collapseCreative() {
    const stage = this.host.getStageSize();
    const width = Number(this.surface.width);
    const height = Number(this.surface.height);
    const overlayHeight = Number.isFinite(height) && height > 0 ? height : 90;
    const overlayWidth = Number.isFinite(width) && width > 0 ? Math.min(width, stage.width) : stage.width;
    this.host.setCreativeSize({
      x: 0,
      y: Math.max(0, stage.height - overlayHeight),
      width: overlayWidth,
      height: overlayHeight,
    });
    this.sendResize();
  }

  fireClickThrough() {
    const url = this.host.clickThroughUrl ?? this.surface.clickThroughUrl;
    this.host.pause();
    this.callbacks.onClickThrough(url);
    this.callbacks.onLog({
      direction: "note",
      type: "SIMID:Creative:clickThru",
      detail: url ?? "no click-through URL",
      payload: url ?? "",
    });
  }

  skipRemainingSec() {
    if (!this.started || this.stopped) {
      return this.skipOffsetSec;
    }
    const elapsed = (Date.now() - this.startedAt) / 1000;
    return Math.max(0, this.skipOffsetSec - elapsed);
  }

  private finish(step: SimidHandshakeStep, detail: string) {
    this.stopped = true;
    this.callbacks.onStep(step, detail);
  }

  private onMessage(event: MessageEvent) {
    if (this.iframe && event.source !== this.iframe.contentWindow) {
      return;
    }
    const message = decodeMessage(event.data);
    if (!message) {
      return;
    }
    if (message.type === RESOLVE || message.type === REJECT) {
      return;
    }

    this.log("in", message.type, summarize(message.args), stringifyArgs(message.args));

    if (message.type === CREATE_SESSION) {
      this.sessionId = message.sessionId;
      if (this.sessionTimer !== null) {
        window.clearTimeout(this.sessionTimer);
        this.sessionTimer = null;
      }
      this.resolve(message);
      this.sendInit();
      return;
    }

    if (!this.sessionId || message.sessionId !== this.sessionId) {
      return;
    }

    this.handleCreative(message);
  }

  private handleCreative(message: SimidPlayerMessage) {
    const type = message.type;
    const args = message.args ?? {};

    if (this.rejectNext && type.startsWith("SIMID:Creative:request")) {
      this.rejectNext = false;
      this.reject(message, 2, "Operator rejected this request.");
      return;
    }

    switch (type) {
      case "SIMID:Creative:clickThru":
      case "SIMID:Creative:clickThrough":
      case "SIMID:Creative:requestNavigation":
        this.handleClickThru(message, args);
        break;
      case "SIMID:Creative:getMediaState":
        this.resolve(message, this.mediaState());
        break;
      case "SIMID:Creative:requestPause":
        this.host.pause();
        this.resolve(message);
        break;
      case "SIMID:Creative:requestPlay":
        this.host.play();
        this.resolve(message);
        break;
      case "SIMID:Creative:requestSkip":
        this.handleRequestSkip(message);
        break;
      case "SIMID:Creative:requestStop":
        this.resolve(message);
        this.stop();
        this.host.stop();
        break;
      case "SIMID:Creative:requestChangeVolume":
      case "SIMID:Creative:requestVolume": {
        const muted = Boolean(args.muted);
        const volume = typeof args.volume === "number" ? args.volume : muted ? 0 : 1;
        this.host.setMuted(muted || volume === 0);
        this.host.setVolume(volume);
        this.resolve(message);
        break;
      }
      case "SIMID:Creative:expandNonlinear":
        this.host.setCreativeSize(this.host.getStageSize());
        this.resolve(message);
        this.sendResize();
        break;
      case "SIMID:Creative:collapseNonlinear": {
        const stage = this.host.getStageSize();
        const width = Number(this.surface.width);
        const height = Number(this.surface.height);
        const overlayHeight = Number.isFinite(height) && height > 0 ? height : 90;
        const overlayWidth = Number.isFinite(width) && width > 0 ? Math.min(width, stage.width) : stage.width;
        this.host.setCreativeSize({
          x: 0,
          y: Math.max(0, stage.height - overlayHeight),
          width: overlayWidth,
          height: overlayHeight,
        });
        this.resolve(message);
        this.sendResize();
        break;
      }
      case "SIMID:Creative:requestFullScreen":
      case "SIMID:Creative:requestFullscreen":
        this.fullscreen = true;
        this.host.setFullscreen(true);
        this.resolve(message);
        this.sendResize();
        break;
      case "SIMID:Creative:requestExitFullscreen":
      case "SIMID:Creative:requestExitFullScreen":
        this.fullscreen = false;
        this.host.setFullscreen(false);
        this.resolve(message);
        this.sendResize();
        break;
      case "SIMID:Creative:requestResize": {
        const creative =
          asDimensions(args.creativeDimensions) ??
          asDimensions(args.mediaDimensions) ??
          asDimensions(args);
        this.host.setCreativeSize(creative);
        this.resolve(message);
        this.sendResize();
        this.callbacks.onLog({
          direction: "note",
          type,
          detail: creative ? `${String(creative.width)}x${String(creative.height)}` : "no dimensions",
          payload: stringifyArgs(args),
        });
        break;
      }
      case "SIMID:Creative:requestChangeAdDuration": {
        const duration = Number(args.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
          this.reject(message, 1, "duration must be a positive number.");
          break;
        }
        if (this.surface.variableDuration !== "true") {
          this.reject(message, 2, "variableDuration is not allowed for this creative.");
          break;
        }
        this.durationOverride = duration;
        this.resolve(message);
        this.sendMedia("durationchange", this.mediaState());
        break;
      }
      case "SIMID:Creative:reportTracking": {
        const urls = trackingUrlsFrom(args);
        this.resolve(message);
        this.callbacks.onLog({
          direction: "note",
          type,
          detail: urls.length > 0 ? urls.join(" ") : "no URLs",
          payload: urls.join("\n"),
        });
        break;
      }
      case "SIMID:Creative:log":
        this.callbacks.onLog({
          direction: "in",
          type,
          detail: String(args.message ?? ""),
          payload: stringifyArgs(args),
        });
        break;
      case "SIMID:Creative:fatalError":
        this.resolve(message);
        this.finish("failed", String(args.message ?? args.errorMessage ?? "Creative fatalError"));
        break;
      default:
        this.reject(message, 400, `Unsupported message ${type}`);
        break;
    }
  }

  private handleClickThru(message: SimidPlayerMessage, args: Record<string, unknown>) {
    this.resolve(message);
    this.host.pause();
    const playerHandlesRaw = args.playerHandles ?? args.playerHandles;
    const playerHandles = playerHandlesRaw !== false && playerHandlesRaw !== 0;
    const url =
      (typeof args.url === "string" && args.url.length > 0 ? args.url : null) ??
      (typeof args.uri === "string" && args.uri.length > 0 ? args.uri : null) ??
      this.host.clickThroughUrl ??
      this.surface.clickThroughUrl;
    if (!playerHandles) {
      this.callbacks.onLog({
        direction: "note",
        type: message.type,
        detail: "Creative handles navigation.",
        payload: stringifyArgs(args),
      });
      return;
    }
    this.callbacks.onClickThrough(url);
    this.callbacks.onLog({
      direction: "note",
      type: message.type,
      detail: url ?? "no click-through URL",
      payload: url ?? stringifyArgs(args),
    });
  }

  private handleRequestSkip(message: SimidPlayerMessage) {
    const remaining = this.skipRemainingSec();
    if (remaining > 0) {
      this.reject(message, 2, `Skip not allowed for ${remaining.toFixed(1)}s (skipoffset ${String(this.skipOffsetSec)}s).`);
      return;
    }
    this.resolve(message);
    this.skip();
    this.host.skip();
  }

  private sendInit() {
    const stage = this.host.getStageSize();
    const video = this.host.getVideo();
    const duration = this.durationOverride ?? (video && Number.isFinite(video.duration) ? video.duration : 20);
    const clickThru = this.host.clickThroughUrl ?? this.surface.clickThroughUrl ?? "";
    const environmentData = {
      videoDimensions: stage,
      creativeDimensions: stage,
      fullscreen: false,
      fullscreenAllowed: true,
      variableDurationAllowed: this.surface.variableDuration === "true",
      skippable: true,
      skippableState: "playerHandles",
      skipoffset: this.skipOffsetSec,
      version: "1.1",
      siteId: "iab-tech-lab-vast-tester",
      siteUrl: typeof location === "object" ? location.host : "",
      appId: "",
      muted: video?.muted ?? true,
      volume: video?.volume ?? 1,
      navigationSupport: "undetermined",
      closeButton: false,
    };
    const creativeData = {
      adParameters: this.surface.adParameters ?? this.host.adParameters ?? "",
      duration,
      clickThruUrl: clickThru,
      clickThroughUrl: clickThru,
    };
    const initArgs = {
      environmentData,
      creativeData,
    };
    this.lastInit = initArgs;
    this.send(PLAYER_INIT, initArgs);
    this.callbacks.onStep("init", "Sent SIMID:Player:init.");
    this.callbacks.onStep("ready", "Session established. Waiting to start the creative.");
  }

  private mediaState(): Record<string, unknown> {
    const video = this.host.getVideo();
    const duration = this.durationOverride ?? (video && Number.isFinite(video.duration) ? video.duration : 0);
    return {
      currentTime: video?.currentTime ?? 0,
      duration,
      muted: video?.muted ?? true,
      volume: video?.volume ?? 1,
      paused: video?.paused ?? false,
      ended: video?.ended ?? false,
      currentSrc: video?.currentSrc ?? "",
      fullscreen: this.fullscreen,
    };
  }

  private resolve(incoming: SimidPlayerMessage, value: Record<string, unknown> = {}) {
    this.send(RESOLVE, {
      messageId: incoming.messageId,
      value,
    });
  }

  private reject(incoming: SimidPlayerMessage, errorCode: number, message: string) {
    this.send(REJECT, {
      messageId: incoming.messageId,
      value: { errorCode, message },
    });
    this.callbacks.onLog({
      direction: "note",
      type: incoming.type,
      detail: `Rejected (${String(errorCode)}): ${message}`,
      payload: JSON.stringify({ errorCode, message }),
    });
  }

  private send(type: string, args: Record<string, unknown>) {
    const target = this.iframe?.contentWindow;
    if (!target) {
      return;
    }
    const message: SimidPlayerMessage = {
      sessionId: this.sessionId ?? "",
      messageId: this.nextMessageId,
      timestamp: Date.now(),
      type,
      args,
    };
    this.nextMessageId += 1;
    target.postMessage(JSON.stringify(message), "*");
    if (type !== RESOLVE && type !== REJECT && type !== `${MEDIA_PREFIX}timeupdate`) {
      this.log("out", type, summarize(args), stringifyArgs(args));
    }
  }

  private log(direction: SimidLogEntry["direction"], type: string, detail: string, payload?: string) {
    this.callbacks.onLog({ direction, type, detail, payload });
  }
}

function stringifyArgs(args: Record<string, unknown> | undefined): string {
  try {
    return JSON.stringify(args ?? {}, null, 2);
  } catch {
    return "";
  }
}

function summarize(args: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(args);
    return json.length > 180 ? `${json.slice(0, 177)}...` : json;
  } catch {
    return "";
  }
}
