import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { canonicalConfigSchema, type CanonicalConfig } from './schema.js';
import { hashConfig } from './repository.js';
import { readRegularConfigFile, type RuntimeConfigSnapshot } from './runtime-config.js';

export type FileReloadErrorCode =
  | 'file_read_failed'
  | 'config_invalid'
  | 'source_validation_failed'
  | 'apply_failed';

export interface FileReloadStatus {
  state: 'ready' | 'checking' | 'failed';
  lastAttemptAt: string | null;
  lastSuccessAt: string;
  lastErrorCode: FileReloadErrorCode | null;
  failedHash: string | null;
}

export interface FileReloadResult {
  outcome: 'unchanged' | 'applied' | 'failed';
  status: FileReloadStatus;
  snapshot?: RuntimeConfigSnapshot;
}

interface ConfigFileStat {
  mtimeMs: number;
  size: number;
}

export interface FileConfigReloaderOptions {
  path: string;
  initialSnapshot: RuntimeConfigSnapshot;
  intervalMs?: number;
  readConfigFile?: (path: string) => Promise<string>;
  statConfigFile?: (path: string) => Promise<ConfigFileStat>;
  validateConfig?: (config: CanonicalConfig) => Promise<void>;
  applySnapshot: (snapshot: RuntimeConfigSnapshot) => void | Promise<void>;
}

export interface FileConfigReloader {
  check(options?: { force?: boolean }): Promise<FileReloadResult>;
  status(): FileReloadStatus;
  start(): () => void;
  waitForIdle(): Promise<void>;
}

const rawHash = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

const statSignature = (value: ConfigFileStat) => `${value.mtimeMs}:${value.size}`;

const copyStatus = (value: FileReloadStatus): FileReloadStatus => ({ ...value });

export const createFileConfigReloader = ({
  path,
  initialSnapshot,
  intervalMs = 10_000,
  readConfigFile = readRegularConfigFile,
  statConfigFile = async configPath => {
    const value = await stat(configPath);
    return { mtimeMs: value.mtimeMs, size: value.size };
  },
  validateConfig = async () => undefined,
  applySnapshot,
}: FileConfigReloaderOptions): FileConfigReloader => {
  if (initialSnapshot.mode !== 'file') {
    throw new Error('File config reloader requires a file-mode initial snapshot');
  }

  let activeHash = initialSnapshot.contentHash;
  let lastSuccessfulStat: string | null = null;
  let inFlight: Promise<FileReloadResult> | null = null;
  let reloadStatus: FileReloadStatus = {
    state: 'ready',
    lastAttemptAt: null,
    lastSuccessAt: initialSnapshot.loadedAt,
    lastErrorCode: null,
    failedHash: null,
  };

  const fail = (code: FileReloadErrorCode, failedHash: string | null): FileReloadResult => {
    reloadStatus = {
      ...reloadStatus,
      state: 'failed',
      lastErrorCode: code,
      failedHash,
    };
    return { outcome: 'failed', status: copyStatus(reloadStatus) };
  };

  const runCheck = async (force: boolean): Promise<FileReloadResult> => {
    reloadStatus = {
      ...reloadStatus,
      state: 'checking',
      lastAttemptAt: new Date().toISOString(),
      lastErrorCode: null,
      failedHash: null,
    };

    let signature: string;
    try {
      signature = statSignature(await statConfigFile(path));
    } catch {
      return fail('file_read_failed', null);
    }
    if (!force && signature === lastSuccessfulStat) {
      reloadStatus = { ...reloadStatus, state: 'ready' };
      return { outcome: 'unchanged', status: copyStatus(reloadStatus) };
    }

    let content: string;
    try {
      content = await readConfigFile(path);
    } catch {
      return fail('file_read_failed', null);
    }
    const sourceHash = rawHash(content);

    let config: CanonicalConfig;
    try {
      config = canonicalConfigSchema.parse(parseYaml(content));
    } catch {
      return fail('config_invalid', sourceHash);
    }

    const contentHash = hashConfig(config);
    if (contentHash === activeHash) {
      lastSuccessfulStat = signature;
      reloadStatus = {
        ...reloadStatus,
        state: 'ready',
        lastSuccessAt: new Date().toISOString(),
      };
      return { outcome: 'unchanged', status: copyStatus(reloadStatus) };
    }

    try {
      await validateConfig(config);
    } catch {
      return fail('source_validation_failed', sourceHash);
    }

    const snapshot: RuntimeConfigSnapshot = {
      mode: 'file',
      revision: null,
      contentHash,
      loadedAt: new Date().toISOString(),
      config,
      filePath: path,
      fileSourceHash: sourceHash,
    };
    try {
      await applySnapshot(snapshot);
    } catch {
      return fail('apply_failed', sourceHash);
    }

    activeHash = contentHash;
    lastSuccessfulStat = signature;
    reloadStatus = {
      state: 'ready',
      lastAttemptAt: reloadStatus.lastAttemptAt,
      lastSuccessAt: snapshot.loadedAt,
      lastErrorCode: null,
      failedHash: null,
    };
    return { outcome: 'applied', snapshot, status: copyStatus(reloadStatus) };
  };

  const check = (options: { force?: boolean } = {}) => {
    if (inFlight) return inFlight;
    inFlight = runCheck(options.force ?? false).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const start = () => {
    const timer = setInterval(() => void check(), intervalMs);
    timer.unref();
    let stopWatch: () => void = () => undefined;
    try {
      const watcher = watch(path, () => void check({ force: true }));
      watcher.on('error', () => undefined);
      stopWatch = () => watcher.close();
    } catch {
      // Periodic stat remains authoritative when fs.watch is unavailable.
    }
    return () => {
      clearInterval(timer);
      stopWatch();
    };
  };

  return {
    check,
    status: () => copyStatus(reloadStatus),
    start,
    waitForIdle: async () => {
      await inFlight;
    },
  };
};
