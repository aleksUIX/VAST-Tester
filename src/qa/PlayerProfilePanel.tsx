import {
  PLAYER_PROFILES,
  isStreamingMime,
  type PlayerMediaEvaluation,
  type PlayerProfile,
} from "./playerProfiles";

export function PlayerProfilePanel({
  profile,
  evaluation,
  onProfile,
  compact = false,
}: {
  profile: PlayerProfile;
  evaluation: PlayerMediaEvaluation;
  onProfile: (id: string) => void;
  compact?: boolean;
}) {
  const selected = evaluation.selected;
  const streaming = selected ? isStreamingMime(selected.mimeType) : false;
  const playableCount = evaluation.rows.filter((row) => row.status === "playable").length;
  const rankingLabel = selected
    ? `${selected.mimeType || "media"} picked${playableCount > 0 ? ` · ${String(playableCount)} playable` : ""}`
    : evaluation.rows.length > 0
      ? `${String(evaluation.rows.length)} media files`
      : "No Linear MediaFile entries";

  return (
    <div className={`player-profile-panel${compact ? " is-compact" : ""}`} data-player-profile={profile.id}>
      <div className="omid-panel-head">
        {compact ? null : (
          <div>
            <span className="qa-simid-kicker">Player profile</span>
            <strong data-player-profile-label={profile.id}>{profile.label}</strong>
          </div>
        )}
        <label className="omid-access">
          {compact ? null : "Profile"}
          <select
            aria-label="Player profile"
            onChange={(event) => onProfile(event.target.value)}
            value={profile.id}
          >
            {PLAYER_PROFILES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {compact ? null : <p className="omid-panel-copy">{profile.summary}</p>}
      <div className="omid-event-row">
        <span className="runtime-chip">SIMID {profile.simid}</span>
        <span className="runtime-chip">{profile.omid ? "OM SDK" : "no OM SDK"}</span>
        <span className="runtime-chip">{profile.vpaid ? "VPAID on" : "VPAID off"}</span>
        <span className="pill muted">{profile.targetWidth}x{profile.targetHeight}</span>
      </div>
      {streaming ? (
        <div className="banner">
          This profile picks HLS or DASH. Chromium will not decode it here. The row is the file that player would load.
        </div>
      ) : null}
      {evaluation.rows.length === 0 ? (
        compact ? null : <p className="omid-empty">No Linear MediaFile entries to rank.</p>
      ) : (
        <details className="player-profile-files" open={!compact}>
          <summary>{rankingLabel}</summary>
          <div className="table-surface player-profile-table">
            <div className="table-head player-profile-columns">
              <span>File</span>
              <span>Status</span>
              <span>Why</span>
            </div>
            {evaluation.rows.map((row, index) => (
              <article
                className="table-row player-profile-columns"
                data-player-media-status={row.status}
                data-player-media-type={row.file.mimeType}
                key={`${row.file.mimeType}-${row.file.url}-${String(index)}`}
              >
                <div className="table-cell player-profile-file" data-label="File">
                  <strong>{row.file.mimeType || "(no type)"}</strong>
                  <span className="truncate-url">{row.file.url}</span>
                  <span className="player-profile-file-meta">
                    {[row.file.delivery, row.file.width && row.file.height ? `${row.file.width}x${row.file.height}` : null, row.file.bitrate ? `${row.file.bitrate} kbps` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="table-cell" data-label="Status">
                  <span className={`pill player-media-${row.status}`}>{row.status}</span>
                </div>
                <div className="table-cell row-detail compact" data-label="Why">
                  {row.reasons.map((reason) => (
                    <span key={reason}>{reason}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
