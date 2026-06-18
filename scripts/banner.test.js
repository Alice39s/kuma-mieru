import { expect, test } from 'bun:test';
import chalk from 'chalk';

test('banner can be imported without printing startup info', async () => {
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  try {
    await import('./banner.ts');
  } finally {
    console.log = originalLog;
  }

  expect(logs.some(line => line.includes('Kuma Mieru'))).toBe(false);
});

test('getEnvStatus formats booleans, strings, and fallback values', async () => {
  const previousLevel = chalk.level;
  chalk.level = 0;

  try {
    const { getEnvStatus } = await import('./banner.ts');

    expect(getEnvStatus(true)).toBe('true');
    expect(getEnvStatus(false)).toBe('false');
    expect(getEnvStatus('configured')).toBe('configured');
    expect(getEnvStatus(undefined, 'fallback')).toBe('fallback');
  } finally {
    chalk.level = previousLevel;
  }
});
