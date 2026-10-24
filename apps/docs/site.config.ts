/**
 * Where the docs are published. GitHub Pages serves the project site under `/<repository>`, so `DOCS_BASE_PATH`
 * defaults to `/kuma-mieru`; set it to an empty string to serve the docs from a domain root. `SITE_ORIGIN` gives
 * Open Graph tags, the Markdown twins and `llms.txt` their absolute URLs.
 */
export const basePath = normalizeBasePath(process.env.DOCS_BASE_PATH ?? '/kuma-mieru');
export const siteOrigin = normalizeOrigin(process.env.SITE_ORIGIN ?? 'https://alice39s.github.io');

function normalizeBasePath(value: string): string {
  const base = value.replace(/\/+$/, '');
  if (base !== '' && !/^(\/[\w.-]+)+$/.test(base)) {
    throw new Error(
      `DOCS_BASE_PATH must be empty or an absolute path such as "/kuma-mieru", got "${value}".`
    );
  }
  return base;
}

/** Accepts an origin in any letter case, such as `https://Alice39s.github.io` from the Pages workflow. */
function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value.replace(/\/+$/, '').toLowerCase()) {
    throw new Error(`SITE_ORIGIN must be an origin without a path, got "${value}".`);
  }
  return url.origin;
}
