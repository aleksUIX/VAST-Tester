import { branding } from "./branding";

export function ExternalGlyph() {
  return (
    <svg aria-hidden="true" className="external-glyph" focusable="false" viewBox="0 0 12 12">
      <path d="M4.5 1.5h6v6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 1.5 5 7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8.5 9.5h-6v-6h3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function feedbackMailto(subject: string, bodyLines: (string | null)[] = []) {
  if (!branding.feedbackEmail) {
    return null;
  }
  const body = bodyLines.filter((line): line is string => line !== null && line.length > 0).join("\n");
  const query = `subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ""}`;
  return `mailto:${branding.feedbackEmail}?${query}`;
}

export function Masthead() {
  const mailHref = feedbackMailto("VAST Tester feedback");

  return (
    <header className="masthead">
      <div className="masthead-copy">
        <h1>{branding.appTitle}</h1>
        <p className="lede">{branding.lede}</p>
      </div>
      <nav className="masthead-links" aria-label="Reference and feedback">
        {branding.navLinks.map((link) => (
          <a href={link.href} key={link.href} rel="noreferrer noopener" target="_blank">
            {link.label}
            <ExternalGlyph />
          </a>
        ))}
        {mailHref && branding.feedbackEmail ? (
          <a className="masthead-mail" href={mailHref}>
            Email {branding.feedbackEmail}
          </a>
        ) : null}
      </nav>
    </header>
  );
}

export function FindingsFeedback({
  mailto,
}: {
  mailto: string | null;
}) {
  if (!branding.feedbackEmail && !branding.issuesUrl) {
    return null;
  }

  return (
    <p className="findings-feedback">
      A finding look wrong, or a rule need explaining?{" "}
      {mailto && branding.feedbackEmail ? (
        <>
          Email <a href={mailto}>{branding.feedbackEmail}</a> with the tag and the rule ID
          {branding.issuesUrl ? ", or " : "."}
        </>
      ) : null}
      {branding.issuesUrl ? (
        <a href={branding.issuesUrl} rel="noreferrer noopener" target="_blank">
          open a GitHub issue
        </a>
      ) : null}
      {branding.issuesUrl ? "." : null}
    </p>
  );
}

export function AppFooter() {
  return (
    <footer className="app-footer">
      <p>
        IAB Tech Lab VAST Tester. Validate VAST documents, resolve wrappers, and inspect playback, tracking, SIMID, and
        OM SDK behavior.
        {branding.issuesUrl ? (
          <>
            {" "}
            <a href={branding.issuesUrl} rel="noreferrer noopener" target="_blank">
              Report an issue
            </a>
            .
          </>
        ) : null}
      </p>
    </footer>
  );
}

export { feedbackMailto };
