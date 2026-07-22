import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const keyringDocumentSchema = z.object({
  version: z.literal(1),
  currentKeyId: z.string().min(1).max(200),
  keys: z.record(z.string().min(1).max(200), z.string().min(1)),
});

export interface SecretKeyring {
  currentKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

const parseKeyring = (input: string): SecretKeyring => {
  const document = keyringDocumentSchema.parse(JSON.parse(input));
  const keys = new Map(
    Object.entries(document.keys).map(([keyId, encoded]) => {
      const key = Buffer.from(encoded, 'base64url');
      if (key.length !== 32) throw new Error(`Secret key ${keyId} must contain exactly 32 bytes`);
      return [keyId, key] as const;
    })
  );
  if (!keys.has(document.currentKeyId)) {
    throw new Error('Secret keyring currentKeyId does not reference an available key');
  }
  return { currentKeyId: document.currentKeyId, keys };
};

const createKeyringDocument = () => {
  const currentKeyId = `local-${randomBytes(8).toString('hex')}`;
  return `${JSON.stringify(
    {
      version: 1,
      currentKeyId,
      keys: { [currentKeyId]: randomBytes(32).toString('base64url') },
    },
    null,
    2
  )}\n`;
};

export const loadOrCreateSecretKeyring = async (
  dataDirectory: string,
  environment = process.env
): Promise<SecretKeyring> => {
  const mountedPath = environment.KUMA_MIERU_MASTER_KEY_FILE;
  const path = mountedPath
    ? resolve(mountedPath)
    : resolve(dataDirectory, '.secrets', 'keyring.json');

  if (!mountedPath) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(createKeyringDocument(), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    }
    await chmod(path, 0o600);
  }

  return parseKeyring((await readFile(path, 'utf8')).trim());
};
