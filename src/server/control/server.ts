import { createServer, type Server } from 'node:http';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError, type ConnectRouter, type HandlerContext } from '@connectrpc/connect';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import type Database from 'better-sqlite3';
import type { KumaAuth } from '../auth/auth.js';
import { mutateManagedConfig } from '../config/managed-config.js';
import type { ConfigRevision } from '../config/repository.js';
import type { RuntimeConfigSnapshot } from '../config/runtime-config.js';
import type { createSecretStore } from '../secrets/store.js';
import {
  CreateHttpMonitorResponseSchema,
  CreateProviderResponseSchema,
  DeleteProviderResponseSchema,
  GetMonitorResponseSchema,
  GetOperationResponseSchema,
  GetProviderResponseSchema,
  ListMonitorsResponseSchema,
  ListOperationsResponseSchema,
  ListProvidersResponseSchema,
  MonitorService,
  OperationService,
  PauseMonitorResponseSchema,
  ProviderKind,
  ProviderService,
  ResolveOperationResponseSchema,
  ResumeMonitorResponseSchema,
  RotateProviderCredentialResponseSchema,
  TestProviderResponseSchema,
  UpdateHttpMonitorResponseSchema,
  UpdateProviderResponseSchema,
  type Provider,
} from './gen/kuma/mieru/control/v1/control_pb.js';
import { createOperationStore } from './operations.js';
import {
  createHttpMonitor,
  getMonitor,
  listMonitors,
  setMonitorPaused,
  testProvider,
  updateHttpMonitor,
  type ControlProviderKind,
  type ProviderRuntime,
} from './providers.js';

type SecretStore = ReturnType<typeof createSecretStore>;

interface ControlServerOptions {
  address: string;
  database: Database.Database;
  getAuth: () => KumaAuth;
  authSecret: string;
  secretStore: SecretStore;
  getSnapshot: () => RuntimeConfigSnapshot;
  applyRevision: (revision: ConfigRevision) => void | Promise<void>;
}

const codeFor = (error: unknown) => {
  const code =
    typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  switch (code) {
    case 'invalid_argument':
      return Code.InvalidArgument;
    case 'already_exists':
    case 'config_revision_conflict':
      return Code.AlreadyExists;
    case 'not_found':
      return Code.NotFound;
    case 'failed_precondition':
    case 'managed_config_missing':
      return Code.FailedPrecondition;
    case 'provider_rate_limited':
      return Code.ResourceExhausted;
    default:
      return Code.Unavailable;
  }
};

const asConnectError = (error: unknown) =>
  error instanceof ConnectError
    ? error
    : new ConnectError(
        error instanceof Error ? error.message : 'Control operation failed',
        codeFor(error)
      );

const providerKind = (kind: ProviderKind): ControlProviderKind => {
  if (kind === ProviderKind.UPTIME_ROBOT_V3) return 'uptime-robot-v3';
  if (kind === ProviderKind.BETTER_STACK_UPTIME_V2) return 'better-stack-uptime-v2';
  throw new ConnectError('Provider kind is required', Code.InvalidArgument);
};

const protoProviderKind = (kind: ControlProviderKind) =>
  kind === 'uptime-robot-v3' ? ProviderKind.UPTIME_ROBOT_V3 : ProviderKind.BETTER_STACK_UPTIME_V2;

const providerMessage = (
  value: NonNullable<RuntimeConfigSnapshot['config']['controlProviders']>[number],
  revision: number | null
): Provider => ({
  $typeName: 'kuma.mieru.control.v1.Provider',
  id: value.id,
  kind: protoProviderKind(value.kind),
  displayName: value.displayName,
  enabled: value.enabled,
  ...(value.sourceRef ? { sourceRef: value.sourceRef } : {}),
  credentialPresent: true,
  configRevision: BigInt(revision ?? 0),
});

const parseBearer = (headers: Headers) => {
  const authorization = headers.get('authorization') ?? '';
  const [scheme, token, extra] = authorization.split(' ');
  if (scheme !== 'Bearer' || !token || extra) {
    throw new ConnectError('A Control API key is required', Code.Unauthenticated);
  }
  return token;
};

const authenticate = async (
  getAuth: () => KumaAuth,
  context: HandlerContext,
  permissions: Record<string, string[]>
) => {
  const token = parseBearer(context.requestHeader);
  const api = getAuth().api as unknown as {
    verifyApiKey(input: {
      body: { key: string; configId: string; permissions: Record<string, string[]> };
    }): Promise<{
      valid: boolean;
      key: null | { id: string; referenceId?: string; userId?: string };
    }>;
  };
  const result = await api.verifyApiKey({
    body: { key: token, configId: 'control-rpc', permissions },
  });
  if (!result.valid || !result.key) {
    throw new ConnectError('Control API key is invalid or lacks permission', Code.PermissionDenied);
  }
  return result.key.referenceId ?? result.key.userId ?? result.key.id;
};

const runtimeProvider = (
  snapshot: RuntimeConfigSnapshot,
  secretStore: SecretStore,
  id: string
): ProviderRuntime => {
  const provider = (snapshot.config.controlProviders ?? []).find(candidate => candidate.id === id);
  if (!provider || !provider.enabled) {
    throw Object.assign(new Error('Control provider was not found or is disabled'), {
      code: 'not_found',
    });
  }
  return {
    id: provider.id,
    kind: provider.kind,
    token: secretStore.resolve(provider.secretRef, {
      resourceId: provider.id,
      fieldName: 'bearer-token',
      purpose: 'control-provider-credential',
    }),
  };
};

export const startControlServer = (options: ControlServerOptions): Server => {
  const operations = createOperationStore(options.database, options.authSecret);
  const mutation = async <T>(
    input: {
      requestId: string;
      principalId: string;
      providerId: string;
      action: string;
      payload: unknown;
    },
    execute: () => Promise<{ value: T; externalId?: string }>
  ) => {
    const started = operations.begin(input);
    if (started.replay) return { operation: started.operation, value: undefined as T | undefined };
    try {
      const result = await execute();
      return {
        operation: operations.complete(input.requestId, {
          state: 'succeeded',
          externalId: result.externalId,
        }),
        value: result.value,
      };
    } catch (error) {
      const outcomeUnknown =
        typeof error === 'object' &&
        error &&
        'outcomeUnknown' in error &&
        error.outcomeUnknown === true;
      operations.complete(input.requestId, {
        state: outcomeUnknown ? 'outcome_unknown' : 'failed',
        errorCode:
          typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
            ? error.code
            : 'provider_request_failed',
      });
      throw error;
    }
  };

  const handler = connectNodeAdapter({
    routes: (router: ConnectRouter) => {
      router.service(ProviderService, {
        async listProviders(_request, context) {
          await authenticate(options.getAuth, context, { provider: ['read'] });
          const snapshot = options.getSnapshot();
          return create(ListProvidersResponseSchema, {
            providers: (snapshot.config.controlProviders ?? []).map(value =>
              providerMessage(value, snapshot.revision)
            ),
          });
        },
        async getProvider(request, context) {
          await authenticate(options.getAuth, context, { provider: ['read'] });
          const snapshot = options.getSnapshot();
          const provider = (snapshot.config.controlProviders ?? []).find(
            value => value.id === request.id
          );
          if (!provider) throw new ConnectError('Provider was not found', Code.NotFound);
          return create(GetProviderResponseSchema, {
            provider: providerMessage(provider, snapshot.revision),
          });
        },
        async testProvider(request, context) {
          await authenticate(options.getAuth, context, { provider: ['write'] });
          if (!request.provider)
            throw new ConnectError('Provider draft is required', Code.InvalidArgument);
          const result = await testProvider({
            id: request.provider.id,
            kind: providerKind(request.provider.kind),
            token: request.provider.bearerToken,
          });
          return create(TestProviderResponseSchema, result);
        },
        async createProvider(request, context) {
          const principalId = await authenticate(options.getAuth, context, { provider: ['write'] });
          if (!request.provider)
            throw new ConnectError('Provider draft is required', Code.InvalidArgument);
          if (options.getSnapshot().mode !== 'managed') {
            throw new ConnectError(
              'Provider configuration is writable only in managed mode',
              Code.FailedPrecondition
            );
          }
          const result = await mutation(
            {
              requestId: request.requestId,
              principalId,
              providerId: request.provider.id,
              action: 'provider.create',
              payload: { ...request.provider, bearerToken: '[secret]' },
            },
            async () => {
              await testProvider({
                id: request.provider!.id,
                kind: providerKind(request.provider!.kind),
                token: request.provider!.bearerToken,
              });
              const revision = options.database.transaction(() => {
                const secret = options.secretStore.put(
                  {
                    resourceId: request.provider!.id,
                    fieldName: 'bearer-token',
                    purpose: 'control-provider-credential',
                  },
                  request.provider!.bearerToken
                );
                return mutateManagedConfig(options.database, {
                  expectedRevision: Number(request.expectedRevision),
                  audit: { actorId: principalId, requestId: request.requestId },
                  action: 'control-provider.create',
                  targetType: 'control-provider',
                  targetId: request.provider!.id,
                  mutate: config => ({
                    ...config,
                    controlProviders: [
                      ...(config.controlProviders ?? []),
                      {
                        id: request.provider!.id,
                        kind: providerKind(request.provider!.kind),
                        displayName: request.provider!.displayName,
                        enabled: true,
                        ...(request.provider!.sourceRef
                          ? { sourceRef: request.provider!.sourceRef }
                          : {}),
                        secretRef: secret.secretRef,
                      },
                    ],
                  }),
                });
              })();
              await options.applyRevision(revision);
              const provider = (revision.config.controlProviders ?? []).find(
                value => value.id === request.provider!.id
              )!;
              return { value: providerMessage(provider, revision.revision) };
            }
          );
          const provider =
            result.value ??
            (() => {
              const snapshot = options.getSnapshot();
              const current = (snapshot.config.controlProviders ?? []).find(
                value => value.id === request.provider!.id
              );
              return current ? providerMessage(current, snapshot.revision) : undefined;
            })();
          if (!provider) {
            throw new ConnectError(
              'Replayed provider is no longer available',
              Code.FailedPrecondition
            );
          }
          return create(CreateProviderResponseSchema, {
            provider,
            operation: result.operation,
          });
        },
        async updateProvider(request, context) {
          const principalId = await authenticate(options.getAuth, context, { provider: ['write'] });
          if (!request.provider)
            throw new ConnectError('Provider is required', Code.InvalidArgument);
          if (
            !(options.getSnapshot().config.controlProviders ?? []).some(
              value => value.id === request.provider!.id
            )
          ) {
            throw new ConnectError('Provider was not found', Code.NotFound);
          }
          const result = await mutation(
            {
              requestId: request.requestId,
              principalId,
              providerId: request.provider.id,
              action: 'provider.update',
              payload: request,
            },
            async () => {
              const paths = request.updateMask?.paths ?? [];
              const revision = mutateManagedConfig(options.database, {
                expectedRevision: Number(request.expectedRevision),
                audit: { actorId: principalId, requestId: request.requestId },
                action: 'control-provider.update',
                targetType: 'control-provider',
                targetId: request.provider!.id,
                mutate: config => ({
                  ...config,
                  controlProviders: (config.controlProviders ?? []).map(provider =>
                    provider.id !== request.provider!.id
                      ? provider
                      : {
                          ...provider,
                          ...(paths.includes('display_name')
                            ? { displayName: request.provider!.displayName }
                            : {}),
                          ...(paths.includes('enabled')
                            ? { enabled: request.provider!.enabled }
                            : {}),
                          ...(paths.includes('source_ref')
                            ? { sourceRef: request.provider!.sourceRef }
                            : {}),
                        }
                  ),
                }),
              });
              await options.applyRevision(revision);
              const provider = (revision.config.controlProviders ?? []).find(
                value => value.id === request.provider!.id
              );
              if (!provider)
                throw Object.assign(new Error('Provider not found'), { code: 'not_found' });
              return { value: providerMessage(provider, revision.revision) };
            }
          );
          const provider =
            result.value ??
            (() => {
              const snapshot = options.getSnapshot();
              const current = (snapshot.config.controlProviders ?? []).find(
                value => value.id === request.provider!.id
              );
              return current ? providerMessage(current, snapshot.revision) : undefined;
            })();
          if (!provider) {
            throw new ConnectError(
              'Replayed provider is no longer available',
              Code.FailedPrecondition
            );
          }
          return create(UpdateProviderResponseSchema, {
            provider,
            operation: result.operation,
          });
        },
        async rotateProviderCredential(request, context) {
          const principalId = await authenticate(options.getAuth, context, { provider: ['write'] });
          const result = await mutation(
            {
              requestId: request.requestId,
              principalId,
              providerId: request.providerId,
              action: 'provider.rotate-credential',
              payload: { ...request, bearerToken: '[secret]' },
            },
            async () => {
              const provider = runtimeProvider(
                options.getSnapshot(),
                options.secretStore,
                request.providerId
              );
              await testProvider({ ...provider, token: request.bearerToken });
              options.secretStore.put(
                {
                  resourceId: request.providerId,
                  fieldName: 'bearer-token',
                  purpose: 'control-provider-credential',
                },
                request.bearerToken
              );
              return { value: undefined };
            }
          );
          return create(RotateProviderCredentialResponseSchema, { operation: result.operation });
        },
        async deleteProvider(request, context) {
          const principalId = await authenticate(options.getAuth, context, { provider: ['write'] });
          const result = await mutation(
            {
              requestId: request.requestId,
              principalId,
              providerId: request.providerId,
              action: 'provider.delete',
              payload: request,
            },
            async () => {
              const snapshot = options.getSnapshot();
              const provider = (snapshot.config.controlProviders ?? []).find(
                value => value.id === request.providerId
              );
              if (!provider)
                throw Object.assign(new Error('Provider not found'), { code: 'not_found' });
              const unresolved = options.database
                .prepare(
                  `SELECT 1 FROM control_operations
                   WHERE provider_id = ? AND request_id != ?
                     AND state IN ('pending', 'outcome_unknown') LIMIT 1`
                )
                .get(request.providerId, request.requestId);
              if (unresolved) {
                throw Object.assign(new Error('Provider has unresolved operations'), {
                  code: 'failed_precondition',
                });
              }
              const revision = mutateManagedConfig(options.database, {
                expectedRevision: Number(request.expectedRevision),
                audit: { actorId: principalId, requestId: request.requestId },
                action: 'control-provider.delete',
                targetType: 'control-provider',
                targetId: request.providerId,
                mutate: config => ({
                  ...config,
                  controlProviders: (config.controlProviders ?? []).filter(
                    value => value.id !== request.providerId
                  ),
                }),
              });
              options.secretStore.remove(provider.secretRef, {
                resourceId: request.providerId,
                fieldName: 'bearer-token',
                purpose: 'control-provider-credential',
              });
              await options.applyRevision(revision);
              return { value: undefined };
            }
          );
          return create(DeleteProviderResponseSchema, { operation: result.operation });
        },
      });

      router.service(MonitorService, {
        async listMonitors(request, context) {
          await authenticate(options.getAuth, context, { monitor: ['read'] });
          const page = await listMonitors(
            runtimeProvider(options.getSnapshot(), options.secretStore, request.providerId),
            request.pageSize,
            request.pageToken
          );
          return create(ListMonitorsResponseSchema, {
            monitors: page.items,
            ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
          });
        },
        async getMonitor(request, context) {
          await authenticate(options.getAuth, context, { monitor: ['read'] });
          return create(GetMonitorResponseSchema, {
            monitor: await getMonitor(
              runtimeProvider(options.getSnapshot(), options.secretStore, request.providerId),
              request.externalId
            ),
          });
        },
        async createHttpMonitor(request, context) {
          const principalId = await authenticate(options.getAuth, context, { monitor: ['write'] });
          if (!request.monitor)
            throw new ConnectError('Monitor draft is required', Code.InvalidArgument);
          const provider = runtimeProvider(
            options.getSnapshot(),
            options.secretStore,
            request.providerId
          );
          const result = await mutation(
            {
              requestId: request.requestId,
              principalId,
              providerId: request.providerId,
              action: 'monitor.create',
              payload: request,
            },
            async () => {
              const monitor = await createHttpMonitor(provider, request.monitor!);
              return { value: monitor, externalId: monitor.externalId };
            }
          );
          const monitor =
            result.value ??
            (result.operation.externalId
              ? await getMonitor(provider, result.operation.externalId)
              : undefined);
          return create(CreateHttpMonitorResponseSchema, { monitor, operation: result.operation });
        },
        async updateHttpMonitor(request, context) {
          const principalId = await authenticate(options.getAuth, context, { monitor: ['write'] });
          if (!request.monitor)
            throw new ConnectError('Monitor draft is required', Code.InvalidArgument);
          const provider = runtimeProvider(
            options.getSnapshot(),
            options.secretStore,
            request.providerId
          );
          const current = await getMonitor(provider, request.externalId);
          if (current.fingerprint !== request.expectedFingerprint) {
            throw new ConnectError('Monitor fingerprint changed', Code.Aborted);
          }
          const result = await mutation(
            {
              requestId: request.requestId,
              principalId,
              providerId: request.providerId,
              action: 'monitor.update',
              payload: request,
            },
            async () => ({
              value: await updateHttpMonitor(
                provider,
                request.externalId,
                request.monitor!,
                request.updateMask?.paths ?? []
              ),
              externalId: request.externalId,
            })
          );
          return create(UpdateHttpMonitorResponseSchema, {
            monitor: result.value ?? current,
            operation: result.operation,
          });
        },
        async pauseMonitor(request, context) {
          const principalId = await authenticate(options.getAuth, context, { monitor: ['write'] });
          const provider = runtimeProvider(
            options.getSnapshot(),
            options.secretStore,
            request.providerId
          );
          const current = await getMonitor(provider, request.externalId);
          if (current.fingerprint !== request.expectedFingerprint)
            throw new ConnectError('Monitor fingerprint changed', Code.Aborted);
          const result = await mutation(
            {
              requestId: request.requestId,
              principalId,
              providerId: request.providerId,
              action: 'monitor.pause',
              payload: request,
            },
            async () => ({
              value: await setMonitorPaused(provider, request.externalId, true),
              externalId: request.externalId,
            })
          );
          return create(PauseMonitorResponseSchema, {
            monitor: result.value ?? current,
            operation: result.operation,
          });
        },
        async resumeMonitor(request, context) {
          const principalId = await authenticate(options.getAuth, context, { monitor: ['write'] });
          const provider = runtimeProvider(
            options.getSnapshot(),
            options.secretStore,
            request.providerId
          );
          const current = await getMonitor(provider, request.externalId);
          if (current.fingerprint !== request.expectedFingerprint)
            throw new ConnectError('Monitor fingerprint changed', Code.Aborted);
          const result = await mutation(
            {
              requestId: request.requestId,
              principalId,
              providerId: request.providerId,
              action: 'monitor.resume',
              payload: request,
            },
            async () => ({
              value: await setMonitorPaused(provider, request.externalId, false),
              externalId: request.externalId,
            })
          );
          return create(ResumeMonitorResponseSchema, {
            monitor: result.value ?? current,
            operation: result.operation,
          });
        },
      });

      router.service(OperationService, {
        async getOperation(request, context) {
          await authenticate(options.getAuth, context, { operation: ['read'] });
          return create(GetOperationResponseSchema, {
            operation: operations.get(request.requestId),
          });
        },
        async listOperations(request, context) {
          await authenticate(options.getAuth, context, { operation: ['read'] });
          const limit = Math.min(Math.max(request.pageSize || 100, 1), 200);
          const offset = request.pageToken ? Number(request.pageToken) : 0;
          if (!Number.isSafeInteger(offset) || offset < 0)
            throw new ConnectError('Invalid page token', Code.InvalidArgument);
          const rows = operations.list(limit, offset);
          return create(ListOperationsResponseSchema, {
            operations: rows,
            ...(rows.length === limit ? { nextPageToken: String(offset + limit) } : {}),
          });
        },
        async resolveOperation(request, context) {
          await authenticate(options.getAuth, context, { operation: ['resolve'] });
          return create(ResolveOperationResponseSchema, {
            operation: operations.resolve(request.requestId, request.applied, request.externalId),
          });
        },
      });
    },
  });

  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(error => {
      const connectError = asConnectError(error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader('content-type', 'application/json');
      }
      response.end(JSON.stringify({ code: connectError.code, message: connectError.message }));
    });
  });
  const separator = options.address.lastIndexOf(':');
  const host = options.address.slice(0, separator);
  const port = Number(options.address.slice(separator + 1));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('KUMA_MIERU_CONTROL_ADDR must use host:port syntax');
  }
  server.listen(port, host);
  return server;
};
