import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { primarySimidSurface, staticOverlays } from "./parseCreativeSurfaces";
import { resolveQaAssetUrl } from "./resolveQaAssetUrl";
import {
  diagnoseSimidSession,
  formatSimidDiagnosis,
  formatSimidLogText,
  formatSimidSessionJson,
  type SimidHealthReport,
} from "./simidHealth";
import { inspectSimidCreative } from "./simidInspect";
import { SimidPlayer } from "./simidPlayer";
import type {
  CreativeSurfaces,
  OverlaySurface,
  SimidDimensions,
  SimidHandshakeStep,
  SimidInspectReport,
  SimidLogEntry,
} from "./types";

export interface OverlayHostActions {
  skip(): void;
  stop(): void;
  pause(): void;
  play(): void;
  seek(seconds: number): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
}

export interface SimidCommands {
  skip(): void;
  stop(): void;
}

interface OverlayStageProps {
  surfaces: CreativeSurfaces;
  videoRef: RefObject<HTMLVideoElement | null>;
  mediaUrl: string | null;
  clickThroughUrl: string | null;
  actions: OverlayHostActions;
  onSimidLog: (title: string, detail: string) => void;
  keepLogVisible?: boolean;
  studioExpanded?: boolean;
  commandsRef?: RefObject<SimidCommands | null>;
  children?: ReactNode;
}

type LogFilter = "all" | "in" | "out" | "note";

interface MediaClock {
  currentTime: number;
  duration: number;
  paused: boolean;
  muted: boolean;
  volume: number;
}

function formatDeckClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes)}:${String(rest).padStart(2, "0")}`;
}

function copyText(value: string) {
  void navigator.clipboard.writeText(value).catch(() => undefined);
}

function formatLogClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString(undefined, { hour12: false });
}

function logLineText(entry: SimidLogEntry): string {
  const body = entry.payload && entry.payload.length > 0 ? entry.payload : entry.detail;
  return `${entry.at} ${entry.direction} ${entry.type}\n${body}`;
}

function shortMessageType(type: string): string {
  return type.replace(/^SIMID:/, "");
}

function SimidHealthDeck({
  report,
  log,
  inspect,
  lastInit,
  surface,
  creativeUrl,
  urlDraft,
  urlSwapped,
  copied,
  onCopy,
  onUrlDraft,
  onApplyUrl,
  onResetUrl,
}: {
  report: SimidHealthReport;
  log: SimidLogEntry[];
  inspect: SimidInspectReport | null;
  lastInit: Record<string, unknown> | null;
  surface: OverlaySurface;
  creativeUrl: string | null;
  urlDraft: string;
  urlSwapped: boolean;
  copied: string | null;
  onCopy: (value: string, label: string) => void;
  onUrlDraft: (value: string) => void;
  onApplyUrl: () => void;
  onResetUrl: () => void;
}) {
  const sessionJson = formatSimidSessionJson({
    report,
    log,
    inspect,
    lastInit,
    surface,
    creativeUrl,
  });
  const initJson = lastInit ? JSON.stringify(lastInit, null, 2) : "";

  return (
    <section className="qa-simid-health" data-simid-health="true" data-simid-health-status={report.status}>
      <div className="qa-simid-health-head">
        <strong className="qa-simid-title">{report.headline}</strong>
        <span className="qa-copy-status" aria-live="polite">
          {copied ?? ""}
        </span>
        <button className="ghost" onClick={() => onCopy(formatSimidDiagnosis(report), "Diagnosis copied")} type="button">
          Copy diagnosis
        </button>
        <button className="ghost" onClick={() => onCopy(sessionJson, "Session copied")} type="button">
          Copy session
        </button>
        <button className="ghost" disabled={!initJson} onClick={() => onCopy(initJson, "Init copied")} type="button">
          Copy init
        </button>
      </div>
      <dl className="qa-simid-facts">
        {report.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>
              <button
                className="qa-copy-value"
                onClick={() => onCopy(fact.value, `${fact.label} copied`)}
                title={fact.value}
                type="button"
              >
                {fact.value}
              </button>
            </dd>
          </div>
        ))}
      </dl>
      {report.heals.length === 0 && report.status === "healthy" ? (
        <p className="qa-simid-health-ok">Handshake looks healthy. No heals.</p>
      ) : null}
      {report.heals.length > 0 ? (
        <ul className="qa-simid-heals">
          {report.heals.map((heal) => (
            <li className={`qa-simid-heal-${heal.severity}`} key={heal.id}>
              <button
                className="qa-copy-heal"
                onClick={() => onCopy(`${heal.title}\n${heal.fix}`, "Heal copied")}
                title="Copy heal"
                type="button"
              >
                <strong>{heal.title}</strong>
                <span>{heal.fix}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {report.trackingUrls.length > 0 ? (
        <ul className="qa-simid-tracking" data-simid-tracking="true">
          {report.trackingUrls.map((url) => (
            <li key={url}>
              <button className="qa-copy-value" onClick={() => onCopy(url, "URL copied")} title="Copy tracking URL" type="button">
                {url}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <details className="qa-simid-more">
        <summary>Coverage</summary>
        <ul className="qa-simid-coverage">
          {report.coverage.map((item) => (
            <li className={item.seen ? "is-seen" : undefined} key={item.type} title={item.side}>
              {item.type.replace("SIMID:Creative:", "").replace("SIMID:Player:", "Player:")}
            </li>
          ))}
        </ul>
      </details>
      <details className="qa-simid-more">
        <summary>Load another creative</summary>
        <form
          className="qa-simid-swap"
          onSubmit={(event) => {
            event.preventDefault();
            onApplyUrl();
          }}
        >
          <input
            aria-label="SIMID creative URL"
            onChange={(event) => onUrlDraft(event.target.value)}
            placeholder="Paste a live SIMID HTML URL"
            type="url"
            value={urlDraft}
          />
          <button className="ghost" type="submit">
            Load URL
          </button>
          {urlSwapped ? (
            <button className="ghost" onClick={onResetUrl} type="button">
              Use VAST URL
            </button>
          ) : null}
        </form>
      </details>
    </section>
  );
}

let logCounter = 0;

export function OverlayStage({
  surfaces,
  videoRef,
  mediaUrl,
  clickThroughUrl,
  actions,
  onSimidLog,
  keepLogVisible = false,
  studioExpanded = false,
  commandsRef,
  children,
}: OverlayStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<SimidPlayer | null>(null);
  const actionsRef = useRef(actions);
  const onLogRef = useRef(onSimidLog);
  const clickThroughRef = useRef(clickThroughUrl);
  const simidLiveRef = useRef<OverlaySurface | null>(null);
  const autoStartRef = useRef(true);
  const creativeSizeRef = useRef<SimidDimensions | null>(null);
  const [step, setStep] = useState<SimidHandshakeStep>("idle");
  const [log, setLog] = useState<SimidLogEntry[]>([]);
  const [sessionKey, setSessionKey] = useState(0);
  const [autoStart, setAutoStart] = useState(true);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const [rejectArmed, setRejectArmed] = useState(false);
  const [skipLeft, setSkipLeft] = useState(5);
  const [simidFullscreen, setSimidFullscreen] = useState(false);
  const [creativeSize, setCreativeSize] = useState<SimidDimensions | null>(null);
  const [clickThroughUrlOpen, setClickThroughUrl] = useState<string | null>(null);
  const [appliedCreativeUrl, setAppliedCreativeUrl] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [inspect, setInspect] = useState<SimidInspectReport | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const [clock, setClock] = useState<MediaClock>({
    currentTime: 0,
    duration: 0,
    paused: true,
    muted: true,
    volume: 1,
  });
  const simid = primarySimidSurface(surfaces);
  const banners = staticOverlays(surfaces);
  const stageBanners = banners.filter((banner) => banner.layout === "stage");
  const overlayBanners = banners.filter((banner) => banner.layout !== "stage");
  const simidSrc = resolveQaAssetUrl(appliedCreativeUrl ?? simid?.url ?? null);
  const simidId = simid?.id ?? null;
  const showContent = !mediaUrl && stageBanners.length === 0 && !simidSrc;

  actionsRef.current = actions;
  onLogRef.current = onSimidLog;
  clickThroughRef.current = clickThroughUrl;
  simidLiveRef.current = simid;
  autoStartRef.current = autoStart;
  creativeSizeRef.current = creativeSize;

  const copyNotice = (value: string, label: string) => {
    copyText(value);
    setCopied(label);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(null), 1400);
  };

  if (commandsRef) {
    commandsRef.current = {
      skip: () => playerRef.current?.skip(),
      stop: () => playerRef.current?.stop(),
    };
  }

  useEffect(() => {
    const iframe = iframeRef.current;
    const surface = simidLiveRef.current;
    if (!iframe || !surface || !simidSrc) {
      playerRef.current?.detach();
      playerRef.current = null;
      setStep("idle");
      setLog([]);
      return;
    }

    const appendLog = (entry: Omit<SimidLogEntry, "id" | "at">) => {
      logCounter += 1;
      const next: SimidLogEntry = {
        id: `simid-${String(logCounter)}`,
        at: new Date().toISOString(),
        ...entry,
      };
      setLog((current) => [next, ...current].slice(0, 200));
      if (entry.type !== "SIMID:Media:timeupdate") {
        onLogRef.current(`simid:${entry.type}`, entry.detail);
      }
    };

    setLog([]);
    setIframeLoaded(false);
    const hostActions = () => actionsRef.current;
    const player = new SimidPlayer(
      {
        getVideo: () => videoRef.current,
        getStageSize: () => {
          const box = stageRef.current?.getBoundingClientRect();
          return { x: 0, y: 0, width: Math.round(box?.width ?? 640), height: Math.round(box?.height ?? 360) };
        },
        getCreativeSize: () => {
          return (
            creativeSizeRef.current ?? {
              x: 0,
              y: 0,
              width: Math.round(stageRef.current?.getBoundingClientRect().width ?? 640),
              height: Math.round(stageRef.current?.getBoundingClientRect().height ?? 360),
            }
          );
        },
        get clickThroughUrl() {
          return clickThroughRef.current;
        },
        get adParameters() {
          return simidLiveRef.current?.adParameters ?? null;
        },
        skip: () => hostActions().skip(),
        stop: () => hostActions().stop(),
        pause: () => videoRef.current?.pause(),
        play: () => void videoRef.current?.play()?.catch(() => undefined),
        setMuted: (muted) => {
          if (videoRef.current) {
            videoRef.current.muted = muted;
          }
          hostActions().setMuted(muted);
        },
        setVolume: (volume) => {
          if (videoRef.current) {
            videoRef.current.volume = Math.min(1, Math.max(0, volume));
          }
          hostActions().setVolume(volume);
        },
        setFullscreen: (on) => {
          setSimidFullscreen(on);
          const node = stageRef.current;
          if (!node) {
            return;
          }
          if (on) {
            void node.requestFullscreen?.().catch(() => undefined);
          } else if (document.fullscreenElement === node) {
            void document.exitFullscreen?.().catch(() => undefined);
          }
        },
        setCreativeSize: (size) => {
          if (!size || size.width < 8 || size.height < 8) {
            setCreativeSize(null);
            return;
          }
          setCreativeSize(size);
        },
      },
      surface,
      {
        onLog: appendLog,
        onStep: (next, detail) => {
          setStep(next);
          onLogRef.current(`simid:${next}`, detail);
          if (next === "ready" && autoStartRef.current) {
            window.setTimeout(() => {
              if (autoStartRef.current) {
                player.startCreative();
              }
            }, 80);
          }
        },
        onClickThrough: (url) => {
          setClickThroughUrl(url);
          if (url) {
            window.open(url, "_blank", "noreferrer,noopener");
          }
        },
      },
    );

    playerRef.current = player;
    player.attach(iframe);
    iframe.src = simidSrc;
    const resizeObserver = new ResizeObserver(() => player.sendResize());
    if (stageRef.current) {
      resizeObserver.observe(stageRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      player.detach();
      iframe.removeAttribute("src");
      setCreativeSize(null);
      setSimidFullscreen(false);
      setRejectArmed(false);
      setClickThroughUrl(null);
      if (playerRef.current === player) {
        playerRef.current = null;
      }
    };
  }, [sessionKey, simidId, simidSrc, videoRef]);

  useEffect(() => {
    setAppliedCreativeUrl(null);
    setUrlDraft("");
  }, [simidId, simid?.url]);

  useEffect(() => {
    if (!simidSrc) {
      setInspect(null);
      return;
    }
    let cancelled = false;
    void inspectSimidCreative(simidSrc).then((report) => {
      if (!cancelled) {
        setInspect(report);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [simidSrc]);

  useEffect(() => {
    const video = videoRef.current;
    const player = playerRef.current;
    if (!video || !player) {
      return;
    }

    const syncClock = () => {
      setClock({
        currentTime: video.currentTime,
        duration: player.advertisedDuration ?? (Number.isFinite(video.duration) ? video.duration : 0),
        paused: video.paused,
        muted: video.muted,
        volume: video.volume,
      });
    };
    const onTime = () => {
      syncClock();
      player.sendMedia("timeupdate", { currentTime: video.currentTime, duration: video.duration });
    };
    const onPlay = () => {
      syncClock();
      player.sendMedia("play", { currentTime: video.currentTime });
    };
    const onPause = () => {
      syncClock();
      player.sendMedia("pause", { currentTime: video.currentTime });
    };
    const onEnded = () => {
      syncClock();
      player.sendMedia("ended", {});
      const advertised = player.advertisedDuration;
      const mediaDuration = Number.isFinite(video.duration) ? video.duration : 0;
      if (advertised != null && advertised > mediaDuration + 0.2) {
        return;
      }
      player.stop();
    };
    const onVolume = () => {
      syncClock();
      player.sendMedia("volumechange", { volume: video.volume, muted: video.muted });
    };
    const onDuration = () => {
      syncClock();
      player.sendMedia("durationchange", { duration: video.duration });
    };
    const onSeeking = () => player.sendMedia("seeking", { currentTime: video.currentTime });
    const onSeeked = () => player.sendMedia("seeked", { currentTime: video.currentTime });

    syncClock();
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("seeked", onSeeked);

    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [mediaUrl, sessionKey, simidSrc, videoRef]);

  useEffect(() => {
    if (step !== "started") {
      return;
    }
    const id = window.setInterval(() => {
      setSkipLeft(playerRef.current?.skipRemainingSec() ?? 0);
    }, 250);
    return () => window.clearInterval(id);
  }, [step]);

  useEffect(() => {
    const onFullscreen = () => {
      const on = document.fullscreenElement === stageRef.current;
      setSimidFullscreen(on);
      playerRef.current?.sendResize();
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(() => {
    if (!studioExpanded || !simidSrc) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("button, input, textarea, select, a, [contenteditable='true']")) {
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        if (clock.paused) {
          actionsRef.current.play();
        } else {
          actionsRef.current.pause();
        }
      }
      if (event.key === "m" || event.key === "M") {
        actionsRef.current.setMuted(!clock.muted);
      }
      if (event.key === "s" || event.key === "S") {
        if (step === "started") {
          playerRef.current?.skip();
          actionsRef.current.skip();
        }
      }
      if (event.key === "ArrowRight") {
        actionsRef.current.seek(clock.currentTime + 5);
      }
      if (event.key === "ArrowLeft") {
        actionsRef.current.seek(Math.max(0, clock.currentTime - 5));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock.currentTime, clock.muted, clock.paused, simidSrc, step, studioExpanded]);

  const visibleLog = logFilter === "all" ? log : log.filter((entry) => entry.direction === logFilter);
  const health = simid
    ? diagnoseSimidSession({
        step,
        log,
        surface: simid,
        inspect,
        sessionId: playerRef.current?.activeSessionId ?? null,
        iframeLoaded,
        autoStart,
        clickThroughUrl: clickThroughUrl ?? simid.clickThroughUrl,
        skipOffsetSec: playerRef.current?.skipOffsetSec ?? simid.skipoffsetSec ?? 5,
        skipLeft,
        muted: clock.muted,
        creativeSize,
        creativeUrl: simidSrc,
        urlSwapped: Boolean(appliedCreativeUrl),
      })
    : null;

  return (
    <div className="qa-stage-stack">
      <div
        className={`qa-stage${simidFullscreen ? " is-simid-fullscreen" : ""}`}
        data-qa-stage="overlay"
        ref={stageRef}
      >
        {children}
        {showContent ? <div className="qa-stage-content">Content</div> : null}
        {[...stageBanners, ...overlayBanners].map((banner) => {
          const src = resolveQaAssetUrl(banner.url);
          if (!src) {
            return null;
          }
          return (
            <a
              className={banner.layout === "stage" ? "qa-overlay-static is-stage" : "qa-overlay-static"}
              data-overlay-layout={banner.layout}
              href={banner.clickThroughUrl ?? undefined}
              key={banner.id}
              rel="noreferrer noopener"
              target="_blank"
              title={banner.layout === "stage" ? "NonLinear stage creative" : "NonLinear overlay"}
            >
              <img alt={banner.layout === "stage" ? "NonLinear stage creative" : "NonLinear overlay"} src={src} />
            </a>
          );
        })}
        {simidSrc ? (
          <iframe
            className={`qa-overlay-simid${creativeSize ? " is-resized" : ""}`}
            data-simid-iframe="true"
            key={`${simidSrc}:${String(sessionKey)}`}
            ref={iframeRef}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allow="fullscreen"
            onLoad={() => setIframeLoaded(true)}
            style={
              creativeSize
                ? {
                    left: creativeSize.x,
                    top: creativeSize.y,
                    width: creativeSize.width,
                    height: creativeSize.height,
                  }
                : undefined
            }
            title="SIMID creative"
          />
        ) : null}
      </div>
      {simid ? (
        <div className="qa-simid-transport" data-simid-transport="true">
          <div className="qa-simid-transport-row">
            <span className="qa-simid-kicker">Media</span>
            <span className="qa-simid-status" data-simid-step={step}>
              {step.replace("-", " ")}
            </span>
            <span className="qa-simid-clock">
              {formatDeckClock(clock.currentTime)} / {formatDeckClock(clock.duration)}
            </span>
            <button className={clock.paused ? "secondary" : "ghost"} onClick={() => actions.play()} type="button">
              Play
            </button>
            <button className="ghost" onClick={() => actions.pause()} type="button">
              Pause
            </button>
            <button className="ghost" onClick={() => actions.seek(Math.max(0, clock.currentTime - 5))} type="button">
              -5s
            </button>
            <button className="ghost" onClick={() => actions.seek(clock.currentTime + 5)} type="button">
              +5s
            </button>
            <button className="ghost" onClick={() => actions.setMuted(!clock.muted)} type="button">
              {clock.muted ? "Unmute" : "Mute"}
            </button>
            <details className="qa-simid-more">
              <summary>More</summary>
              <div className="qa-simid-more-body">
                <input
                  aria-label="Volume"
                  className="qa-simid-volume"
                  max={1}
                  min={0}
                  onChange={(event) => {
                    const volume = Number(event.target.value);
                    actions.setVolume(volume);
                    if (volume > 0) {
                      actions.setMuted(false);
                    }
                  }}
                  step="0.05"
                  type="range"
                  value={clock.muted ? 0 : clock.volume}
                />
                <button
                  className="ghost"
                  onClick={() => {
                    if (step !== "started") {
                      return;
                    }
                    playerRef.current?.skip();
                    actions.skip();
                  }}
                  type="button"
                >
                  Skip creative
                </button>
                <button
                  className="ghost"
                  onClick={() => {
                    if (step !== "started") {
                      return;
                    }
                    playerRef.current?.stop();
                    actions.stop();
                  }}
                  type="button"
                >
                  Stop creative
                </button>
                <button className="ghost" onClick={() => setSessionKey((value) => value + 1)} type="button">
                  Reload creative
                </button>
              </div>
            </details>
          </div>
          <div className="qa-simid-transport-row">
            <input
              aria-label="Seek"
              className="qa-simid-seek"
              max={clock.duration || 0}
              min={0}
              onChange={(event) => actions.seek(Number(event.target.value))}
              step="0.1"
              type="range"
              value={clock.currentTime}
            />
          </div>
        </div>
      ) : null}
      {simid ? (
        <details
          className="qa-simid-protocol"
          data-simid-protocol="true"
          {...(studioExpanded ? { open: true } : {})}
        >
          <summary>
            <span className="qa-simid-kicker">Simulate</span>
            <label
              className="qa-simid-check"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <input
                checked={autoStart}
                onChange={(event) => setAutoStart(event.target.checked)}
                type="checkbox"
              />
              Auto-start
            </label>
            <span className="qa-simid-skipoffset">
              skipoffset {playerRef.current?.skipOffsetSec ?? 5}s
              {step === "started" && skipLeft > 0 ? ` · ${skipLeft.toFixed(0)}s left` : step === "started" ? " · skip open" : ""}
            </span>
          </summary>
          <div className="qa-simid-protocol-body">
          <button className="ghost" disabled={step !== "ready"} onClick={() => playerRef.current?.startCreative()} type="button">
            Start creative
          </button>
          <button
            className="ghost"
            onClick={() => {
              playerRef.current?.armRejectNext();
              setRejectArmed(true);
            }}
            type="button"
          >
            {rejectArmed ? "Next request will reject" : "Reject next request"}
          </button>
          <button className="ghost" onClick={() => playerRef.current?.sendResize()} type="button">
            Send resize
          </button>
          <button className="ghost" onClick={() => playerRef.current?.expandCreative()} type="button">
            Expand overlay
          </button>
          <button className="ghost" onClick={() => playerRef.current?.collapseCreative()} type="button">
            Collapse overlay
          </button>
          <button className="ghost" onClick={() => playerRef.current?.setHostFullscreen(!simidFullscreen)} type="button">
            {simidFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>
          <button className="ghost" onClick={() => playerRef.current?.bumpDuration(10)} type="button">
            Duration +10s
          </button>
          <button className="ghost" onClick={() => playerRef.current?.allowSkipNow()} type="button">
            Allow skip now
          </button>
          <button className="ghost" onClick={() => playerRef.current?.sendMedia("stalled")} type="button">
            Stalled
          </button>
          <button className="ghost" onClick={() => playerRef.current?.sendMedia("playing")} type="button">
            Playing
          </button>
          <button
            className="ghost"
            onClick={() => playerRef.current?.sendMedia("error", { code: 4, message: "Operator injected a media error." })}
            type="button"
          >
            Media error
          </button>
          <button className="ghost" onClick={() => playerRef.current?.sendLog("Workshop note from the player.")} type="button">
            Send log
          </button>
          <button className="ghost" onClick={() => playerRef.current?.fireClickThrough()} type="button">
            Fire click-through
          </button>
          <button
            className="ghost"
            onClick={() => playerRef.current?.fatal(1100, "Operator sent a fatal error.")}
            type="button"
          >
            Fatal error
          </button>
          {clickThroughUrlOpen ? (
            <a className="qa-simid-clickthrough" href={clickThroughUrlOpen} rel="noreferrer noopener" target="_blank">
              Open clickthrough
            </a>
          ) : null}
          </div>
        </details>
      ) : null}
      {simid && health ? (
        <div className="qa-simid-side">
          <SimidHealthDeck
            copied={copied}
            creativeUrl={simidSrc}
            inspect={inspect}
            lastInit={playerRef.current?.lastInit ?? null}
            log={log}
            onApplyUrl={() => {
              const next = urlDraft.trim();
              if (!next) {
                return;
              }
              setAppliedCreativeUrl(next);
              setSessionKey((value) => value + 1);
            }}
            onCopy={copyNotice}
            onResetUrl={() => {
              setAppliedCreativeUrl(null);
              setUrlDraft("");
              setSessionKey((value) => value + 1);
            }}
            onUrlDraft={setUrlDraft}
            report={health}
            surface={simid}
            urlDraft={urlDraft}
            urlSwapped={Boolean(appliedCreativeUrl)}
          />
          <div className={`qa-simid-log-col${studioExpanded || keepLogVisible ? " is-tall" : ""}`}>
            <div className="qa-simid-log-tools">
              <span className="qa-simid-kicker">Protocol log</span>
              {(["all", "in", "out", "note"] as const).map((filter) => (
                <button
                  className={logFilter === filter ? "ghost is-active" : "ghost"}
                  key={filter}
                  onClick={() => setLogFilter(filter)}
                  type="button"
                >
                  {filter === "in" ? "Creative" : filter === "out" ? "Player" : filter === "note" ? "Notes" : "All"}
                </button>
              ))}
              <button
                className="ghost"
                disabled={log.length === 0}
                onClick={() => copyNotice(formatSimidLogText(log), "Log copied")}
                type="button"
              >
                Copy log
              </button>
              <button
                className="ghost"
                disabled={visibleLog.length === 0}
                onClick={() => {
                  const latest = visibleLog[0];
                  if (latest) {
                    copyNotice(logLineText(latest), "Line copied");
                  }
                }}
                type="button"
              >
                Copy last
              </button>
            </div>
            <ol className="qa-simid-log" data-simid-log="true">
              {visibleLog.length === 0 ? (
                <li className="qa-simid-log-note">
                  <strong>Waiting</strong>
                  <span>createSession has not arrived yet.</span>
                </li>
              ) : null}
              {visibleLog.map((entry) => (
                <li className={`qa-simid-log-${entry.direction}`} key={entry.id}>
                  <div className="qa-simid-log-line">
                    <time>{formatLogClock(entry.at)}</time>
                    <strong title={entry.type}>{shortMessageType(entry.type)}</strong>
                    <button
                      className="ghost qa-simid-log-copy"
                      onClick={() => copyNotice(logLineText(entry), "Line copied")}
                      type="button"
                    >
                      Copy
                    </button>
                  </div>
                  <span>{entry.detail}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SimidInspectPanel({
  surfaces,
  onExpandStudio,
}: {
  surfaces: CreativeSurfaces;
  onExpandStudio?: () => void;
}) {
  const [reports, setReports] = useState<Record<string, SimidInspectReport>>({});
  const [pending, setPending] = useState<string | null>(null);

  const runInspect = async (surface: OverlaySurface) => {
    const url = resolveQaAssetUrl(surface.url);
    if (!url) {
      return;
    }
    setPending(surface.id);
    try {
      const report = await inspectSimidCreative(url);
      setReports((current) => ({ ...current, [surface.id]: report }));
    } finally {
      setPending(null);
    }
  };

  useEffect(() => {
    const first = surfaces.simid[0];
    if (first) {
      void runInspect(first);
    }
  }, [surfaces.simid.map((surface) => surface.id).join("|")]);

  if (surfaces.overlays.length === 0) {
    return null;
  }

  return (
    <div className="qa-inspect" data-qa="simid-inspect">
      {onExpandStudio && surfaces.simid.length > 0 ? (
        <div className="qa-inspect-actions">
          <button className="secondary" onClick={onExpandStudio} type="button">
            Expand SIMID studio
          </button>
        </div>
      ) : null}
      <div className="preview-grid">
        {surfaces.overlays.map((surface) => {
          const src = resolveQaAssetUrl(surface.url);
          const report = reports[surface.id];
          return (
            <article className="preview-card" key={surface.id}>
              <div className="preview-header">
                <div>
                  <span className="section-label">{surface.role === "nonlinear" ? "Overlay" : "SIMID"}</span>
                  <h3>{surface.mimeType || surface.resourceKind}</h3>
                </div>
                <span className="runtime-chip muted-chip">
                  {surface.width && surface.height ? `${surface.width} x ${surface.height}` : surface.apiFramework ?? surface.resourceKind}
                </span>
              </div>
              <div className="preview-frame">
                {surface.resourceKind === "static" && src ? (
                  <img alt="Overlay preview" className="preview-image" src={src} />
                ) : src ? (
                  <code className="preview-code">{src}</code>
                ) : (
                  <div className="preview-empty">No previewable resource.</div>
                )}
              </div>
              <ul className="qa-inspect-facts">
                <li>apiFramework {surface.apiFramework ?? "none"}</li>
                <li>variableDuration {surface.variableDuration ?? "unset"}</li>
                <li>skipoffset {surface.skipoffsetSec == null ? "n/a" : `${String(surface.skipoffsetSec)}s`}</li>
                <li>ClickThrough {surface.clickThroughUrl ?? "missing"}</li>
                {surface.adParameters ? (
                  <li>
                    AdParameters{" "}
                    {surface.adParameters.length > 80 ? `${surface.adParameters.slice(0, 77)}...` : surface.adParameters}
                  </li>
                ) : null}
              </ul>
              {surface.role !== "nonlinear" ? (
                <div className="qa-inspect-actions">
                  <button
                    className="ghost"
                    disabled={pending === surface.id}
                    onClick={() => void runInspect(surface)}
                    type="button"
                  >
                    {pending === surface.id ? "Inspecting…" : "Inspect fetch"}
                  </button>
                </div>
              ) : null}
              {report ? (
                <ul className="qa-inspect-findings">
                  <li>
                    HTTP {report.status ?? "n/a"} · {report.contentType ?? "no type"}
                    {report.corsBlocked ? " · CORS blocked" : ""}
                  </li>
                  {report.findings.map((finding) => (
                    <li className={`qa-inspect-${finding.severity}`} key={finding.id}>
                      {finding.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
