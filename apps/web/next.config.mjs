/** @type {import('next').NextConfig} */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';
import bundleAnalyzer from '@next/bundle-analyzer';

const defaultProtocols = ['https', 'http'];

const normalizePatterns = patterns => {
  const seen = new Set();

  return patterns.filter(pattern => {
    if (!pattern?.hostname || !pattern?.protocol) return false;

    const key = `${pattern.protocol}://${pattern.hostname}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getImageRemotePatterns = () => {
  if (process.env.STRICT_IMAGE_REMOTE_PATTERNS !== 'true') {
    return normalizePatterns(defaultProtocols.map(protocol => ({ hostname: '*', protocol })));
  }

  try {
    const configPath = join(process.cwd(), 'config', 'generated', 'image-domains.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    if (Array.isArray(config?.patterns) && config.patterns.length > 0) {
      const patterns = config.patterns.flatMap(({ hostname, protocols }) => {
        if (!hostname) return [];

        const resolvedProtocols =
          Array.isArray(protocols) && protocols.length > 0 ? protocols : defaultProtocols;

        return resolvedProtocols.map(protocol => ({ hostname, protocol }));
      });

      const normalized = normalizePatterns(patterns);
      if (normalized.length > 0) {
        return normalized;
      }
    }

    if (Array.isArray(config?.domains) && config.domains.length > 0) {
      const patterns = config.domains.flatMap(hostname =>
        defaultProtocols.map(protocol => ({ hostname, protocol }))
      );

      const normalized = normalizePatterns(patterns);
      if (normalized.length > 0) {
        return normalized;
      }
    }
  } catch {
    // Fallback to defaults below
  }

  return normalizePatterns(defaultProtocols.map(protocol => ({ hostname: '*', protocol })));
};

const isDevelopment = process.env.NODE_ENV === 'development';

// Turbopack and the standalone output resolve packages from the monorepo root.
const workspaceRoot = join(import.meta.dirname, '..', '..');

const baseConfig = {
  poweredByHeader: false,
  compress: true,

  reactStrictMode: true,

  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },

  // The `lint` task type-checks the app with `oxlint --type-aware --type-check`.
  typescript: {
    ignoreBuildErrors: true,
  },

  images: {
    remotePatterns: getImageRemotePatterns(),
    localPatterns: [
      {
        pathname: '/api/icon',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: true,
  },

  webpack: (config, { isServer, dev }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': import.meta.dirname,
    };

    if (!isServer && !dev) {
      config.optimization.splitChunks = {
        chunks: 'all',
        maxSize: 244000, // 244KB chunks
      };

      config.externals = {
        ...config.externals,
        'utf-8-validate': 'commonjs utf-8-validate',
        bufferutil: 'commonjs bufferutil',
      };
    }

    if (dev) {
      config.cache = {
        type: 'filesystem',
        buildDependencies: {
          config: [import.meta.filename],
        },
      };
    }

    return config;
  },
};

const productionConfig = {
  ...baseConfig,
  output: process.env.VERCEL ? undefined : 'standalone',

  experimental: {
    optimizePackageImports: ['lucide-react', '@heroui/react'],
  },

  compiler: {
    removeConsole: {
      exclude: ['error', 'warn'],
    },
    reactRemoveProperties: true,
  },

  serverExternalPackages: ['sharp'],

  async headers() {
    const baseHeaders = [
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'X-XSS-Protection',
        value: '1; mode=block',
      },
      {
        key: 'Cache-Control',
        value: 'public, max-age=300, stale-while-revalidate=60',
      },
    ];

    return [
      {
        source: '/(.*)',
        headers: baseHeaders,
      },
      {
        source: '/api/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=60, stale-while-revalidate=300',
          },
        ],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

const developmentConfig = {
  ...baseConfig,

  compiler: {
    removeConsole: false,
  },
};

const withNextIntl = createNextIntlPlugin('./utils/i18n/request.ts');
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: true,
});

let config = isDevelopment ? developmentConfig : productionConfig;

// Cloudflare Deployment
if (process.env.CF_DEPLOYMENT) {
  config = {
    ...config,
    experimental: {
      ...config.experimental,
      runtime: 'edge',
    },
  };
}

export default withNextIntl(withBundleAnalyzer(config));
