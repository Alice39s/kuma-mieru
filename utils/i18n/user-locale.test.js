import { expect, test } from 'bun:test';
import { ZodError } from 'zod';
import { defaultLocale } from './config';
import { parseLocale } from './locale-schema';
import { resolveUserLocale } from './user-locale';

test('resolveUserLocale prefers a valid cookie locale over Accept-Language', () => {
  expect(resolveUserLocale('ja-JP', 'en-US,en;q=0.9')).toBe('ja-JP');
});

test('resolveUserLocale ignores invalid cookie locale and falls back to Accept-Language', () => {
  expect(resolveUserLocale('../../messages/en-US', 'fr-FR,fr;q=0.9')).toBe('fr-FR');
});

test('resolveUserLocale maps Accept-Language base language to supported locale', () => {
  expect(resolveUserLocale(undefined, 'ko;q=0.9,en;q=0.8')).toBe('ko-KR');
});

test('resolveUserLocale honors Accept-Language q value priority', () => {
  expect(resolveUserLocale(undefined, 'en-US;q=0.3, zh-CN;q=0.9')).toBe('zh-CN');
});

test('resolveUserLocale ignores Accept-Language entries with q=0', () => {
  expect(resolveUserLocale(undefined, 'en-US;q=0')).toBe(defaultLocale);
});

test('resolveUserLocale falls back to default locale when no candidate matches', () => {
  expect(resolveUserLocale('not-a-locale', 'zz-ZZ')).toBe(defaultLocale);
});

test('parseLocale accepts supported locale values', () => {
  expect(parseLocale('pt-BR')).toBe('pt-BR');
});

test('parseLocale rejects unsupported locale values at runtime', () => {
  expect(() => parseLocale('../../messages/en-US')).toThrow(ZodError);
});
