import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { booleanEnvSchema } from '../utils/boolean-schema-core.js';
import { z } from 'zod';

export const defaultImageProtocols = ['https', 'http'];

const imageProtocolSchema = z.enum(defaultImageProtocols);
const generatedImageDomainsSchema = z
  .object({
    patterns: z
      .array(
        z.object({
          hostname: z.string().optional(),
          protocols: z.array(z.string()).optional(),
        })
      )
      .optional()
      .default([]),
    domains: z.array(z.string()).optional().default([]),
  })
  .passthrough();

const imagePatternDefaults = {
  pathname: '/**',
  search: '',
};

const normalizePatterns = patterns => {
  const seen = new Set();

  return patterns.filter(pattern => {
    if (!pattern?.hostname || !pattern?.protocol) return false;
    if (pattern.hostname === '*') return false;

    const key = `${pattern.protocol}://${pattern.hostname}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const buildPattern = ({ hostname, protocol }) => ({
  hostname,
  ...imagePatternDefaults,
  protocol,
});

const buildWildcardPatterns = () =>
  defaultImageProtocols.map(protocol => buildPattern({ hostname: '*', protocol }));

const resolveGeneratedProtocols = protocols => {
  if (!protocols || protocols.length === 0) {
    return defaultImageProtocols;
  }

  return protocols.flatMap(protocol => {
    const parsed = imageProtocolSchema.safeParse(protocol);
    return parsed.success ? [parsed.data] : [];
  });
};

export const getImageRemotePatterns = ({ cwd = process.cwd(), env = process.env } = {}) => {
  if (booleanEnvSchema.parse(env.ALLOW_ANY_IMAGE_REMOTE_PATTERNS)) {
    return buildWildcardPatterns();
  }

  try {
    const configPath = join(cwd, 'config', 'generated', 'image-domains.json');
    const config = generatedImageDomainsSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')));

    if (config.patterns.length > 0) {
      const patterns = config.patterns.flatMap(({ hostname, protocols }) => {
        if (!hostname) return [];

        return resolveGeneratedProtocols(protocols).map(protocol =>
          buildPattern({ hostname, protocol })
        );
      });

      return normalizePatterns(patterns);
    }

    if (config.domains.length > 0) {
      const patterns = config.domains.flatMap(hostname =>
        defaultImageProtocols.map(protocol => buildPattern({ hostname, protocol }))
      );

      return normalizePatterns(patterns);
    }
  } catch {
    return [];
  }

  return [];
};
