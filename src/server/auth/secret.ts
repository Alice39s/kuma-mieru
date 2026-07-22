import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const minimumSecretLength = 32;

export const loadOrCreateAuthSecret = async (dataDirectory: string, environment = process.env) => {
  const fromEnvironment = environment.KUMA_MIERU_AUTH_SECRET;
  if (fromEnvironment) {
    if (fromEnvironment.length < minimumSecretLength) {
      throw new Error(
        `KUMA_MIERU_AUTH_SECRET must contain at least ${minimumSecretLength} characters`
      );
    }
    return fromEnvironment;
  }

  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const path = resolve(dataDirectory, 'auth-secret');
  try {
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(randomBytes(48).toString('base64url'), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
  }

  await chmod(path, 0o600);
  const secret = (await readFile(path, 'utf8')).trim();
  if (secret.length < minimumSecretLength) {
    throw new Error('Persisted auth secret is invalid');
  }
  return secret;
};
