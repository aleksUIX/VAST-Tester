import { useEffect, useState } from "react";
import { onSamplesOptChange, samplesOptedOut, setSamplesOptedOut } from "./collectSample";

export function SampleNote() {
  const [optedOut, setOptedOut] = useState(false);

  useEffect(() => {
    setOptedOut(samplesOptedOut());
    return onSamplesOptChange(() => setOptedOut(samplesOptedOut()));
  }, []);

  return (
    <p className="sample-note">
      {optedOut
        ? "This browser is not sending tags to vastlint."
        : "Validation still runs in your browser. Tags you paste or fetch may be stored (device IDs and IPs stripped from the XML). Country, network owner, and same-tab grouping may be kept. Built-in samples are not sent. "}
      <a href="https://vastlint.org/privacy/" rel="noreferrer" target="_blank">
        Privacy
      </a>
      {" · "}
      <a href="https://vastlint.org/terms/" rel="noreferrer" target="_blank">
        Terms
      </a>
      {" · "}
      <button type="button" onClick={() => setSamplesOptedOut(!optedOut)}>
        {optedOut ? "Resume sending tags" : "Don't send my tags"}
      </button>
    </p>
  );
}
