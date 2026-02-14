/**
 * Centralized environment variable resolution with alias support.
 *
 * KUMA_MIERU_* takes precedence over legacy FEATURE_* names.
 * All alias pairs are declared here — no scattered string literals elsewhere.
 */

const ENV_ALIAS_MAP = {
  KUMA_MIERU_TITLE: 'FEATURE_TITLE',
  KUMA_MIERU_DESCRIPTION: 'FEATURE_DESCRIPTION',
  KUMA_MIERU_ICON: 'FEATURE_ICON',
  KUMA_MIERU_EDIT_THIS_PAGE: 'FEATURE_EDIT_THIS_PAGE',
  KUMA_MIERU_SHOW_STAR_BUTTON: 'FEATURE_SHOW_STAR_BUTTON',
} as const;

type AliasKey = keyof typeof ENV_ALIAS_MAP;

interface ResolvedEnv<T> {
  value: T;
  source?: string;
}

function resolveRaw(key: AliasKey): ResolvedEnv<string | undefined> {
  const primary = process.env[key];
  if (primary !== undefined) {
    return { value: primary, source: key };
  }

  const legacyKey = ENV_ALIAS_MAP[key];
  const legacy = process.env[legacyKey];
  if (legacy !== undefined) {
    return { value: legacy, source: legacyKey };
  }

  return { value: undefined };
}

export function getString(key: AliasKey): ResolvedEnv<string | undefined> {
  return resolveRaw(key);
}

export function getBoolean(key: AliasKey, defaultValue: boolean): boolean {
  const { value } = resolveRaw(key);
  if (value === undefined) return defaultValue;
  return value.trim().toLowerCase() === 'true';
}

export function getBooleanWithSource(key: AliasKey, defaultValue: boolean): ResolvedEnv<boolean> {
  const { value, source } = resolveRaw(key);
  if (value === undefined) return { value: defaultValue };
  return { value: value.trim().toLowerCase() === 'true', source };
}

export function formatResolved({ value, source }: ResolvedEnv<string | undefined>): string {
  if (value === undefined) return 'Not set';
  const label = source ? ` [${source}]` : '';
  if (value === '') return `(empty string)${label}`;
  return `${value}${label}`;
}
