import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { openDatabase } from './database.js';
import { migrateDatabase } from './migrator.js';

const sourceMigration = resolve(process.cwd(), 'migrations', '000001_foundation.up.sql');

const createFixture = async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-migration-'));
  const sql = await readFile(sourceMigration, 'utf8');
  await writeFile(resolve(directory, '000001_foundation.up.sql'), sql);
  return directory;
};

test('applies migrations once and records the checksum ledger', async () => {
  const directory = await createFixture();
  const { database } = openDatabase(':memory:');
  try {
    const first = await migrateDatabase(database, { directory, appBuild: 'test' });
    const second = await migrateDatabase(database, { directory, appBuild: 'test' });
    assert.deepEqual(first.applied, [1]);
    assert.deepEqual(second.applied, []);
    assert.equal(first.currentVersion, 1);
    assert.equal(
      (
        database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
          count: number;
        }
      ).count,
      1
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a modified migration that was already applied', async () => {
  const directory = await createFixture();
  const { database } = openDatabase(':memory:');
  try {
    await migrateDatabase(database, { directory, appBuild: 'test' });
    const path = resolve(directory, '000001_foundation.up.sql');
    await writeFile(path, `${await readFile(path, 'utf8')}\n-- drift\n`);
    await assert.rejects(
      migrateDatabase(database, { directory, appBuild: 'test' }),
      /Migration drift detected/u
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects migration files whose names do not match the ledger convention', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-migration-'));
  const { database } = openDatabase(':memory:');
  try {
    await writeFile(resolve(directory, '1_bad.up.sql'), 'SELECT 1;');
    await assert.rejects(
      migrateDatabase(database, { directory, appBuild: 'test' }),
      /Invalid migration filename/u
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
