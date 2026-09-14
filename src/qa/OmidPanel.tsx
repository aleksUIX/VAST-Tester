import { OMID_ACCESS_MODES, OMID_REASON_LABELS, type OmidAccessMode, type OmidNotExecutedReason, type OmidSessionSnapshot } from "./omidTypes";
import { formatOmidLogText } from "./omidSession";

function copyText(value: string) {
  void navigator.clipboard.writeText(value).catch(() => undefined);
}

export function OmidPanel({
  snapshot,
  canStart,
  onAccessMode,
  onStart,
  onFinish,
  onError,
  onReject,
}: {
  snapshot: OmidSessionSnapshot;
  canStart: boolean;
  onAccessMode: (mode: OmidAccessMode) => void;
  onStart: () => void;
  onFinish: () => void;
  onError: () => void;
  onReject: (reason: OmidNotExecutedReason) => void;
}) {
  const running = snapshot.status === "running" || snapshot.status === "starting" || snapshot.status === "probing";
  const reasons = Object.keys(OMID_REASON_LABELS) as OmidNotExecutedReason[];

  return (
    <div className="omid-panel" data-omid-session={snapshot.status}>
      <div className="omid-panel-head">
        <div>
          <span className="qa-simid-kicker">OM SDK session</span>
          <strong data-omid-status={snapshot.status}>{snapshot.status}</strong>
          {snapshot.supported == null ? null : (
            <span className="pill muted">{snapshot.supported ? "isSupported" : "not supported"}</span>
          )}
        </div>
        <div className="omid-panel-actions">
          <label className="omid-access">
            Access
            <select
              aria-label="OM SDK access mode"
              onChange={(event) => onAccessMode(event.target.value as OmidAccessMode)}
              value={snapshot.accessMode}
            >
              {OMID_ACCESS_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost" disabled={!canStart || running} onClick={onStart} type="button">
            Start session
          </button>
          <button className="ghost" disabled={snapshot.status !== "running"} onClick={onFinish} type="button">
            Finish
          </button>
          <button className="ghost" disabled={snapshot.status !== "running"} onClick={onError} type="button">
            Session error
          </button>
          {reasons.map((reason) => (
            <button
              className="ghost"
              disabled={snapshot.scripts.length === 0}
              key={reason}
              onClick={() => onReject(reason)}
              type="button"
            >
              REASON {reason}
            </button>
          ))}
        </div>
      </div>
      <p className="omid-panel-copy">
        Loads OM Web, binds omid JavaScriptResource entries, and forwards loaded / impression / media events.
        Scripts that do not run fire verificationNotExecuted with [REASON] 1 load, 2 verify, 3 rejected.
      </p>
      {snapshot.error ? <div className="banner error">{snapshot.error}</div> : null}
      {snapshot.scripts.length === 0 ? (
        <p className="omid-empty">No AdVerifications JavaScriptResource to bind.</p>
      ) : (
        <div className="table-surface omid-script-table">
          <div className="table-head omid-script-columns">
            <span>Vendor</span>
            <span>Status</span>
            <span>Resource</span>
          </div>
          {snapshot.scripts.map((script) => (
            <article className="table-row omid-script-columns" key={script.id}>
              <strong className="table-cell" data-label="Vendor">
                {script.vendor}
              </strong>
              <div className="table-cell" data-label="Status">
                <span className={`pill omid-script-${script.status}`}>{script.status}</span>
                {script.reason ? (
                  <span className="pill muted">REASON {script.reason} · {OMID_REASON_LABELS[script.reason]}</span>
                ) : null}
              </div>
              <div className="table-cell row-detail compact" data-label="Resource">
                <span>{script.apiFramework ?? script.kind}</span>
                <span className="truncate-url">{script.url}</span>
                {script.probeStatus !== null ? <span>probe HTTP {script.probeStatus}</span> : null}
                {script.probeError ? <span>{script.probeError}</span> : null}
                {script.parameters ? <span>params {script.parameters}</span> : null}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="omid-event-row">
        {snapshot.dispatched.length === 0 ? (
          <span className="pill muted">No OM events yet</span>
        ) : (
          snapshot.dispatched.map((name) => (
            <span className="runtime-chip" data-omid-event={name} key={name}>
              {name}
            </span>
          ))
        )}
      </div>
      <div className="omid-log-tools">
        <span className="qa-simid-kicker">Session log</span>
        <button
          className="ghost"
          disabled={snapshot.log.length === 0}
          onClick={() => copyText(formatOmidLogText(snapshot.log))}
          type="button"
        >
          Copy log
        </button>
      </div>
      <ol className="omid-log">
        {snapshot.log.length === 0 ? (
          <li className="omid-log-empty">Prepare the runner to start the session, or start it here.</li>
        ) : (
          snapshot.log.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.type}</strong>
              <span>{entry.detail}</span>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}
