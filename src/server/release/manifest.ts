import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { releaseChannelSchema } from './spec.js';

export const releaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  product: z.literal('kuma-mieru'),
  version: z.string().min(1),
  channel: releaseChannelSchema,
  stable: z.boolean(),
  source: z.object({
    commit: z.string().min(7),
    committedAt: z.string().datetime({ offset: true }),
    dirty: z.boolean(),
    verified: z.boolean(),
  }),
  database: z.object({
    minimumSchemaVersion: z.number().int().nonnegative(),
    maximumSchemaVersion: z.number().int().positive(),
  }),
  container: z.object({
    image: z.string().min(1),
    developmentTag: z.string().min(1),
    readOnlyRootFilesystem: z.literal(true),
    dropAllCapabilities: z.literal(true),
    noNewPrivileges: z.literal(true),
    dockerSocket: z.literal(false),
  }),
  artifacts: z.array(
    z.object({
      path: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      bytes: z.number().int().nonnegative(),
    })
  ),
});

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export const loadReleaseManifest = async (
  path: string,
  options: { required: boolean }
): Promise<ReleaseManifest | null> => {
  try {
    return releaseManifestSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (
      !options.required &&
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
};

export const assertReleaseBuild = (manifest: ReleaseManifest, buildVersion: string) => {
  if (buildVersion !== manifest.version) {
    throw new Error(
      `Runtime version ${buildVersion} differs from release manifest ${manifest.version}`
    );
  }
};

export const assertReleaseSchema = (manifest: ReleaseManifest, schemaVersion: number) => {
  if (
    schemaVersion < manifest.database.minimumSchemaVersion ||
    schemaVersion > manifest.database.maximumSchemaVersion
  ) {
    throw new Error(
      `Runtime schema ${schemaVersion} is outside release range ` +
        `${manifest.database.minimumSchemaVersion}-${manifest.database.maximumSchemaVersion}`
    );
  }
};
