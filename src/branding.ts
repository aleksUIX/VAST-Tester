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
  fixtureHosts: readonly string[];
  omidPartnerName: string;
  ruleDocsUrl(ruleId: string): string | null;
}

export const branding: Branding = {
  appTitle: "VAST Tester",
  lede:
    "Validate VAST tags, resolve wrappers, and inspect playback, tracking, SIMID, and OM SDK behavior across VAST 2.0-4.4.",
  navLinks: [
    { href: "https://iabtechlab.com/standards/vast/", label: "VAST spec" },
    { href: "https://github.com/InteractiveAdvertisingBureau/VAST", label: "VAST on GitHub" },
    { href: "https://github.com/IABTechLab/VAST-Tester/issues", label: "Report an issue" },
  ],
  feedbackEmail: null,
  issuesUrl: "https://github.com/IABTechLab/VAST-Tester/issues",
  discussionsUrl: null,
  ruleDocsBase: null,
  commonErrorsUrl: null,
  fixtureHosts: ["example.com"],
  omidPartnerName: "VAST Tester",
  ruleDocsUrl() {
    return null;
  },
};
