import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type ImageProtocol = 'http' | 'https';

interface ImageDomainPattern {
  hostname: string;
  protocols: ImageProtocol[];
}

interface ImageDomainsConfig {
  timestamp: string;
  patterns: ImageDomainPattern[];
  /**
   * @deprecated Retained for backward compatibility. Use `patterns` instead.
   */
  domains: string[];
}

const supportedProtocols: ImageProtocol[] = ['http', 'https'];

const parseUrl = (url: string | null): { hostname: string; protocol: ImageProtocol } | null => {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.replace(':', '');

    if (supportedProtocols.includes(protocol as ImageProtocol)) {
      return {
        hostname: parsed.hostname,
        protocol: protocol as ImageProtocol,
      };
    }

    return null;
  } catch (e) {
    return null;
  }
};

const addDomainToMap = (
  map: Map<string, Set<ImageProtocol>>,
  value: { hostname: string; protocol: ImageProtocol } | null
) => {
  if (!value) return;

  const protocols = map.get(value.hostname) ?? new Set<ImageProtocol>();
  protocols.add(value.protocol);
  map.set(value.hostname, protocols);
};

const generateImageDomains = (): void => {
  const domainsMap = new Map<string, Set<ImageProtocol>>();

  addDomainToMap(domainsMap, parseUrl(process.env.UPTIME_KUMA_BASE_URL || ''));
  addDomainToMap(domainsMap, parseUrl(process.env.FEATURE_ICON || ''));

  const patterns: ImageDomainPattern[] = Array.from(domainsMap.entries()).map(
    ([hostname, protocols]) => ({
      hostname,
      protocols: Array.from(protocols).sort(),
    })
  );

  if (patterns.length === 0) {
    patterns.push({ hostname: '*', protocols: [...supportedProtocols] });
  }

  const legacyDomains = patterns.map(pattern => pattern.hostname);

  const domainsConfig: ImageDomainsConfig = {
    timestamp: new Date().toISOString(),
    patterns,
    domains: legacyDomains,
  };

  const outputPath = join(process.cwd(), 'config', 'generated', 'image-domains.json');

  mkdirSync(dirname(outputPath), { recursive: true });

  writeFileSync(outputPath, JSON.stringify(domainsConfig, null, 2));

  console.log('✨ Generated image domains configuration:', domainsConfig);
};

generateImageDomains();
