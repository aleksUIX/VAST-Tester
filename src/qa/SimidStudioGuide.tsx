import { useEffect, useRef, useState } from "react";

function guideUrl(file: string) {
  const base = import.meta.env.BASE_URL ?? "/";
  return `${base}fixtures/guides/${file}`;
}

export function SimidStudioGuide() {
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const poster = guideUrl("simid-studio-desktop.jpg");
  const src = guideUrl("simid-studio-desktop.mp4");

  useEffect(() => {
    const video = videoRef.current;
    if (!open || !video) {
      return;
    }
    video.scrollIntoView({ behavior: "smooth", block: "nearest" });
    void video.play().catch(() => undefined);
  }, [open]);

  return (
    <div className={`simid-guide${open ? " is-open" : ""}`} data-simid-guide={open ? "open" : "closed"}>
      <button
        aria-controls="simid-studio-guide-player"
        aria-expanded={open}
        className="simid-guide-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="simid-guide-thumb-wrap">
          <img alt="" className="simid-guide-thumb" height={72} src={poster} width={128} />
        </span>
        <span className="simid-guide-copy">
          <strong>Learn more about SIMID studio</strong>
          <span>70s walkthrough of a live session</span>
        </span>
        <span className="simid-guide-action">{open ? "Close" : "Watch"}</span>
      </button>
      {open ? (
        <div className="simid-guide-player" id="simid-studio-guide-player">
          <video
            controls
            playsInline
            poster={poster}
            preload="auto"
            ref={videoRef}
            src={src}
          />
        </div>
      ) : null}
    </div>
  );
}
