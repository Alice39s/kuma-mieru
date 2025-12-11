import * as cheerio from 'cheerio';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { PreloadData } from '../types/config';
import { extractPreloadData } from '../utils/json-processor';
import { sanitizeJsonString } from '../utils/json-sanitizer';
import { fetchPreloadDataFromApi, getPreloadPayload } from '../utils/preload-data';

import 'dotenv/config';

const DEFAULT_SITE_TITLE = 'Kuma Mieru';
const DEFAULT_SITE_DESCRIPTION = 'A beautiful and modern uptime monitoring dashboard';
const DEFAULT_SITE_ICON = '/icon.svg';

const siteMetaSchema = z.object({
  title: z.string().default(DEFAULT_SITE_TITLE),
  description: z.string().default(DEFAULT_SITE_DESCRIPTION),
  icon: z.string().default(DEFAULT_SITE_ICON),
  iconCandidates: z.array(z.string()).min(1).default([DEFAULT_SITE_ICON]),
});
const DEFAULT_SITE_META = siteMetaSchema.parse({});

const pageConfigSchema = z.object({
  id: z.string(),
  siteMeta: siteMetaSchema,
});

const configSchema = z.object({
  baseUrl: z.string().url(),
  pageId: z.string(),
  pageIds: z.array(z.string()).min(1),
  pages: z.array(pageConfigSchema).min(1),
  siteMeta: siteMetaSchema,
  isPlaceholder: z.boolean().default(false),
  isEditThisPage: z.boolean().default(false),
  isShowStarButton: z.boolean().default(true),
});

type SiteMeta = z.infer<typeof siteMetaSchema>;

interface StringOverride {
  value: string | undefined;
  isDefined: boolean;
}

const getFeatureOverride = (name: string): StringOverride => {
  const value = process.env[name];
  return {
    value,
    isDefined: value !== undefined,
  };
};

const formatOverrideForLog = ({ isDefined, value }: StringOverride): string => {
  if (!isDefined) return 'Not set';
  if (value === '') return '(empty string)';
  return value ?? '(undefined)';
};

const buildIconCandidates = (
  sources: Array<string | undefined | null>,
  defaultIcon: string,
): string[] => {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const source of sources) {
    if (typeof source !== 'string') continue;
    const trimmed = source.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    candidates.push(trimmed);
    seen.add(trimmed);
  }

  if (!seen.has(defaultIcon)) {
    candidates.push(defaultIcon);
    seen.add(defaultIcon);
  }

  if (candidates.length === 0) {
    candidates.push(defaultIcon);
  }

  return candidates;
};

const resolveSiteMeta = ({
  overrides,
  remoteMeta,
}: {
  overrides: {
    title: StringOverride;
    description: StringOverride;
    icon: StringOverride;
  };
  remoteMeta?: Partial<Pick<SiteMeta, 'title' | 'description' | 'icon'>>;
}): SiteMeta => {
  const title = overrides.title.isDefined
    ? overrides.title.value ?? ''
    : remoteMeta?.title ?? DEFAULT_SITE_META.title;

  const description = overrides.description.isDefined
    ? overrides.description.value ?? ''
    : remoteMeta?.description ?? DEFAULT_SITE_META.description;

  const iconCandidates = buildIconCandidates(
    [
      overrides.icon.isDefined ? overrides.icon.value : undefined,
      remoteMeta?.icon,
    ],
    DEFAULT_SITE_META.icon,
  );

  return siteMetaSchema.parse({
    title,
    description,
    icon: iconCandidates[0],
    iconCandidates,
  });
};

function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

function getBooleanEnvVar(name: string, defaultValue = true): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;

  console.log(`[env] ${name}=${value} (type: ${typeof value})`);

  const lowercaseValue = value.toLowerCase();
  console.log(`[env] ${name} -> ${lowercaseValue}`);

  return lowercaseValue === 'true';
}

function getCloudflareAccessHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  
  const clientId = process.env.CF_ACCESS_CLIENT_ID;
  const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  
  if (clientId?.trim()) {
    headers['CF-Access-Client-Id'] = clientId.trim();
  }
  
  if (clientSecret?.trim()) {
    headers['CF-Access-Client-Secret'] = clientSecret.trim();
  }
  
  return headers;
}

function getFetchOptions(): Record<string, unknown> {
  return {
    headers: {
      'User-Agent': 'Kuma-Mieru/config-generator',
      ...getCloudflareAccessHeaders(),
    },
  };
}

async function fetchSiteMeta(baseUrl: string, pageId: string) {
  const titleOverride = getFeatureOverride('FEATURE_TITLE');
  const descriptionOverride = getFeatureOverride('FEATURE_DESCRIPTION');
  const iconOverride = getFeatureOverride('FEATURE_ICON');
  const overrides = {
    title: titleOverride,
    description: descriptionOverride,
    icon: iconOverride,
  };

  console.log('[env] [feature_fields]');
  console.log(`[env] - FEATURE_TITLE: ${formatOverrideForLog(titleOverride)}`);
  console.log(`[env] - FEATURE_DESCRIPTION: ${formatOverrideForLog(descriptionOverride)}`);
  console.log(`[env] - FEATURE_ICON: ${formatOverrideForLog(iconOverride)}`);

  const hasAnyOverride =
    titleOverride.isDefined || descriptionOverride.isDefined || iconOverride.isDefined;

  try {
    const fetchOptions = getFetchOptions();
    const response = await fetch(`${baseUrl}/status/${pageId}`, fetchOptions);
    if (!response.ok) {
      throw new Error(`Failed to fetch site meta: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const { payload, source } = getPreloadPayload($);
    let preloadSource = payload;
    let preloadData: PreloadData | null = null;

    if (!preloadSource) {
      const legacyScript = $('script:contains("window.preloadData")').text();
      if (legacyScript) {
        const match = legacyScript.match(/window\.preloadData\s*=\s*({[\s\S]*?});/);
        if (match && match[1]) {
          preloadSource = match[1];
          console.log('Fallback to window.preloadData script for site meta extraction');
        }
      }
    }

    if (preloadSource) {
      if (source === 'data-json') {
        console.log('Using preload data from data-json attribute for site meta');
      }

      const jsonStr = sanitizeJsonString(preloadSource);
      preloadData = extractPreloadData(jsonStr);
    } else {
      console.log('Preload data not found in HTML, attempting status page API fallback');
      const apiFallback = await fetchPreloadDataFromApi({ 
        baseUrl, 
        pageId,
        requestInit: fetchOptions
      });
      console.log(`Using status page API fallback from ${apiFallback.url}`);
      preloadData = apiFallback.data;
    }

    if (!preloadData) {
      throw new Error('Failed to resolve preload data from HTML or API');
    }

    const remoteMeta: Partial<Pick<SiteMeta, 'title' | 'description' | 'icon'>> = {
      title: preloadData.config.title ?? undefined,
      description: preloadData.config.description ?? undefined,
      icon: preloadData.config.icon ?? undefined,
    };

    const resolvedMeta = resolveSiteMeta({
      overrides,
      remoteMeta,
    });

    if (resolvedMeta.iconCandidates.length > 1) {
      console.log(
        `[env] - FEATURE_ICON_CANDIDATES: ${resolvedMeta.iconCandidates.map((item, index) => {
          const label =
            index === 0 && iconOverride.isDefined
              ? `${item} (env)`
              : index === 0
              ? `${item} (resolved)`
              : item;
          return label;
        }).join(' -> ')}`,
      );
    }

    return resolvedMeta;
  } catch (error) {
    console.error('Error fetching site meta:', error);

    if (hasAnyOverride) {
      return resolveSiteMeta({ overrides });
    }

    return siteMetaSchema.parse({});
  }
}

function parsePageIds(rawValue: string): string[] {
  const parsed = rawValue
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return Array.from(new Set(parsed));
}

async function generateConfig() {
  try {
    console.log('[env] [generate-config]');
    console.log('[env] [start]');

    for (const key in process.env) {
      if (key.startsWith('FEATURE_')) {
        console.log(`[env] - ${key}: ${process.env[key]}`);
      }
    }

    const baseUrl = getRequiredEnvVar('UPTIME_KUMA_BASE_URL');
    const rawPageIds = getRequiredEnvVar('PAGE_ID');
    const pageIds = parsePageIds(rawPageIds);

    if (pageIds.length === 0) {
      throw new Error('PAGE_ID must contain at least one status page identifier');
    }

    const defaultPageId = pageIds[0];

    // 获取并验证配置项
    try {
      new URL(baseUrl);
    } catch {
      throw new Error('UPTIME_KUMA_BASE_URL must be a valid URL');
    }

    const isEditThisPage = getBooleanEnvVar('FEATURE_EDIT_THIS_PAGE', false);
    const isShowStarButton = getBooleanEnvVar('FEATURE_SHOW_STAR_BUTTON', true);

    console.log(`[env] - isEditThisPage: ${isEditThisPage}`);
    console.log(`[env] - isShowStarButton: ${isShowStarButton}`);

    const pageConfigEntries = [] as Array<{ id: string; siteMeta: z.infer<typeof siteMetaSchema> }>;

    for (const id of pageIds) {
      try {
        const siteMeta = await fetchSiteMeta(baseUrl, id);
        pageConfigEntries.push({ id, siteMeta });
      } catch (error) {
        console.error(`Failed to fetch site meta for page "${id}":`, error);
        pageConfigEntries.push({ id, siteMeta: siteMetaSchema.parse({}) });
      }
    }

    const defaultSiteMeta = pageConfigEntries.find((entry) => entry.id === defaultPageId)?.siteMeta;

    if (!defaultSiteMeta) {
      throw new Error(`Unable to resolve site metadata for default page "${defaultPageId}"`);
    }

    const config = configSchema.parse({
      baseUrl,
      pageId: defaultPageId,
      pageIds,
      pages: pageConfigEntries,
      siteMeta: defaultSiteMeta,
      isPlaceholder: false,
      isEditThisPage,
      isShowStarButton,
    });

    const configPath = path.join(process.cwd(), 'config', 'generated-config.json');

    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    console.log('✅ Configuration file generated successfully!');
    console.log(`[env] [generated-config.json] ${configPath}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error generating configuration file:', error.message);
    } else {
      console.error('❌ Unknown error generating configuration file');
    }
    process.exit(1);
  }
}

generateConfig().catch(console.error);
