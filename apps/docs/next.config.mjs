import { createMDX } from 'fumadocs-mdx/next';
import { join } from 'node:path';
import { basePath, siteOrigin } from './site.config.ts';

const workspaceRoot = join(import.meta.dirname, '..', '..');

/** @type {import('next').NextConfig} */
const config = {
  // GitHub Pages serves files only: every page, Markdown twin, preview image and the search index is pre-rendered.
  output: 'export',
  basePath,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  serverExternalPackages: ['@takumi-rs/core'],
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_SITE_ORIGIN: siteOrigin,
  },
  experimental: {
    // Each language is a root layout with its own `<html lang>`, so the 404 page needs its own document.
    globalNotFound: true,
  },
  // The `lint` task type-checks the site with `oxlint --type-aware --type-check`.
  typescript: { ignoreBuildErrors: true },
};

const withMDX = createMDX();

export default withMDX(config);
