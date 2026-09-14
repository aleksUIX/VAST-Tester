export interface BrandNavLink {
  href: string;
  label: string;
}

export interface Branding {
  appTitle: string;
  lede: string;
  navLinks: readonly BrandNavLink[];
  feedbackEmail: string | null;
  issuesUrl: string | null;
  discussionsUrl: string | null;
  ruleDocsBase: string | null;
  commonErrorsUrl: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  collectSamples: boolean;
  sampleEndpoint: string | null;
  vastProxyEndpoint: string | null;
  scenarioFallbackOrigin: string | null;
  fixtureHosts: readonly string[];
  omidPartnerName: string;
  ruleDocsUrl(ruleId: string): string | null;
}

export const branding: Branding = {
  appTitle: "IAB-style VAST tester",
  lede:
    "SIMID studio and IAB sample creatives. Independent vastlint-powered rebuild of the legacy IAB Tech Lab VAST Tester. Not affiliated with IAB Tech Lab, and not the official IAB VAST Tag Validator. Validation, deterministic repair, wrapper inspection, playback and tracking QA, and partner-shareable reports across VAST 2.0-4.4.",
  navLinks: [
    { href: "https://vastlint.org/docs/rules", label: "Rule catalog" },
    { href: "https://vastlint.org/docs/common-vast-errors", label: "Common VAST errors" },
    { href: "https://github.com/aleksUIX/vastlint/issues/new", label: "Report an issue" },
    { href: "https://github.com/aleksUIX/vastlint/discussions", label: "Start a discussion" },
  ],
  feedbackEmail: "aleks@vastlint.org",
  issuesUrl: "https://github.com/aleksUIX/vastlint/issues/new",
  discussionsUrl: "https://github.com/aleksUIX/vastlint/discussions",
  ruleDocsBase: "https://vastlint.org/docs/rules",
  commonErrorsUrl: "https://vastlint.org/docs/common-vast-errors",
  privacyUrl: "https://vastlint.org/privacy/",
  termsUrl: "https://vastlint.org/terms/",
  collectSamples: true,
  sampleEndpoint: "https://vastlint.org/api/samples",
  vastProxyEndpoint: "https://vastlint.org/api/vast-proxy",
  scenarioFallbackOrigin: "https://iab-tech-lab-vast-tester.vastlint.org",
  fixtureHosts: ["example.com", "iab-tech-lab-vast-tester.vastlint.org"],
  omidPartnerName: "vastlint VAST Tester",
  ruleDocsUrl(ruleId: string) {
    const encoded = encodeURIComponent(ruleId);
    if (ruleId.startsWith("SIMID-")) return `https://vastlint.org/docs/simid-rules/${encoded}/`;
    if (ruleId.startsWith("VPAID-")) return `https://vastlint.org/docs/vpaid-rules/${encoded}/`;
    return `https://vastlint.org/docs/rules/${encoded}/`;
  },
};
