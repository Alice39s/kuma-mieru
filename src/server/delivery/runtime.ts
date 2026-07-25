import type Database from 'better-sqlite3';
import type { CanonicalConfig } from '../config/schema.js';
import type { SecretStore } from '../secrets/store.js';
import type { PiiProtector } from '../subscriptions/crypto.js';
import { resolveSmtpTransportConfig } from './smtp-config.js';
import { createSmtpTransport, type SmtpTransportConfig } from './smtp.js';
import type { EmailDeliveryTransport } from './transport.js';
import { startDeliveryWorker, type DeliveryWorkerOptions } from './worker.js';

export interface DeliveryRuntimeStatus {
  state: 'disabled' | 'running' | 'failed';
  configured: boolean;
  appliedAt: string;
  lastErrorCode: string | null;
}

export interface CreateDeliveryRuntimeOptions {
  database: Database.Database;
  protector: PiiProtector;
  secretStore: SecretStore;
  createTransport?: (config: SmtpTransportConfig) => EmailDeliveryTransport;
  startWorker?: (options: DeliveryWorkerOptions) => () => void;
}

const runtimeErrorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'delivery_runtime_failed';

export const createDeliveryRuntime = ({
  database,
  protector,
  secretStore,
  createTransport: transportFactory = createSmtpTransport,
  startWorker = options => startDeliveryWorker(options),
}: CreateDeliveryRuntimeOptions) => {
  let stopWorker: () => void = () => undefined;
  let status: DeliveryRuntimeStatus = {
    state: 'disabled',
    configured: false,
    appliedAt: new Date().toISOString(),
    lastErrorCode: null,
  };

  const apply = (config: CanonicalConfig) => {
    const smtp = config.delivery?.smtp;
    if (!smtp?.enabled) {
      stopWorker();
      stopWorker = () => undefined;
      status = {
        state: 'disabled',
        configured: Boolean(smtp),
        appliedAt: new Date().toISOString(),
        lastErrorCode: null,
      };
      return status;
    }
    let pendingTransport: EmailDeliveryTransport | null = null;
    try {
      pendingTransport = transportFactory(resolveSmtpTransportConfig(smtp, secretStore));
      const stopNext = startWorker({
        database,
        protector,
        transport: pendingTransport,
        publicBaseUrl: config.server.publicBaseUrl as string,
      });
      pendingTransport = null;
      const stopPrevious = stopWorker;
      stopWorker = stopNext;
      stopPrevious();
      status = {
        state: 'running',
        configured: true,
        appliedAt: new Date().toISOString(),
        lastErrorCode: null,
      };
    } catch (error) {
      pendingTransport?.close();
      stopWorker();
      stopWorker = () => undefined;
      status = {
        state: 'failed',
        configured: true,
        appliedAt: new Date().toISOString(),
        lastErrorCode: runtimeErrorCode(error),
      };
    }
    return status;
  };

  const stop = () => {
    stopWorker();
    stopWorker = () => undefined;
  };

  return { apply, stop, status: () => ({ ...status }) };
};
