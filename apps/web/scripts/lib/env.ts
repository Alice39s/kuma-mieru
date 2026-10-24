import { resolveAliasedEnvRaw } from '../../utils/env-alias';
import type { AliasKey, ResolvedEnv } from '../../utils/env-alias';

export function getString(key: AliasKey): ResolvedEnv<string | undefined> {
  return resolveAliasedEnvRaw(key);
}

export function getBoolean(key: AliasKey, defaultValue: boolean): boolean {
  const { value } = resolveAliasedEnvRaw(key);
  if (value === undefined) return defaultValue;
  return value.trim().toLowerCase() === 'true';
}

export function getBooleanWithSource(key: AliasKey, defaultValue: boolean): ResolvedEnv<boolean> {
  const { value, source } = resolveAliasedEnvRaw(key);
  if (value === undefined) return { value: defaultValue };
  return { value: value.trim().toLowerCase() === 'true', source };
}

export function formatResolved({ value, source }: ResolvedEnv<string | undefined>): string {
  if (value === undefined) return 'Not set';
  const label = source ? ` [${source}]` : '';
  if (value === '') return `(empty string)${label}`;
  return `${value}${label}`;
}
