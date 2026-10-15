import { useState } from "react";

export function SimidStudioGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className={`simid-guide${open ? " is-open" : ""}`} data-simid-guide={open ? "open" : "closed"}>
      <button
        aria-controls="simid-studio-guide"
        aria-expanded={open}
        className="simid-guide-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="simid-guide-copy">
          <strong>Learn how to test a SIMID session.</strong>
          <span>Prepare a creative, inspect its protocol messages and share the result.</span>
        </span>
        <span className="simid-guide-action">{open ? "Close guide" : "Show guide"}</span>
      </button>
      {open ? (
        <ol className="simid-guide-steps" id="simid-studio-guide">
          <li>Choose a SIMID preset from the scenario library, or paste your tag and validate it.</li>
          <li>Open the playback section and prepare the runner. Resolve wrappers first when the creative is behind a wrapper.</li>
          <li>The host waits for the creative to accept initialization before starting. Read the protocol log for messages and rejected requests.</li>
          <li>Use the playback controls to inspect interactions. Copy the session JSON to share the diagnosis.</li>
        </ol>
      ) : null}
    </div>
  );
}
