import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SITE_ICON,
  DEFAULT_SITE_META as DEFAULT_SITE_META_VALUES,
} from '../config/defaults';
import { generatedConfigSchema, siteMetaSchema } from '../config/schemas';
import type { SiteMeta } from '../config/schemas';
import { resolvePreloadDataFromHtml } from '../utils/preload-data';
import { getString, getBooleanWithSource, formatResolved } from './lib/env';
import { resolveEndpointConfig } from './lib/uptime-kuma';

import 'dotenv/config';

const DEFAULT_SITE_META = siteMetaSchema.parse(DEFAULT_SITE_META_VALUES);

interface StringOverride {
  value: string | undefined;
  isDefined: boolean;
  source?: string;
}

const toOverride = (resolved: { value: string | undefined; source?: string }): StringOverride => ({
  value: resolved.value,
  isDefined: resolved.value !== undefined,
  source: resolved.source,
});

const formatOverrideForLog = ({ isDefined, value, source }: StringOverride): string => {
  if (!isDefined) return 'Not set';
  const label = source ? ` [${source}]` : '';
  if (value === '') return `(empty string)${label}`;
  return `${value ?? '(undefined)'}${label}`;
};

const buildIconCandidates = (
  sources: Array<string | undefined | null>,
  defaultIcon: string
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
    ? (overrides.title.value ?? '')
    : (remoteMeta?.title ?? DEFAULT_SITE_META.title);

  const description = overrides.description.isDefined
    ? (overrides.description.value ?? '')
    : (remoteMeta?.description ?? DEFAULT_SITE_META.description);

  const iconCandidates = buildIconCandidates(
    [overrides.icon.isDefined ? overrides.icon.value : undefined, remoteMeta?.icon],
    DEFAULT_SITE_META.icon
  );

  return siteMetaSchema.parse({
    title,
    description,
    icon: iconCandidates[0],
    iconCandidates,
  });
};

async function fetchSiteMeta(baseUrl: string, pageId: string) {
  const titleOverride = toOverride(getString('KUMA_MIERU_TITLE'));
  const descriptionOverride = toOverride(getString('KUMA_MIERU_DESCRIPTION'));
  const iconOverride = toOverride(getString('KUMA_MIERU_ICON'));
  const overrides = {
    title: titleOverride,
    description: descriptionOverride,
    icon: iconOverride,
  };

  console.log('[env] [site_meta_overrides]');
  console.log(`[env] - TITLE: ${formatOverrideForLog(titleOverride)}`);
  console.log(`[env] - DESCRIPTION: ${formatOverrideForLog(descriptionOverride)}`);
  console.log(`[env] - ICON: ${formatOverrideForLog(iconOverride)}`);

  const hasAnyOverride =
    titleOverride.isDefined || descriptionOverride.isDefined || iconOverride.isDefined;

  try {
    const response = await fetch(`${baseUrl}/status/${pageId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch site meta: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const { data: preloadData } = await resolvePreloadDataFromHtml({
      html,
      baseUrl,
      pageId,
      logger: console,
      includeHtmlDiagnostics: true,
    });

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
        `[env] - ICON_CANDIDATES: ${resolvedMeta.iconCandidates
          .map((item, index) => {
            const label =
              index === 0 && iconOverride.isDefined
                ? `${item} (env)`
                : index === 0
                  ? `${item} (resolved)`
                  : item;
            return label;
          })
          .join(' -> ')}`
      );
    }

    return resolvedMeta;
  } catch (error) {
    console.error('Error fetching site meta:', error);

    if (hasAnyOverride) {
      return resolveSiteMeta({ overrides });
    }

    return siteMetaSchema.parse(DEFAULT_SITE_META);
  }
}

async function generateConfig() {
  try {
    console.log('[env] [generate-config] [start]');

    const endpoint = resolveEndpointConfig();
    const { baseUrl, pageIds, pageEndpoints } = endpoint;

    console.log(`[env] - source: ${endpoint.source}`);
    console.log(`[env] - baseUrl: ${baseUrl}`);
    console.log(`[env] - pageIds: ${pageIds.join(', ')}`);
    console.log(
      `[env] - pageEndpoints: ${pageEndpoints.map(p => `${p.id}@${p.baseUrl}`).join(', ')}`
    );

    const defaultPageId = pageIds[0];

    try {
      new URL(baseUrl);
    } catch {
      throw new Error('Resolved Uptime Kuma base URL must be a valid URL');
    }

    const isEditThisPage = getBooleanWithSource('KUMA_MIERU_EDIT_THIS_PAGE', false);
    const isShowStarButton = getBooleanWithSource('KUMA_MIERU_SHOW_STAR_BUTTON', true);

    console.log(
      `[env] - isEditThisPage: ${isEditThisPage.value}` +
        (isEditThisPage.source ? ` [${isEditThisPage.source}]` : '')
    );
    console.log(
      `[env] - isShowStarButton: ${isShowStarButton.value}` +
        (isShowStarButton.source ? ` [${isShowStarButton.source}]` : '')
    );

    const pageConfigEntries = [] as Array<{
      id: string;
      baseUrl: string;
      siteMeta: SiteMeta;
    }>;

    for (const page of pageEndpoints) {
      try {
        const siteMeta = await fetchSiteMeta(page.baseUrl, page.id);
        pageConfigEntries.push({
          id: page.id,
          baseUrl: page.baseUrl,
          siteMeta,
        });
      } catch (error) {
        console.error(`Failed to fetch site meta for page "${page.id}":`, error);
        pageConfigEntries.push({
          id: page.id,
          baseUrl: page.baseUrl,
          siteMeta: siteMetaSchema.parse(DEFAULT_SITE_META),
        });
      }
    }

    const defaultSiteMeta = pageConfigEntries.find(entry => entry.id === defaultPageId)?.siteMeta;

    if (!defaultSiteMeta) {
      throw new Error(`Unable to resolve site metadata for default page "${defaultPageId}"`);
    }

    const config = generatedConfigSchema.parse({
      baseUrl,
      pageId: defaultPageId,
      pageIds,
      pages: pageConfigEntries,
      siteMeta: defaultSiteMeta,
      isPlaceholder: false,
      isEditThisPage: isEditThisPage.value,
      isShowStarButton: isShowStarButton.value,
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
