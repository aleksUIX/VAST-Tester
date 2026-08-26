const FIXTURE_HOSTS = new Set([
  "example.com",
  "iab-tech-lab-vast-tester.vastlint.org",
]);

function appOrigin(): string {
  if (typeof globalThis.location === "object") {
    return globalThis.location.origin;
  }
  return "http://localhost:5175";
}

function appBaseUrl(): URL {
  const origin = appOrigin();
  const base = import.meta.env.BASE_URL ?? "/";
  return new URL(base, origin.endsWith("/") ? origin : `${origin}/`);
}

/** Load tester-owned fixture URLs from this origin even if the XML names production. */
export function resolveQaAssetUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url, appOrigin());
    const path = parsed.pathname;
    const isFixture = path.startsWith("/fixtures/") || path.startsWith("/scenarios/");
    if (!isFixture) {
      return parsed.toString();
    }

    if (FIXTURE_HOSTS.has(parsed.hostname) || parsed.origin === appOrigin()) {
      return new URL(path.startsWith("/") ? path.slice(1) : path, appBaseUrl()).toString();
    }

    return parsed.toString();
  } catch {
    return url;
  }
}
