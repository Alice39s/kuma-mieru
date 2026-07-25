import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { acquireRuntimeLock, runtimeLockErrorCode } from './runtime-lock.js';

test('holds one exclusive runtime owner and releases it idempotently', async () => {
  const dataDirectory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-runtime-lock-'));
  try {
    const first = await acquireRuntimeLock({ dataDirectory, appBuild: 'test-first' });
    assert.equal(first.isHeld(), true);
    assert.equal((await lstat(resolve(dataDirectory, '.runtime'))).mode & 0o777, 0o700);
    assert.equal((await lstat(first.path)).mode & 0o777, 0o600);
    await assert.rejects(acquireRuntimeLock({ dataDirectory, appBuild: 'test-second' }), error => {
      assert.equal(runtimeLockErrorCode(error), 'runtime_lock_held');
      return true;
    });
    first.release();
    first.release();
    assert.equal(first.isHeld(), false);

    const second = await acquireRuntimeLock({ dataDirectory, appBuild: 'test-second' });
    assert.equal(second.isHeld(), true);
    second.release();
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('rejects symlinked runtime directories, lock files, and corrupt lock databases', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-runtime-lock-'));
  const target = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-runtime-lock-target-'));
  try {
    const directoryLinkData = resolve(root, 'directory-link');
    await mkdir(directoryLinkData, { recursive: true });
    await symlink(target, resolve(directoryLinkData, '.runtime'));
    await assert.rejects(
      acquireRuntimeLock({ dataDirectory: directoryLinkData, appBuild: 'test' }),
      error => {
        assert.equal(runtimeLockErrorCode(error), 'runtime_lock_directory_unsafe');
        return true;
      }
    );

    const fileLinkData = resolve(root, 'file-link');
    const runtimeDirectory = resolve(fileLinkData, '.runtime');
    await mkdir(runtimeDirectory, { recursive: true });
    const symlinkTarget = resolve(root, 'target.sqlite3');
    await writeFile(symlinkTarget, 'not-used');
    await symlink(symlinkTarget, resolve(runtimeDirectory, 'kuma-mieru-runtime-lock.sqlite3'));
    await assert.rejects(
      acquireRuntimeLock({ dataDirectory: fileLinkData, appBuild: 'test' }),
      error => {
        assert.equal(runtimeLockErrorCode(error), 'runtime_lock_path_unsafe');
        return true;
      }
    );

    const corruptData = resolve(root, 'corrupt');
    const corruptRuntime = resolve(corruptData, '.runtime');
    await mkdir(corruptRuntime, { recursive: true });
    const corruptPath = resolve(corruptRuntime, 'kuma-mieru-runtime-lock.sqlite3');
    await writeFile(corruptPath, 'not a sqlite database');
    await assert.rejects(
      acquireRuntimeLock({ dataDirectory: corruptData, appBuild: 'test' }),
      error => {
        assert.equal(runtimeLockErrorCode(error), 'runtime_lock_invalid');
        return true;
      }
    );
    assert.equal((await lstat(corruptPath)).size, 'not a sqlite database'.length);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test('releases operating-system ownership after a holder is killed', async () => {
  const dataDirectory = await mkdtemp(resolve(tmpdir(), 'kuma-mieru-runtime-lock-crash-'));
  const moduleUrl = new URL('./runtime-lock.js', import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { acquireRuntimeLock } from ${JSON.stringify(moduleUrl)};
       globalThis.runtimeLock = await acquireRuntimeLock({
         dataDirectory: process.argv[1],
         appBuild: 'crash-holder'
       });
       process.stdout.write('ready\\n');
       setInterval(() => undefined, 60_000);`,
      dataDirectory,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  try {
    assert.ok(child.stdout);
    const [chunk] = (await once(child.stdout, 'data')) as [Buffer];
    assert.equal(chunk.toString().trim(), 'ready');
    await assert.rejects(acquireRuntimeLock({ dataDirectory, appBuild: 'contender' }), error => {
      assert.equal(runtimeLockErrorCode(error), 'runtime_lock_held');
      return true;
    });
    child.kill('SIGKILL');
    await once(child, 'exit');
    const recovered = await acquireRuntimeLock({ dataDirectory, appBuild: 'recovered' });
    assert.equal(recovered.isHeld(), true);
    recovered.release();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
