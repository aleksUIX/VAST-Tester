import {
  DESTINATION_GROUPS,
  DESTINATION_PACKS,
  NONE_DESTINATION_ID,
  packsForContract,
  type DestinationEvaluation,
} from "./index";

export function DestinationSelect({
  packId,
  onPack,
  compact = false,
}: {
  packId: string;
  onPack: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <label className={compact ? "omid-access" : "destination-select"}>
      {compact ? null : "Pack"}
      <select aria-label="Destination pack" onChange={(event) => onPack(event.target.value)} value={packId}>
        <option value={NONE_DESTINATION_ID}>None (spec only)</option>
        {DESTINATION_GROUPS.map((group) => (
          <optgroup key={group.contract} label={group.label}>
            {packsForContract(group.contract).map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.display_name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function DestinationPanel({
  packId,
  evaluation,
  onPack,
  compact = false,
}: {
  packId: string;
  evaluation: DestinationEvaluation | null;
  onPack: (id: string) => void;
  compact?: boolean;
}) {
  const pack = evaluation?.pack ?? DESTINATION_PACKS.find((item) => item.id === packId) ?? null;
  const status = evaluation?.status ?? (packId === NONE_DESTINATION_ID ? "idle" : "pass");

  return (
    <div
      className={`player-profile-panel destination-panel${compact ? " is-compact" : ""}`}
      data-destination-pack={packId}
      data-destination-status={status}
    >
      <div className="omid-panel-head">
        {compact ? null : (
          <div>
            <span className="qa-simid-kicker">Destination</span>
            <strong data-destination-label={packId}>{pack?.display_name ?? "None"}</strong>
          </div>
        )}
        <DestinationSelect compact={compact} onPack={onPack} packId={packId} />
      </div>
      {compact ? null : pack ? (
        <p className="omid-panel-copy">
          {pack.summary} Cited: {pack.docs.replace(/^https:\/\//, "")}. Not a publisher cert.
        </p>
      ) : (
        <p className="omid-panel-copy">No destination selected. Spec rules and player profiles stay as they are.</p>
      )}
      {evaluation && evaluation.assignments.length > 0 ? (
        <p className="omid-panel-copy" data-destination-assignments>
          {evaluation.assignments.map((item) => (
            `${item.rendition_id} ← ${item.kind === "mezzanine" ? "Mezzanine" : "MediaFile"}${item.declared_kbps !== null ? ` ${String(Math.round(item.declared_kbps))} kbps` : ""}`
          )).join(" · ")}
        </p>
      ) : null}
      {evaluation && evaluation.findings.length > 0 ? (
        <div className="table-surface player-profile-table">
          <div className="table-head destination-columns">
            <span>Rule</span>
            <span>Detail</span>
          </div>
          {evaluation.findings.map((item) => (
            <article className="table-row destination-columns" data-dest-rule={item.id} key={`${item.id}-${item.path}`}>
              <div className="table-cell" data-label="Rule">
                <span className="chip">{item.severity}</span>
                <strong data-dest-rule-id={item.id}>{item.id}</strong>
              </div>
              <div className="table-cell row-detail compact" data-label="Detail">
                <span>{item.message}</span>
                <span>{item.path}</span>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {evaluation && evaluation.findings.length === 0 && pack ? (
        <p className="omid-empty">Declared MediaFiles meet this pack. Auction eligibility is still the publisher's call.</p>
      ) : null}
    </div>
  );
}
