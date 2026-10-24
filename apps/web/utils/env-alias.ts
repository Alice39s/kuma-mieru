export const ENV_ALIAS_MAP = {
  KUMA_MIERU_TITLE: 'FEATURE_TITLE',
  KUMA_MIERU_DESCRIPTION: 'FEATURE_DESCRIPTION',
  KUMA_MIERU_ICON: 'FEATURE_ICON',
  KUMA_MIERU_EDIT_THIS_PAGE: 'FEATURE_EDIT_THIS_PAGE',
  KUMA_MIERU_SHOW_STAR_BUTTON: 'FEATURE_SHOW_STAR_BUTTON',
} as const;

export type AliasKey = keyof typeof ENV_ALIAS_MAP;

export interface ResolvedEnv<T> {
  value: T;
  source?: string;
}

export function resolveAliasedEnvRaw(
  key: AliasKey,
  env: Record<string, string | undefined> = process.env
): ResolvedEnv<string | undefined> {
  const primary = env[key];
  if (primary !== undefined) {
    return { value: primary, source: key };
  }

  const legacyKey = ENV_ALIAS_MAP[key];
  const legacy = env[legacyKey];
  if (legacy !== undefined) {
    return { value: legacy, source: legacyKey };
  }

  return { value: undefined };
}
