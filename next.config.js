/** @type {import('next').NextConfig} */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';
import bundleAnalyzer from '@next/bundle-analyzer';
import { getImageRemotePatterns } from './config/image-remote-patterns.js';

let __dirname;
try {
  const __filename = fileURLToPath(import.meta.url);
  __dirname = dirname(__filename);
} catch {
  __dirname = process.cwd();
}

const isDevelopment = process.env.NODE_ENV === 'development';

const baseConfig = {
  poweredByHeader: false,
  compress: true,

  reactStrictMode: true,

  images: {
    remotePatterns: getImageRemotePatterns(),
    localPatterns: [
      {
        pathname: '/api/icon',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: false,
    maximumRedirects: 0,
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

  serverExternalPackages: ['sharp', 'cheerio'],

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
      ...(config.experimental ?? {}),
      runtime: 'edge',
    },
  };
}

export default withNextIntl(withBundleAnalyzer(config));
