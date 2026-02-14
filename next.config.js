/** @type {import('next').NextConfig} */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';
import bundleAnalyzer from '@next/bundle-analyzer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  } catch (e) {
    // Fallback to defaults below
  }

  return normalizePatterns(defaultProtocols.map(protocol => ({ hostname: '*', protocol })));
};

const isDevelopment = process.env.NODE_ENV === 'development';

const baseConfig = {
  poweredByHeader: false,
  compress: true,

  reactStrictMode: true,

  images: {
    remotePatterns: getImageRemotePatterns(),
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: true,
  },

  webpack: (config, { isServer, dev }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': join(__dirname),
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
          config: [__filename],
        },
      };
    }

    return config;
  },
};

const productionConfig = {
  ...baseConfig,
  output: 'standalone',

  experimental: {
    optimizePackageImports: ['lucide-react', '@heroui/react'],
  },

  compiler: {
    removeConsole: {
      exclude: ['error', 'warn'],
    },
    reactRemoveProperties: true,
  },

  serverExternalPackages: ['sharp', 'cheerio', 'sanitize-html'],

  async headers() {
    // Parse ALLOW_EMBEDDING: false/unset=block, true=allow all, or comma-separated origin list
    const allowEmbedding = process.env.ALLOW_EMBEDDING;

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

    if (!allowEmbedding || allowEmbedding === 'false') {
      // Block iframe embedding (default)
      baseHeaders.push({
        key: 'X-Frame-Options',
        value: 'SAMEORIGIN',
      });
    } else if (allowEmbedding === 'true') {
      // Allow all origins (not recommended, security risk)
      baseHeaders.push({
        key: 'Content-Security-Policy',
        value: "frame-ancestors 'self' *;",
      });
    } else {
      // Parse comma-separated origin list, auto-add 'self'
      const origins = allowEmbedding
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);

      // Normalize origins: add https:// protocol if missing
      const normalizedOrigins = origins.map(origin => {
        if (origin.startsWith('http')) return origin;
        return `https://${origin}`;
      });

      // Always include 'self' in allowed origins
      const frameAncestors = `'self' ${normalizedOrigins.join(' ')}`;

      baseHeaders.push({
        key: 'Content-Security-Policy',
        value: `frame-ancestors ${frameAncestors};`,
      });
    }

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
      ...(config.experimental ?? {}),
      runtime: 'edge',
    },
  };
}

export default withNextIntl(withBundleAnalyzer(config));
