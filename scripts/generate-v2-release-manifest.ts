import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { z } from 'zod';

const releaseSpecSchema = z.object({
  schemaVersion: z.literal(1),
  product: z.literal('kuma-mieru'),
  version: z.string().regex(/^2\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
  channel: z.enum(['development', 'alpha', 'beta', 'rc', 'stable']),
  stable: z.boolean(),
  runtime: z.object({
    node: z.string().min(1),
    uid: z.number().int().positive(),
    gid: z.number().int().positive(),
    dataDirectory: z.literal('/data'),
  }),
  database: z.object({
    minimumSchemaVersion: z.number().int().nonnegative(),
    maximumSchemaVersion: z.number().int().positive(),
  }),
  compatibility: z.object({
    supportedMajor: z.literal(2),
    legacyRoutes: z.array(z.string().startsWith('/')).min(1),
    legacyEnvironment: z.array(z.string().min(1)).min(1),
  }),
});

const root = process.cwd();
const outputDirectory = resolve(root, 'dist', 'v2');
const manifestPath = resolve(outputDirectory, 'release-manifest.json');
const sha256 = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');
const toPosix = (path: string) => path.replaceAll('\\', '/');
const git = (arguments_: string[]) =>
  execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' }).trim();

const collectFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(entry => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return collectFiles(path);
      return Promise.resolve(entry.isFile() && path !== manifestPath ? [path] : []);
    })
  );
  return nested.flat().sort();
};

const spec = releaseSpecSchema.parse(
  JSON.parse(await readFile(resolve(root, 'release', 'v2', 'release-spec.json'), 'utf8'))
);
if (spec.stable !== (spec.channel === 'stable')) {
  throw new Error('release-spec stable must be true exactly when channel is stable');
}

const migrationDirectory = resolve(root, 'migrations');
const migrationNames = (await readdir(migrationDirectory))
  .filter(name => name.endsWith('.up.sql'))
  .sort();
const migrations = await Promise.all(
  migrationNames.map(async (name, index) => {
    const match = /^(\d{6})_([a-z0-9_]+)\.up\.sql$/u.exec(name);
    if (!match) throw new Error(`Invalid migration filename: ${name}`);
    const version = Number(match[1]);
    if (version !== index + 1) {
      throw new Error(`Migration sequence is not contiguous at ${name}`);
    }
    const content = await readFile(resolve(migrationDirectory, name));
    const bundled = await readFile(resolve(outputDirectory, 'server', 'migrations', name));
    if (sha256(content) !== sha256(bundled)) {
      throw new Error(`Bundled migration differs from source: ${name}`);
    }
    return { version, name, sha256: sha256(content), bytes: content.byteLength };
  })
);
const maximumMigrationVersion = migrations.at(-1)?.version ?? 0;
if (maximumMigrationVersion !== spec.database.maximumSchemaVersion) {
  throw new Error(
    `release-spec maximumSchemaVersion=${spec.database.maximumSchemaVersion}, migrations end at ${maximumMigrationVersion}`
  );
}

const dirty = git(['status', '--porcelain']).length > 0;
if (process.argv.includes('--strict') && dirty) {
  throw new Error('Strict release manifest generation requires a clean Git worktree');
}
const commit = process.env.GITHUB_SHA ?? git(['rev-parse', 'HEAD']);
const committedAt = git(['show', '-s', '--format=%cI', commit]);
const files = await collectFiles(outputDirectory);
const artifacts = await Promise.all(
  files.map(async path => {
    const content = await readFile(path);
    return {
      path: toPosix(relative(outputDirectory, path)),
      sha256: sha256(content),
      bytes: content.byteLength,
    };
  })
);

const manifest = {
  schemaVersion: 1,
  product: spec.product,
  version: spec.version,
  channel: spec.channel,
  stable: spec.stable,
  source: { commit, committedAt, dirty },
  runtime: spec.runtime,
  database: { ...spec.database, migrations },
  compatibility: spec.compatibility,
  artifacts,
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${manifestPath}\n`);
