import { useEffect, useState } from "react";
import { branding } from "./branding";
import { onSamplesOptChange, samplesOptedOut, setSamplesOptedOut } from "./collectSample";

export function SampleNote() {
  const [optedOut, setOptedOut] = useState(false);

  useEffect(() => {
    setOptedOut(samplesOptedOut());
    return onSamplesOptChange(() => setOptedOut(samplesOptedOut()));
  }, []);

  if (!branding.collectSamples) {
    return null;
  }

  return (
    <p className="sample-note">
      {optedOut
        ? "This browser is not sending tags to vastlint."
        : "Validation still runs in your browser. Tags you paste or fetch may be stored (device IDs and IPs stripped from the XML). Country, network owner, and same-tab grouping may be kept. Built-in samples are not sent. "}
      {branding.privacyUrl ? (
        <a href={branding.privacyUrl} rel="noreferrer" target="_blank">
          Privacy
        </a>
      ) : null}
      {branding.termsUrl ? (
        <>
          {" · "}
          <a href={branding.termsUrl} rel="noreferrer" target="_blank">
            Terms
          </a>
        </>
      ) : null}
      {" · "}
      <button type="button" onClick={() => setSamplesOptedOut(!optedOut)}>
        {optedOut ? "Resume sending tags" : "Don't send my tags"}
      </button>
    </p>
  );
}
