import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const outputDirectory = resolve(root, 'dist', 'v2');

const run = async (script: string) => {
  const child = Bun.spawn(['bun', 'run', script], {
    cwd: root,
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${script} failed with exit code ${exitCode}`);
  }
};

await rm(outputDirectory, { recursive: true, force: true });
await run('build:v2:web');
await run('build:v2:server');
await mkdir(resolve(outputDirectory, 'server'), { recursive: true });
await cp(resolve(root, 'migrations'), resolve(outputDirectory, 'server', 'migrations'), {
  recursive: true,
});
