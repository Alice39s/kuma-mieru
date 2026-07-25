import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { releaseSpecSchema } from '../src/server/release/spec.ts';

const root = process.cwd();
const outputDirectory = resolve(root, 'dist', 'v2');
const manifestPath = resolve(outputDirectory, 'release-manifest.json');
const sha256 = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');
const toPosix = (path: string) => path.replaceAll('\\', '/');
const git = (arguments_: string[]) =>
  execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' }).trim();
const tryGit = (arguments_: string[]) => {
  try {
    return git(arguments_);
  } catch {
    return null;
  }
};
const sourceOverride = {
  commit: process.env.KUMA_MIERU_SOURCE_COMMIT,
  committedAt: process.env.KUMA_MIERU_SOURCE_COMMITTED_AT,
};
if (Boolean(sourceOverride.commit) !== Boolean(sourceOverride.committedAt)) {
  throw new Error(
    'KUMA_MIERU_SOURCE_COMMIT and KUMA_MIERU_SOURCE_COMMITTED_AT must be provided together'
  );
}

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

const usesSourceOverride = Boolean(sourceOverride.commit);
const repositoryCommit = tryGit(['rev-parse', 'HEAD']);
const commit =
  sourceOverride.commit ?? process.env.GITHUB_SHA ?? repositoryCommit ?? 'unverified';
const commitExists =
  commit !== 'unverified' && tryGit(['cat-file', '-e', `${commit}^{commit}`]) !== null;
const committedAt =
  sourceOverride.committedAt ??
  (commitExists ? tryGit(['show', '-s', '--format=%cI', commit]) : null) ??
  '1970-01-01T00:00:00Z';
const repositoryStatus = tryGit(['status', '--porcelain']);
const dirty = usesSourceOverride
  ? process.env.KUMA_MIERU_SOURCE_DIRTY === 'true'
  : repositoryStatus === null || repositoryStatus.length > 0;
const sourceVerified = usesSourceOverride
  ? process.env.KUMA_MIERU_SOURCE_VERIFIED === 'true'
  : repositoryCommit !== null && commitExists;
if (process.argv.includes('--strict') && (!sourceVerified || dirty)) {
  throw new Error('Strict release manifest generation requires verified, clean source evidence');
}
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
  source: { commit, committedAt, dirty, verified: sourceVerified },
  runtime: spec.runtime,
  database: { ...spec.database, migrations },
  container: spec.container,
  compatibility: spec.compatibility,
  artifacts,
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${manifestPath}\n`);
