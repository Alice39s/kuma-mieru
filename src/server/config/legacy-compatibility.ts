import { z } from 'zod';
import { canonicalConfigSchema, type CanonicalConfig } from './schema.js';
import { hashConfig } from './repository.js';

export const legacyEnvironmentKeys = [
  'UPTIME_KUMA_URLS',
  'UPTIME_KUMA_BASE_URL',
  'PAGE_ID',
  'KUMA_MIERU_EDIT_THIS_PAGE',
  'KUMA_MIERU_SHOW_STAR_BUTTON',
  'KUMA_MIERU_TITLE',
  'KUMA_MIERU_DESCRIPTION',
  'KUMA_MIERU_ICON',
  'FEATURE_EDIT_THIS_PAGE',
  'FEATURE_SHOW_STAR_BUTTON',
  'FEATURE_TITLE',
  'FEATURE_DESCRIPTION',
  'FEATURE_ICON',
  'ALLOW_INSECURE_TLS',
  'REQUEST_TIMEOUT_MS',
  'REQUEST_RETRY_MAX',
  'REQUEST_RETRY_DELAY_MS',
  'SSR_STRICT_MODE',
  'NEXT_PUBLIC_ERROR_PAGE_DEV_MODE',
  'ALLOW_EMBEDDING',
  'STRICT_IMAGE_REMOTE_PATTERNS',
] as const;

const generatedConfigSchema = z.object({
  baseUrl: z.string().url(),
  pageId: z.string().min(1),
  pageIds: z.array(z.string().min(1)).min(1),
  pages: z
    .array(
      z.object({
        id: z.string().min(1),
        baseUrl: z.string().url(),
        siteMeta: z.object({
          title: z.string(),
          description: z.string(),
          icon: z.string(),
        }),
      })
    )
    .min(1),
  siteMeta: z.object({ title: z.string(), description: z.string(), icon: z.string() }),
  isEditThisPage: z.boolean().default(false),
  isShowStarButton: z.boolean().default(true),
});

export type LegacyGeneratedConfig = z.infer<typeof generatedConfigSchema>;
export type LegacyVariableStatus = 'mapped' | 'ignored_by_precedence' | 'accepted_no_effect';

export interface LegacyVariableDecision {
  key: (typeof legacyEnvironmentKeys)[number];
  status: LegacyVariableStatus;
  target: string;
  note: string;
}

export interface LegacyMigrationPlan {
  source: 'environment_urls' | 'environment_base' | 'generated_json';
  config: CanonicalConfig;
  contentHash: string;
  decisions: LegacyVariableDecision[];
  conflicts: string[];
  ignoredFields: string[];
}

interface LegacyPlanInput {
  environment: NodeJS.ProcessEnv;
  generatedConfig?: unknown;
}

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value.trim() === '') return fallback;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  throw new Error(`Expected boolean value, received ${value}`);
};

const parseInteger = (
  key: string,
  value: string | undefined,
  bounds: { minimum: number; maximum: number }
) => {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < bounds.minimum || parsed > bounds.maximum) {
    throw new Error(`${key} must be an integer from ${bounds.minimum} to ${bounds.maximum}`);
  }
  return parsed;
};

const splitPageIds = (input: string) => [
  ...new Set(
    input
      .split(/[\s,]+/u)
      .map(value => value.trim())
      .filter(Boolean)
  ),
];

const parseStatusUrl = (input: string) => {
  const url = new URL(input);
  const segments = url.pathname.split('/').filter(Boolean);
  const statusIndex = segments.findIndex(segment => segment.toLowerCase() === 'status');
  if (statusIndex < 0 || statusIndex >= segments.length - 1) {
    throw new Error(`UPTIME_KUMA_URLS entry must contain /status/<pageId>: ${input}`);
  }
  const pageId = decodeURIComponent(segments[statusIndex + 1] ?? '').trim();
  if (!pageId) throw new Error(`UPTIME_KUMA_URLS entry is missing a page id: ${input}`);
  const prefix = segments.slice(0, statusIndex);
  return {
    baseUrl: `${url.origin}${prefix.length > 0 ? `/${prefix.join('/')}` : ''}`,
    pageId,
  };
};

const preferred = (
  environment: NodeJS.ProcessEnv,
  primary: string,
  fallback: string,
  defaultValue?: string
) => environment[primary] ?? environment[fallback] ?? defaultValue;

const decision = (
  key: LegacyVariableDecision['key'],
  status: LegacyVariableStatus,
  target: string,
  note: string
): LegacyVariableDecision => ({ key, status, target, note });

export const parseLegacyGeneratedConfig = (input: unknown) => generatedConfigSchema.parse(input);

export const buildLegacyMigrationPlan = ({
  environment,
  generatedConfig,
}: LegacyPlanInput): LegacyMigrationPlan => {
  const generated = generatedConfig ? parseLegacyGeneratedConfig(generatedConfig) : null;
  const rawUrls = environment.UPTIME_KUMA_URLS?.trim();
  const legacyBase = environment.UPTIME_KUMA_BASE_URL?.trim();
  const legacyPageIds = environment.PAGE_ID?.trim();
  const conflicts: string[] = [];
  const decisions: LegacyVariableDecision[] = [];
  const ignoredFields: string[] = [];
  if (rawUrls && (legacyBase || legacyPageIds)) {
    conflicts.push(
      'UPTIME_KUMA_URLS takes precedence; UPTIME_KUMA_BASE_URL and PAGE_ID are ignored.'
    );
  }

  const endpointPages = rawUrls
    ? rawUrls
        .split('|')
        .map(value => value.trim())
        .filter(Boolean)
        .map(parseStatusUrl)
    : legacyBase && legacyPageIds
      ? splitPageIds(legacyPageIds).map(pageId => ({
          baseUrl: new URL(legacyBase).toString().replace(/\/$/u, ''),
          pageId,
        }))
      : generated
        ? generated.pages.map(page => ({
            baseUrl: page.baseUrl.replace(/\/$/u, ''),
            pageId: page.id,
          }))
        : null;
  if (!endpointPages || endpointPages.length === 0) {
    throw new Error(
      'Legacy migration requires UPTIME_KUMA_URLS, UPTIME_KUMA_BASE_URL + PAGE_ID, or generated-config.json'
    );
  }
  const source: LegacyMigrationPlan['source'] = rawUrls
    ? 'environment_urls'
    : legacyBase && legacyPageIds
      ? 'environment_base'
      : 'generated_json';

  const timeoutMs = parseInteger('REQUEST_TIMEOUT_MS', environment.REQUEST_TIMEOUT_MS, {
    minimum: 250,
    maximum: 120_000,
  });
  const titleOverride = preferred(environment, 'KUMA_MIERU_TITLE', 'FEATURE_TITLE');
  const descriptionOverride = preferred(
    environment,
    'KUMA_MIERU_DESCRIPTION',
    'FEATURE_DESCRIPTION'
  );
  const iconOverride = preferred(environment, 'KUMA_MIERU_ICON', 'FEATURE_ICON');
  const editThisPage = parseBoolean(
    preferred(environment, 'KUMA_MIERU_EDIT_THIS_PAGE', 'FEATURE_EDIT_THIS_PAGE'),
    generated?.isEditThisPage ?? false
  );
  const showStarButton = parseBoolean(
    preferred(environment, 'KUMA_MIERU_SHOW_STAR_BUTTON', 'FEATURE_SHOW_STAR_BUTTON'),
    generated?.isShowStarButton ?? true
  );

  const sources = endpointPages.map((page, index) => ({
    id: `legacy-${index + 1}`,
    kind: 'uptime-kuma' as const,
    baseUrl: page.baseUrl,
    pageIds: [page.pageId],
    ...(timeoutMs ? { requestPolicy: { timeoutMs } } : {}),
  }));
  const pages = sources.map((sourceConfig, index) => {
    const endpoint = endpointPages[index] as (typeof endpointPages)[number];
    const generatedPage = generated?.pages.find(
      page => page.id === endpoint.pageId && page.baseUrl.replace(/\/$/u, '') === endpoint.baseUrl
    );
    const title =
      titleOverride ??
      generatedPage?.siteMeta.title ??
      generated?.siteMeta.title ??
      endpoint.pageId;
    const description =
      descriptionOverride ?? generatedPage?.siteMeta.description ?? generated?.siteMeta.description;
    const icon = iconOverride ?? generatedPage?.siteMeta.icon ?? generated?.siteMeta.icon;
    return {
      id: `${sourceConfig.id}-${endpoint.pageId}`,
      slug: endpoint.pageId,
      title: title || endpoint.pageId,
      ...(description !== undefined ? { description } : {}),
      ...(icon !== undefined ? { icon } : {}),
      features: { editThisPage, showStarButton },
      sourceRefs: [sourceConfig.id],
    };
  });
  const config = canonicalConfigSchema.parse({ schemaVersion: 1, server: {}, sources, pages });

  const endpointStatus = rawUrls ? 'mapped' : 'ignored_by_precedence';
  if (environment.UPTIME_KUMA_URLS !== undefined) {
    decisions.push(
      decision(
        'UPTIME_KUMA_URLS',
        'mapped',
        'sources[].baseUrl/pageIds',
        'Preferred endpoint syntax.'
      )
    );
  }
  if (environment.UPTIME_KUMA_BASE_URL !== undefined) {
    decisions.push(
      decision(
        'UPTIME_KUMA_BASE_URL',
        endpointStatus,
        'sources[].baseUrl',
        rawUrls ? 'Ignored because UPTIME_KUMA_URLS is set.' : 'Mapped with PAGE_ID.'
      )
    );
  }
  if (environment.PAGE_ID !== undefined) {
    decisions.push(
      decision(
        'PAGE_ID',
        endpointStatus,
        'sources[].pageIds/pages[].slug',
        rawUrls ? 'Ignored because UPTIME_KUMA_URLS is set.' : 'Mapped with the legacy base URL.'
      )
    );
  }

  const preferencePairs = [
    ['KUMA_MIERU_EDIT_THIS_PAGE', 'FEATURE_EDIT_THIS_PAGE', 'pages[].features.editThisPage'],
    ['KUMA_MIERU_SHOW_STAR_BUTTON', 'FEATURE_SHOW_STAR_BUTTON', 'pages[].features.showStarButton'],
    ['KUMA_MIERU_TITLE', 'FEATURE_TITLE', 'pages[].title'],
    ['KUMA_MIERU_DESCRIPTION', 'FEATURE_DESCRIPTION', 'pages[].description'],
    ['KUMA_MIERU_ICON', 'FEATURE_ICON', 'pages[].icon'],
  ] as const;
  preferencePairs.forEach(([primary, fallback, target]) => {
    if (environment[primary] !== undefined) {
      decisions.push(decision(primary, 'mapped', target, 'Preferred v1 variable name.'));
    }
    if (environment[fallback] !== undefined) {
      decisions.push(
        decision(
          fallback,
          environment[primary] !== undefined ? 'ignored_by_precedence' : 'mapped',
          target,
          environment[primary] !== undefined
            ? `Ignored because ${primary} is set.`
            : 'Mapped from legacy FEATURE fallback.'
        )
      );
    }
  });
  if (environment.REQUEST_TIMEOUT_MS !== undefined) {
    decisions.push(
      decision(
        'REQUEST_TIMEOUT_MS',
        'mapped',
        'sources[].requestPolicy.timeoutMs',
        'Bounded per request.'
      )
    );
  }

  const safeNoEffect = [
    [
      'ALLOW_INSECURE_TLS',
      'v2 keeps TLS verification enabled; private CA support requires a mounted trust store.',
    ],
    ['REQUEST_RETRY_MAX', 'v2 uses its bounded source-poller backoff policy.'],
    ['REQUEST_RETRY_DELAY_MS', 'v2 uses its bounded source-poller backoff policy.'],
    ['SSR_STRICT_MODE', 'v2 is an SPA and has no SSR strict mode.'],
    ['NEXT_PUBLIC_ERROR_PAGE_DEV_MODE', 'v2 never exposes production stack traces to visitors.'],
    [
      'ALLOW_EMBEDDING',
      'v2 retains its secure frame policy until an explicit origin policy is configured.',
    ],
    ['STRICT_IMAGE_REMOTE_PATTERNS', 'v2 always applies strict local asset and proxy validation.'],
  ] as const;
  safeNoEffect.forEach(([key, note]) => {
    if (environment[key] === undefined) return;
    decisions.push(decision(key, 'accepted_no_effect', 'secure v2 runtime policy', note));
    ignoredFields.push(key);
  });

  return { source, config, contentHash: hashConfig(config), decisions, conflicts, ignoredFields };
};
