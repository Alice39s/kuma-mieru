import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const serverOutput = resolve(process.cwd(), 'dist', 'v2', 'server');

const collectTests = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(entry => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return collectTests(path);
      return Promise.resolve(entry.isFile() && entry.name.endsWith('.node.js') ? [path] : []);
    })
  );
  return nested.flat().sort();
};

const tests = await collectTests(serverOutput);
if (tests.length === 0) {
  throw new Error(`No compiled v2 tests found below ${serverOutput}`);
}

process.stdout.write(`Running ${tests.length} compiled v2 test files\n`);
const child = Bun.spawn(['node', '--test', ...tests], {
  cwd: process.cwd(),
  env: process.env,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
const exitCode = await child.exited;
if (exitCode !== 0) process.exit(exitCode);
