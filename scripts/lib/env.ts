import { resolveAliasedEnvRaw } from '../../utils/env-alias';
import { parseBooleanEnvWithDefault } from '../../utils/boolean-schema';
import type { AliasKey, ResolvedEnv } from '../../utils/env-alias';

export function getString(key: AliasKey): ResolvedEnv<string | undefined> {
  return resolveAliasedEnvRaw(key);
}

export function getBoolean(key: AliasKey, defaultValue: boolean): boolean {
  const { value } = resolveAliasedEnvRaw(key);
  return parseBooleanEnvWithDefault(value, defaultValue);
}

export function getBooleanWithSource(key: AliasKey, defaultValue: boolean): ResolvedEnv<boolean> {
  const { value, source } = resolveAliasedEnvRaw(key);
  if (value === undefined) {
    return { value: parseBooleanEnvWithDefault(value, defaultValue) };
  }

  return { value: parseBooleanEnvWithDefault(value, defaultValue), source };
}

export function formatResolved({ value, source }: ResolvedEnv<string | undefined>): string {
  if (value === undefined) return 'Not set';
  const label = source ? ` [${source}]` : '';
  if (value === '') return `(empty string)${label}`;
  return `${value}${label}`;
}
