import { resolveQaAssetUrl } from "./qa/resolveQaAssetUrl";

/** Fetch VAST directly from the browser, preserving its URL for wrapper resolution. */
export async function fetchVastDocument(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const originalUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const resolvedUrl = resolveQaAssetUrl(originalUrl) ?? originalUrl;
  const target = resolvedUrl === originalUrl ? input : input instanceof Request ? new Request(resolvedUrl, input) : resolvedUrl;
  let response: Response;
  try {
    response = await globalThis.fetch(target, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new Error(
      "Could not fetch VAST directly. The endpoint must allow browser CORS requests from this origin. You can also paste the XML.",
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(`VAST request failed with HTTP ${String(response.status)}.`);
  }
  return response;
}
