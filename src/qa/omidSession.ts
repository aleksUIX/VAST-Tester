import { branding } from "../branding";
import {
  omidScriptsToInject,
  probeOmidScript,
  resolveOmidScriptUrl,
} from "./parseVerifications";
import type {
  OmidAccessMode,
  OmidLogEntry,
  OmidNotExecutedReason,
  OmidScript,
  OmidSessionSnapshot,
  OmidSessionStatus,
} from "./omidTypes";

interface OmidVastProperties {
  isSkippable: boolean;
  skipOffset: number;
  isAutoPlay: boolean;
  position: string;
}

interface OmidContext {
  underEvaluation: boolean;
  setVideoElement(element: HTMLVideoElement): void;
  setServiceWindow(serviceWindow: Window): void;
}

interface OmidAdSession {
  isSupported(): boolean;
  start(): void;
  finish(): void;
  error(type: string, message: string): void;
  setCreativeType(type: string): void;
  setImpressionType(type: string): void;
  registerSessionObserver(callback: (event: OmidObserverEvent) => void): void;
}

interface OmidAdEvents {
  loaded(properties: unknown): void;
  impressionOccurred(): void;
}

interface OmidMediaEvents {
  start(duration: number, volume: number): void;
  firstQuartile(): void;
  midpoint(): void;
  thirdQuartile(): void;
  complete(): void;
  pause(): void;
  resume(): void;
  skipped(): void;
  volumeChange(volume: number): void;
}

interface OmidSdk {
  Partner: new (name: string, version: string) => unknown;
  VerificationScriptResource: new (
    url: string,
    vendor?: string | null,
    parameters?: string | null,
    accessMode?: string,
  ) => unknown;
  Context: new (partner: unknown, resources: unknown[], contentUrl?: string | null) => OmidContext;
  AdSession: new (context: OmidContext) => OmidAdSession;
  AdEvents: new (session: OmidAdSession) => OmidAdEvents;
  MediaEvents: new (session: OmidAdSession) => OmidMediaEvents;
  VastProperties: new (
    isSkippable: boolean,
    skipOffset: number,
    isAutoPlay: boolean,
    position: string,
  ) => unknown;
}

interface OmidObserverEvent {
  type?: string;
  timestamp?: number;
  data?: unknown;
}

interface OmidServiceWindow extends Window {
  OmidSessionClient?: { default?: OmidSdk } & Record<string, OmidSdk | undefined>;
}

export interface OmidHostOptions {
  accessMode: OmidAccessMode;
  scripts: OmidScript[];
  video: HTMLVideoElement;
  skipOffsetSec: number | null;
  macros: Record<string, string>;
  onChange(snapshot: OmidSessionSnapshot): void;
}

const PARTNER_NAME = branding.omidPartnerName;
const PARTNER_VERSION = "0.1.0";
const SESSION_TIMEOUT_MS = 8000;

function nowIso(): string {
  return new Date().toISOString();
}

function expandMacros(url: string, macros: Record<string, string>): string {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(macros)) {
    values[key.toUpperCase()] = String(value);
  }
  return url.replace(/\[([A-Z0-9_]+)\]|%%([A-Z0-9_]+)%%/gi, (match, bracketName, legacyName) => {
    const key = String(bracketName ?? legacyName ?? "").toUpperCase();
    const replacement = values[key];
    return replacement === undefined ? match : encodeURIComponent(replacement);
  });
}

function sdkScriptUrl(file: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return new URL(`fixtures/omid/${file}`, `${globalThis.location.origin}${base.endsWith("/") ? base : `${base}/`}`).href;
}

function readSdk(serviceWindow: Window): OmidSdk | null {
  const client = (serviceWindow as OmidServiceWindow).OmidSessionClient;
  if (!client) {
    return null;
  }
  return client.default ?? client["1.3.17-iab2651"] ?? Object.values(client).find((value) => value && typeof value === "object" && "AdSession" in value) ?? null;
}

function waitForSdk(serviceWindow: Window): Promise<OmidSdk | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + 4000;
    const tick = () => {
      const sdk = readSdk(serviceWindow);
      if (sdk) {
        resolve(sdk);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(null);
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

export class OmidSessionHost {
  private epoch = 0;
  private iframe: HTMLIFrameElement | null = null;
  private adSession: OmidAdSession | null = null;
  private adEvents: OmidAdEvents | null = null;
  private mediaEvents: OmidMediaEvents | null = null;
  private vastPropertiesCtor: OmidSdk["VastProperties"] | null = null;
  private ready = false;
  private pending: Array<() => void> = [];
  private dispatched = new Set<string>();
  private notExecutedFired = new Set<string>();
  private log: OmidLogEntry[] = [];
  private logSeq = 0;
  private scripts: OmidScript[] = [];
  private status: OmidSessionStatus = "idle";
  private supported: boolean | null = null;
  private error: string | null = null;
  private sessionTimer: number | null = null;

  constructor(private readonly options: OmidHostOptions) {
    this.scripts = options.scripts.map((script) => ({ ...script }));
  }

  get snapshot(): OmidSessionSnapshot {
    return {
      status: this.status,
      accessMode: this.options.accessMode,
      supported: this.supported,
      scripts: this.scripts.map((script) => ({ ...script })),
      dispatched: [...this.dispatched],
      log: [...this.log],
      error: this.error,
    };
  }

  async start(): Promise<void> {
    this.reset();
    const epoch = this.epoch;
    this.scripts = this.options.scripts.map((script) => ({ ...script }));
    this.dispatched.clear();
    this.notExecutedFired.clear();
    this.log = [];
    this.error = null;
    this.supported = null;
    this.setStatus("probing");

    this.scripts = await Promise.all(this.scripts.map((script) => probeOmidScript(script)));
    this.publish();
    if (epoch !== this.epoch) {
      return;
    }

    for (const script of this.scripts) {
      if (script.status === "not-executed" && script.reason) {
        await this.fireNotExecuted(script, script.reason);
      }
    }

    const injectable = omidScriptsToInject(this.scripts);
    if (injectable.length === 0) {
      this.fail("No injectable omid JavaScriptResource. Fired verificationNotExecuted where the probe failed.");
      return;
    }

    this.setStatus("starting");
    try {
      const serviceWindow = await this.mountSdkIframe();
      if (epoch !== this.epoch) {
        return;
      }
      const sdk = await waitForSdk(serviceWindow);
      if (epoch !== this.epoch) {
        return;
      }
      if (!sdk) {
        this.fail("OM SDK session client did not load in the service iframe.");
        await this.markAll("2", "OM SDK did not load.");
        return;
      }

      const resources = injectable.map((script) =>
        new sdk.VerificationScriptResource(
          resolveOmidScriptUrl(script.url),
          script.vendor,
          script.parameters,
          this.options.accessMode,
        ),
      );
      const partner = new sdk.Partner(PARTNER_NAME, PARTNER_VERSION);
      const context = new sdk.Context(partner, resources, globalThis.location.href);
      context.underEvaluation = true;
      context.setVideoElement(this.options.video);
      context.setServiceWindow(serviceWindow);

      const adSession = new sdk.AdSession(context);
      this.adSession = adSession;
      this.vastPropertiesCtor = sdk.VastProperties;
      this.supported = adSession.isSupported();
      if (!this.supported) {
        this.fail("AdSession.isSupported() is false. OM Web is not reachable from this page.");
        await this.markAll("2", "OM SDK is not supported in this player.");
        return;
      }

      adSession.setCreativeType("video");
      adSession.setImpressionType("beginToRender");
      adSession.registerSessionObserver((event) => this.onObserverEvent(event, epoch));
      this.adEvents = new sdk.AdEvents(adSession);
      this.mediaEvents = new sdk.MediaEvents(adSession);
      adSession.start();
      this.note("session", "Called AdSession.start(). Waiting for sessionStart.");
      this.sessionTimer = window.setTimeout(() => {
        if (epoch !== this.epoch || this.ready) {
          return;
        }
        void this.onSessionTimeout();
      }, SESSION_TIMEOUT_MS);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      await this.markAll("2", this.error ?? "Session failed.");
    }
  }

  tearDown() {
    this.reset();
  }

  private reset() {
    this.epoch += 1;
    this.ready = false;
    this.pending = [];
    this.adEvents = null;
    this.mediaEvents = null;
    this.adSession = null;
    this.vastPropertiesCtor = null;
    if (this.sessionTimer !== null) {
      window.clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    if (this.iframe?.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
    this.iframe = null;
    if (this.status === "running" || this.status === "starting" || this.status === "probing") {
      this.status = "idle";
    }
  }

  finish() {
    this.runWhenReady(() => {
      this.adSession?.finish();
      this.markDispatched("sessionFinish");
      this.status = "finished";
      this.note("sessionFinish", "Called AdSession.finish().");
    });
  }

  signalLoaded(properties?: Partial<OmidVastProperties>) {
    this.runWhenReady(() => {
      if (!this.adEvents || !this.vastPropertiesCtor || this.dispatched.has("loaded")) {
        return;
      }
      const skipOffset = properties?.skipOffset ?? this.options.skipOffsetSec ?? 0;
      const vastProperties = new this.vastPropertiesCtor(
        properties?.isSkippable ?? skipOffset > 0,
        skipOffset,
        properties?.isAutoPlay ?? true,
        properties?.position ?? "standalone",
      );
      this.adEvents.loaded(vastProperties);
      this.markDispatched("loaded");
      this.note("loaded", "AdEvents.loaded(VastProperties).");
    });
  }

  signalImpression() {
    this.runWhenReady(() => {
      if (!this.adEvents || this.dispatched.has("impression")) {
        return;
      }
      this.adEvents.impressionOccurred();
      this.markDispatched("impression");
      this.note("impression", "AdEvents.impressionOccurred().");
    });
  }

  signalStart(duration: number, volume: number) {
    this.runWhenReady(() => {
      if (!this.mediaEvents || this.dispatched.has("start")) {
        return;
      }
      const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
      const safeVolume = Math.min(1, Math.max(0, volume));
      this.mediaEvents.start(safeDuration, safeVolume);
      this.markDispatched("start");
      this.note("start", `MediaEvents.start(${safeDuration.toFixed(1)}s, volume ${safeVolume.toFixed(2)}).`);
    });
  }

  signalQuartile(name: "firstQuartile" | "midpoint" | "thirdQuartile" | "complete") {
    this.runWhenReady(() => {
      if (!this.mediaEvents || this.dispatched.has(name)) {
        return;
      }
      this.mediaEvents[name]();
      this.markDispatched(name);
      this.note(name, `MediaEvents.${name}().`);
    });
  }

  signalPause() {
    this.runWhenReady(() => {
      if (!this.mediaEvents || this.dispatched.has("skipped") || this.dispatched.has("complete")) {
        return;
      }
      this.mediaEvents.pause();
      this.note("pause", "MediaEvents.pause().");
    });
  }

  signalResume() {
    this.runWhenReady(() => {
      if (!this.mediaEvents || this.dispatched.has("skipped") || this.dispatched.has("complete")) {
        return;
      }
      this.mediaEvents.resume();
      this.note("resume", "MediaEvents.resume().");
    });
  }

  signalSkip() {
    this.runWhenReady(() => {
      if (!this.mediaEvents || this.dispatched.has("skipped")) {
        return;
      }
      this.mediaEvents.skipped();
      this.markDispatched("skipped");
      this.note("skipped", "MediaEvents.skipped().");
    });
  }

  signalVolume(volume: number) {
    this.runWhenReady(() => {
      if (!this.mediaEvents) {
        return;
      }
      const safeVolume = Math.min(1, Math.max(0, volume));
      this.mediaEvents.volumeChange(safeVolume);
      this.note("volumeChange", `MediaEvents.volumeChange(${safeVolume.toFixed(2)}).`);
    });
  }

  signalError(message: string) {
    this.runWhenReady(() => {
      if (!this.adSession) {
        return;
      }
      this.adSession.error("video", message);
      this.markDispatched("error");
      this.note("error", message);
    });
  }

  async rejectAll(reason: OmidNotExecutedReason) {
    for (const script of this.scripts) {
      script.status = "not-executed";
      script.reason = reason;
    }
    this.note("verificationNotExecuted", `Operator rejected verification (REASON ${reason}).`);
    this.fail(`Operator rejected verification (REASON ${reason}).`);
    this.publish();
  }

  private async onSessionTimeout() {
    this.fail("Timed out waiting for sessionStart.");
    await this.markAll("2", "sessionStart never arrived.");
  }

  private async markAll(reason: OmidNotExecutedReason, detail: string) {
    for (const script of this.scripts) {
      if (script.status === "injected" || script.status === "not-executed") {
        continue;
      }
      script.status = "not-executed";
      script.reason = reason;
      script.probeError = script.probeError ?? detail;
      await this.fireNotExecuted(script, reason);
    }
    this.publish();
  }

  async fireNotExecuted(script: OmidScript, reason: OmidNotExecutedReason) {
    const fireKey = `${script.id}:${reason}`;
    if (this.notExecutedFired.has(fireKey)) {
      return;
    }
    this.notExecutedFired.add(fireKey);
    script.status = "not-executed";
    script.reason = reason;
    const macros = { ...this.options.macros, REASON: reason };
    const urls = script.notExecutedUrls.length > 0 ? script.notExecutedUrls : [];
    if (urls.length === 0) {
      this.note("verificationNotExecuted", `${script.vendor}: REASON ${reason}, no tracking URL.`);
      this.publish();
      return;
    }

    await Promise.all(urls.map(async (url) => {
      const expanded = expandMacros(url, macros);
      try {
        await fetch(expanded, { method: "GET", mode: "no-cors", cache: "no-store" });
        this.note("verificationNotExecuted", `${script.vendor}: REASON ${reason} → ${expanded}`);
      } catch (error) {
        this.note("verificationNotExecuted", `${script.vendor}: fire failed (${error instanceof Error ? error.message : String(error)})`);
      }
    }));
    this.publish();
  }

  private onObserverEvent(event: OmidObserverEvent, epoch: number) {
    if (epoch !== this.epoch) {
      return;
    }
    const type = typeof event.type === "string" ? event.type : "observer";
    this.note(type, summarizeObserver(event));
    if (type === "sessionStart") {
      this.onSessionStart();
    }
    if (type === "sessionError") {
      this.error = summarizeObserver(event);
      this.status = "failed";
      this.publish();
    }
    if (type === "sessionFinish") {
      this.status = "finished";
      this.publish();
    }
  }

  private onSessionStart() {
    if (this.sessionTimer !== null) {
      window.clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    this.ready = true;
    this.status = "running";
    this.scripts = this.scripts.map((script) =>
      script.status === "injectable" || script.status === "opaque"
        ? { ...script, status: "injected" }
        : script,
    );
    this.note("sessionStart", "OM SDK session is running.");
    const queued = [...this.pending];
    this.pending = [];
    for (const task of queued) {
      this.safe(task);
    }
    this.publish();
  }

  private runWhenReady(task: () => void) {
    if (this.ready) {
      this.safe(task);
      this.publish();
      return;
    }
    this.pending.push(task);
  }

  private safe(task: () => void) {
    try {
      task();
    } catch (error) {
      this.note("error", error instanceof Error ? error.message : String(error));
    }
  }

  private markDispatched(name: string) {
    this.dispatched.add(name);
  }

  private fail(message: string) {
    this.status = "failed";
    this.error = message;
    this.note("failed", message);
    this.publish();
  }

  private setStatus(status: OmidSessionStatus) {
    this.status = status;
    this.publish();
  }

  private note(type: string, detail: string) {
    this.logSeq += 1;
    this.log = [
      {
        id: `omid-${String(this.logSeq)}`,
        at: nowIso(),
        type,
        detail,
      },
      ...this.log,
    ].slice(0, 40);
    this.publish();
  }

  private publish() {
    this.options.onChange(this.snapshot);
  }

  private mountSdkIframe(): Promise<Window> {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.title = "OM SDK service";
      iframe.setAttribute("aria-hidden", "true");
      iframe.sandbox.add("allow-scripts", "allow-same-origin");
      iframe.style.display = "none";
      iframe.srcdoc = [
        `<script src="${sdkScriptUrl("omweb-v1.js")}"></script>`,
        `<script src="${sdkScriptUrl("omid-session-client-v1.js")}"></script>`,
      ].join("");
      iframe.addEventListener("load", () => {
        const serviceWindow = iframe.contentWindow;
        if (!serviceWindow) {
          reject(new Error("OM SDK iframe has no contentWindow."));
          return;
        }
        resolve(serviceWindow);
      });
      iframe.addEventListener("error", () => {
        reject(new Error("OM SDK iframe failed to load."));
      });
      this.iframe = iframe;
      document.body.appendChild(iframe);
    });
  }
}

function summarizeObserver(event: OmidObserverEvent): string {
  try {
    return JSON.stringify(event.data ?? { type: event.type }).slice(0, 280);
  } catch {
    return String(event.type ?? "observer");
  }
}

export function formatOmidLogText(log: readonly OmidLogEntry[]): string {
  return log
    .slice()
    .reverse()
    .map((entry) => `${entry.at} ${entry.type} ${entry.detail}`)
    .join("\n");
}
