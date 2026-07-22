import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export interface OpenDatabaseResult {
  database: Database.Database;
  path: string;
}

export const openDatabase = (inputPath: string): OpenDatabaseResult => {
  const path = inputPath === ':memory:' ? inputPath : resolve(inputPath);

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const database = new Database(path);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');

  if (path !== ':memory:') {
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
  }

  return { database, path };
};
