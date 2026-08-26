const SAMPLE_ENDPOINT = "https://vastlint.org/api/samples";
const OPT_OUT_KEY = "vastlint-omit-samples";
const OPT_EVENT = "vastlint-samples-opt";
const MIN_XML_CHARS = 80;
const MAX_XML_CHARS = 512 * 1024;

export const IAB_TESTER_SAMPLE_SOURCE = "web-iab-tester";

export function samplesOptedOut(): boolean {
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSamplesOptedOut(value: boolean): void {
  try {
    window.localStorage.setItem(OPT_OUT_KEY, value ? "1" : "0");
    window.dispatchEvent(new Event(OPT_EVENT));
  } catch {
    // private mode
  }
}

export function onSamplesOptChange(handler: () => void): () => void {
  window.addEventListener(OPT_EVENT, handler);
  return () => window.removeEventListener(OPT_EVENT, handler);
}

const SESSION_KEY = "vastlint-sample-session";
const SESSION_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTM_RE = /^[a-zA-Z0-9._-]{1,80}$/;

function hostnameOf(url: string | null | undefined): string | undefined {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  try {
    return new URL(url).hostname.slice(0, 253);
  } catch {
    return undefined;
  }
}

function sampleSessionId(): string | undefined {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id || !SESSION_RE.test(id)) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

function referrerHost(): string | undefined {
  try {
    const ref = document.referrer;
    if (!ref) return undefined;
    return new URL(ref).hostname.slice(0, 253);
  } catch {
    return undefined;
  }
}

function utmParam(name: "utm_source" | "utm_medium"): string | undefined {
  try {
    const value = new URLSearchParams(window.location.search).get(name);
    if (!value) return undefined;
    const trimmed = value.trim();
    return UTM_RE.test(trimmed) ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

export function recordUsageSample(args: {
  xml: string;
  version?: string | null;
  summary?: { errors?: number; warnings?: number; infos?: number };
  url?: string | null;
}): void {
  if (typeof window === "undefined") return;
  if (samplesOptedOut()) return;
  const xml = args.xml.trim();
  if (xml.length < MIN_XML_CHARS || xml.length > MAX_XML_CHARS) return;
  if (!xml.startsWith("<")) return;

  void fetch(SAMPLE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      xml,
      source: IAB_TESTER_SAMPLE_SOURCE,
      version: args.version,
      summary: args.summary,
      host: hostnameOf(args.url),
      session_id: sampleSessionId(),
      referrer_host: referrerHost(),
      utm_source: utmParam("utm_source"),
      utm_medium: utmParam("utm_medium"),
    }),
  }).catch(() => {});
}
