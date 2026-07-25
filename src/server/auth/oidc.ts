import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  createHttpJsonRequestClient,
  type HttpJsonRequest,
  type HttpJsonResponse,
} from '../adapters/http-client.js';
import type { AuditContext } from '../config/managed-config.js';
import type { SecretStore } from '../secrets/store.js';
import type { AdminRole } from './auth.js';

export const oidcProviderId = 'kuma-oidc';

const oidcSecretBinding = {
  resourceId: `auth:oidc:${oidcProviderId}`,
  fieldName: 'client-secret',
  purpose: 'oidc-client-credential',
} as const;

const tokenEndpointAuthMethodSchema = z.enum(['client_secret_basic', 'client_secret_post']);
const subjectSchema = z.string().trim().min(1).max(512);
const providerInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    displayName: z.string().trim().min(1).max(100),
    discoveryUrl: z.url().max(2_048),
    clientId: z.string().trim().min(1).max(1_024),
    clientSecret: z.string().min(1).max(16_384).optional(),
    tokenEndpointAuthMethod: tokenEndpointAuthMethodSchema,
  })
  .strict();
const disableInputSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const mappingInputSchema = z
  .object({
    expectedSubject: subjectSchema.nullable(),
    subject: subjectSchema,
  })
  .strict();
const mappingDeleteSchema = z.object({ expectedSubject: subjectSchema }).strict();

const discoveryDocumentSchema = z
  .object({
    issuer: z.url(),
    authorization_endpoint: z.url(),
    token_endpoint: z.url(),
    userinfo_endpoint: z.url(),
    response_types_supported: z.array(z.string()).optional(),
    scopes_supported: z.array(z.string()).optional(),
    code_challenge_methods_supported: z.array(z.string()).optional(),
    token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
  })
  .passthrough();

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().min(1).optional(),
    expires_in: z.number().int().positive().optional(),
    scope: z.string().optional(),
  })
  .passthrough();

const userInfoSchema = z
  .object({
    sub: subjectSchema,
  })
  .passthrough();

type DateValue = Date | number | string;
type OidcJsonRequest = (url: URL, request?: HttpJsonRequest) => Promise<HttpJsonResponse>;

const encodeFormComponent = (value: string) =>
  new URLSearchParams({ value }).toString().slice('value='.length);

interface OidcProviderRow {
  enabled: number | boolean;
  display_name: string;
  discovery_url: string;
  issuer: string;
  authorization_url: string;
  token_url: string;
  user_info_url: string;
  client_id: string;
  client_secret_ref: string;
  token_endpoint_auth_method: z.infer<typeof tokenEndpointAuthMethodSchema>;
  version: number;
  created_at: DateValue;
  updated_at: DateValue;
}

interface OidcMappingRow {
  subject: string;
  user_id: string;
  name: string;
  email: string;
  role: AdminRole;
  created_at: DateValue;
}

interface OidcMappedUserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: number | boolean;
}

export interface AdminOidcProvider {
  enabled: boolean;
  configured: boolean;
  displayName: string | null;
  discoveryUrl: string | null;
  issuer: string | null;
  clientId: string | null;
  clientSecretConfigured: boolean;
  tokenEndpointAuthMethod: z.infer<typeof tokenEndpointAuthMethodSchema> | null;
  version: number;
}

export interface PublicOidcProvider {
  providerId: typeof oidcProviderId;
  displayName: string;
}

export interface AdminOidcMapping {
  subject: string;
  userId: string;
  name: string;
  email: string;
  role: AdminRole;
  createdAt: string;
}

export interface OidcRuntimeConfig {
  providerId: typeof oidcProviderId;
  displayName: string;
  issuer: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret: string;
  tokenEndpointAuthMethod: z.infer<typeof tokenEndpointAuthMethodSchema>;
  getToken: (input: { code: string; redirectURI: string; codeVerifier?: string }) => Promise<{
    accessToken: string;
    tokenType?: string;
    accessTokenExpiresAt?: Date;
    scopes?: string[];
  }>;
  getUserInfo: (tokens: { accessToken?: string }) => Promise<{
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
  } | null>;
}

export interface ConfigureOidcProviderInput {
  expectedVersion: number;
  displayName: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod: z.infer<typeof tokenEndpointAuthMethodSchema>;
}

export interface ConfigureOidcMappingInput {
  expectedSubject: string | null;
  subject: string;
}

export interface OidcControlPlaneOptions {
  database: Database.Database;
  secretStore: SecretStore;
  privateAddressCidrs?: readonly string[];
  requestJson?: OidcJsonRequest;
}

const oidcError = (code: string, message: string) => Object.assign(new Error(message), { code });

export const oidcErrorCode = (error: unknown) =>
  typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'oidc_admin_failed';

const toIsoString = (value: DateValue) => {
  const date =
    value instanceof Date ? value : typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw oidcError('oidc_date_invalid', 'Stored OIDC date is invalid');
  }
  return date.toISOString();
};

const getProviderRow = (database: Database.Database) =>
  database.prepare('SELECT * FROM auth_oidc_provider WHERE singleton = 1').get() as
    | OidcProviderRow
    | undefined;

const providerProjection = (row?: OidcProviderRow): AdminOidcProvider =>
  row
    ? {
        enabled: Boolean(row.enabled),
        configured: true,
        displayName: row.display_name,
        discoveryUrl: row.discovery_url,
        issuer: row.issuer,
        clientId: row.client_id,
        clientSecretConfigured: Boolean(row.client_secret_ref),
        tokenEndpointAuthMethod: row.token_endpoint_auth_method,
        version: row.version,
      }
    : {
        enabled: false,
        configured: false,
        displayName: null,
        discoveryUrl: null,
        issuer: null,
        clientId: null,
        clientSecretConfigured: false,
        tokenEndpointAuthMethod: null,
        version: 0,
      };

const mappingProjection = (row: OidcMappingRow): AdminOidcMapping => ({
  subject: row.subject,
  userId: row.user_id,
  name: row.name,
  email: row.email,
  role: row.role,
  createdAt: toIsoString(row.created_at),
});

const secureUrl = (input: string, label: string) => {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname
  ) {
    throw oidcError(
      'oidc_endpoint_invalid',
      `${label} must be an HTTPS URL without credentials, query, or fragment`
    );
  }
  return url;
};

const validateDiscovery = (
  discoveryUrl: URL,
  input: unknown,
  authMethod: z.infer<typeof tokenEndpointAuthMethodSchema>
) => {
  const document = discoveryDocumentSchema.parse(input);
  const issuer = secureUrl(document.issuer, 'OIDC issuer');
  const authorizationUrl = secureUrl(document.authorization_endpoint, 'Authorization endpoint');
  const tokenUrl = secureUrl(document.token_endpoint, 'Token endpoint');
  const userInfoUrl = secureUrl(document.userinfo_endpoint, 'UserInfo endpoint');
  if (
    [discoveryUrl, authorizationUrl, tokenUrl, userInfoUrl].some(
      endpoint => endpoint.origin !== issuer.origin
    )
  ) {
    throw oidcError(
      'oidc_endpoint_origin_mismatch',
      'OIDC discovery, authorization, token, and UserInfo endpoints must share the issuer origin'
    );
  }
  if (document.response_types_supported && !document.response_types_supported.includes('code')) {
    throw oidcError('oidc_code_flow_unsupported', 'OIDC provider does not advertise code flow');
  }
  if (
    document.code_challenge_methods_supported &&
    !document.code_challenge_methods_supported.includes('S256')
  ) {
    throw oidcError('oidc_pkce_unsupported', 'OIDC provider does not advertise PKCE S256');
  }
  if (document.scopes_supported && !document.scopes_supported.includes('openid')) {
    throw oidcError('oidc_scope_unsupported', 'OIDC provider does not advertise openid scope');
  }
  if (
    document.token_endpoint_auth_methods_supported &&
    !document.token_endpoint_auth_methods_supported.includes(authMethod)
  ) {
    throw oidcError(
      'oidc_client_auth_unsupported',
      `OIDC provider does not advertise ${authMethod}`
    );
  }
  return {
    issuer: issuer.toString(),
    authorizationUrl: authorizationUrl.toString(),
    tokenUrl: tokenUrl.toString(),
    userInfoUrl: userInfoUrl.toString(),
  };
};

const writeAudit = (
  database: Database.Database,
  audit: AuditContext,
  action: string,
  targetId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
) => {
  database
    .prepare(
      `INSERT INTO admin_audit
        (id, occurred_at, actor_id, action, target_type, target_id, request_id,
         ip_address, user_agent, result, before_json, after_json)
       VALUES (?, ?, ?, ?, 'oidc', ?, ?, ?, ?, 'success', ?, ?)`
    )
    .run(
      randomUUID(),
      new Date().toISOString(),
      audit.actorId,
      action,
      targetId,
      audit.requestId,
      audit.ipAddress ?? null,
      audit.userAgent ?? null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null
    );
};

const subjectFingerprint = (subject: string) =>
  createHash('sha256').update(subject, 'utf8').digest('hex').slice(0, 16);

const mappedUserIds = (database: Database.Database) =>
  (
    database
      .prepare(`SELECT DISTINCT userId FROM "account" WHERE providerId = ?`)
      .all(oidcProviderId) as Array<{ userId: string }>
  ).map(row => row.userId);

const revokeMappedSessions = (database: Database.Database) => {
  const userIds = mappedUserIds(database);
  if (userIds.length === 0) return 0;
  const remove = database.prepare(`DELETE FROM "session" WHERE userId = ?`);
  return userIds.reduce((count, userId) => count + remove.run(userId).changes, 0);
};

const findMappedUser = (database: Database.Database, subject: string): OidcMappedUserRow | null =>
  (database
    .prepare(
      `SELECT u.id, u.name, u.email, u.emailVerified
       FROM "account" a
       JOIN "user" u ON u.id = a.userId
       WHERE a.providerId = ? AND a.accountId = ?`
    )
    .get(oidcProviderId, subject) as OidcMappedUserRow | undefined) ?? null;

const requestData = async (requestJson: OidcJsonRequest, url: URL, request?: HttpJsonRequest) => {
  const response = await requestJson(url, request);
  if (response.status !== 200) {
    throw oidcError('oidc_unexpected_not_modified', 'OIDC endpoint returned 304 unexpectedly');
  }
  return response.data;
};

export const createOidcControlPlane = ({
  database,
  secretStore,
  privateAddressCidrs = [],
  requestJson = createHttpJsonRequestClient({
    privateAddressCidrs,
    timeoutMs: 8_000,
    maxBodyBytes: 128 * 1024,
    maxRedirects: 0,
  }),
}: OidcControlPlaneOptions) => {
  const getProvider = () => providerProjection(getProviderRow(database));

  const getPublicProvider = (): PublicOidcProvider | null => {
    const row = getProviderRow(database);
    return row?.enabled
      ? {
          providerId: oidcProviderId,
          displayName: row.display_name,
        }
      : null;
  };

  const isAuthorizationUrlAllowed = (input: string) => {
    const row = getProviderRow(database);
    if (!row?.enabled) return false;
    try {
      const candidate = new URL(input);
      const configured = new URL(row.authorization_url);
      return (
        candidate.protocol === 'https:' &&
        candidate.origin === configured.origin &&
        candidate.pathname === configured.pathname &&
        !candidate.username &&
        !candidate.password &&
        !candidate.hash
      );
    } catch {
      return false;
    }
  };

  const listMappings = (): AdminOidcMapping[] =>
    (
      database
        .prepare(
          `SELECT a.accountId AS subject, a.userId AS user_id, a.createdAt AS created_at,
                  u.name, u.email, u.role
           FROM "account" a
           JOIN "user" u ON u.id = a.userId
           WHERE a.providerId = ?
           ORDER BY u.createdAt ASC, u.id ASC`
        )
        .all(oidcProviderId) as OidcMappingRow[]
    ).map(mappingProjection);

  const configure = async (rawInput: ConfigureOidcProviderInput, audit: AuditContext) => {
    const input = providerInputSchema.parse(rawInput);
    const initial = getProviderRow(database);
    if ((initial?.version ?? 0) !== input.expectedVersion) {
      throw oidcError(
        'oidc_version_conflict',
        `Expected OIDC version ${input.expectedVersion}, active version is ${initial?.version ?? 0}`
      );
    }
    if (!initial && !input.clientSecret) {
      throw oidcError('oidc_client_secret_required', 'OIDC client secret is required');
    }
    const discoveryUrl = secureUrl(input.discoveryUrl, 'Discovery URL');
    const discovery = validateDiscovery(
      discoveryUrl,
      await requestData(requestJson, discoveryUrl),
      input.tokenEndpointAuthMethod
    );
    const existing = getProviderRow(database);
    if ((existing?.version ?? 0) !== input.expectedVersion) {
      throw oidcError(
        'oidc_version_conflict',
        `Expected OIDC version ${input.expectedVersion}, active version is ${existing?.version ?? 0}`
      );
    }
    if (!existing && !input.clientSecret) {
      throw oidcError('oidc_client_secret_required', 'OIDC client secret is required');
    }
    const now = new Date().toISOString();
    const nextVersion = (existing?.version ?? 0) + 1;
    const result = database.transaction(() => {
      const secretRef = input.clientSecret
        ? secretStore.put(oidcSecretBinding, input.clientSecret).secretRef
        : existing?.client_secret_ref;
      if (!secretRef) {
        throw oidcError('oidc_client_secret_required', 'OIDC client secret is required');
      }
      database
        .prepare(
          `INSERT INTO auth_oidc_provider
            (singleton, enabled, display_name, discovery_url, issuer, authorization_url,
             token_url, user_info_url, client_id, client_secret_ref,
             token_endpoint_auth_method, version, created_at, updated_at)
           VALUES (1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(singleton) DO UPDATE SET
             enabled = 1,
             display_name = excluded.display_name,
             discovery_url = excluded.discovery_url,
             issuer = excluded.issuer,
             authorization_url = excluded.authorization_url,
             token_url = excluded.token_url,
             user_info_url = excluded.user_info_url,
             client_id = excluded.client_id,
             client_secret_ref = excluded.client_secret_ref,
             token_endpoint_auth_method = excluded.token_endpoint_auth_method,
             version = excluded.version,
             updated_at = excluded.updated_at`
        )
        .run(
          input.displayName,
          discoveryUrl.toString(),
          discovery.issuer,
          discovery.authorizationUrl,
          discovery.tokenUrl,
          discovery.userInfoUrl,
          input.clientId,
          secretRef,
          input.tokenEndpointAuthMethod,
          nextVersion,
          existing ? toIsoString(existing.created_at) : now,
          now
        );
      const revokedSessions = revokeMappedSessions(database);
      writeAudit(
        database,
        audit,
        'auth.oidc.provider.configure',
        oidcProviderId,
        existing
          ? {
              enabled: Boolean(existing.enabled),
              version: existing.version,
              issuerOrigin: new URL(existing.issuer).origin,
            }
          : null,
        {
          enabled: true,
          version: nextVersion,
          issuerOrigin: new URL(discovery.issuer).origin,
          clientSecretRotated: Boolean(input.clientSecret),
          revokedSessions,
        }
      );
      return getProvider();
    })();
    return result;
  };

  const disable = (rawInput: { expectedVersion: number }, audit: AuditContext) => {
    const input = disableInputSchema.parse(rawInput);
    const existing = getProviderRow(database);
    if (!existing) throw oidcError('oidc_not_configured', 'OIDC is not configured');
    if (existing.version !== input.expectedVersion) {
      throw oidcError(
        'oidc_version_conflict',
        `Expected OIDC version ${input.expectedVersion}, active version is ${existing.version}`
      );
    }
    if (!existing.enabled) throw oidcError('oidc_already_disabled', 'OIDC is already disabled');
    return database.transaction(() => {
      const nextVersion = existing.version + 1;
      database
        .prepare(
          `UPDATE auth_oidc_provider
           SET enabled = 0, version = ?, updated_at = ?
           WHERE singleton = 1`
        )
        .run(nextVersion, new Date().toISOString());
      const revokedSessions = revokeMappedSessions(database);
      writeAudit(
        database,
        audit,
        'auth.oidc.provider.disable',
        oidcProviderId,
        { enabled: true, version: existing.version },
        { enabled: false, version: nextVersion, revokedSessions }
      );
      return getProvider();
    })();
  };

  const configureMapping = (
    userId: string,
    rawInput: ConfigureOidcMappingInput,
    audit: AuditContext
  ) => {
    const input = mappingInputSchema.parse(rawInput);
    const user = database.prepare(`SELECT id FROM "user" WHERE id = ?`).get(userId);
    if (!user) throw oidcError('oidc_user_not_found', 'User does not exist');
    const existing = database
      .prepare(`SELECT accountId FROM "account" WHERE providerId = ? AND userId = ?`)
      .get(oidcProviderId, userId) as { accountId: string } | undefined;
    if ((existing?.accountId ?? null) !== input.expectedSubject) {
      throw oidcError('oidc_mapping_conflict', 'OIDC mapping changed before this request');
    }
    const occupied = database
      .prepare(`SELECT userId FROM "account" WHERE providerId = ? AND accountId = ?`)
      .get(oidcProviderId, input.subject) as { userId: string } | undefined;
    if (occupied && occupied.userId !== userId) {
      throw oidcError('oidc_subject_conflict', 'OIDC subject is already mapped');
    }
    return database.transaction(() => {
      if (existing) {
        database
          .prepare(`DELETE FROM "account" WHERE providerId = ? AND userId = ?`)
          .run(oidcProviderId, userId);
      }
      const now = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO "account"
            (id, accountId, providerId, userId, accessToken, refreshToken, idToken,
             accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`
        )
        .run(randomUUID(), input.subject, oidcProviderId, userId, now, now);
      const revokedSessions = database
        .prepare(`DELETE FROM "session" WHERE userId = ?`)
        .run(userId).changes;
      writeAudit(
        database,
        audit,
        'auth.oidc.mapping.configure',
        userId,
        existing ? { subjectFingerprint: subjectFingerprint(existing.accountId) } : null,
        {
          subjectFingerprint: subjectFingerprint(input.subject),
          revokedSessions,
        }
      );
      return listMappings().find(mapping => mapping.userId === userId) as AdminOidcMapping;
    })();
  };

  const deleteMapping = (
    userId: string,
    rawInput: { expectedSubject: string },
    audit: AuditContext
  ) => {
    const input = mappingDeleteSchema.parse(rawInput);
    const existing = database
      .prepare(`SELECT accountId FROM "account" WHERE providerId = ? AND userId = ?`)
      .get(oidcProviderId, userId) as { accountId: string } | undefined;
    if (!existing) throw oidcError('oidc_mapping_not_found', 'OIDC mapping does not exist');
    if (existing.accountId !== input.expectedSubject) {
      throw oidcError('oidc_mapping_conflict', 'OIDC mapping changed before this request');
    }
    return database.transaction(() => {
      database
        .prepare(`DELETE FROM "account" WHERE providerId = ? AND userId = ? AND accountId = ?`)
        .run(oidcProviderId, userId, input.expectedSubject);
      const revokedSessions = database
        .prepare(`DELETE FROM "session" WHERE userId = ?`)
        .run(userId).changes;
      writeAudit(
        database,
        audit,
        'auth.oidc.mapping.delete',
        userId,
        { subjectFingerprint: subjectFingerprint(existing.accountId) },
        { removed: true, revokedSessions }
      );
      return { userId, removed: true as const, revokedSessions };
    })();
  };

  const getRuntimeConfig = (): OidcRuntimeConfig | null => {
    const row = getProviderRow(database);
    if (!row?.enabled) return null;
    const clientSecret = secretStore.resolve(row.client_secret_ref, oidcSecretBinding);
    const request = requestJson;
    return {
      providerId: oidcProviderId,
      displayName: row.display_name,
      issuer: row.issuer,
      authorizationUrl: row.authorization_url,
      tokenUrl: row.token_url,
      userInfoUrl: row.user_info_url,
      clientId: row.client_id,
      clientSecret,
      tokenEndpointAuthMethod: row.token_endpoint_auth_method,
      getToken: async ({ code, redirectURI, codeVerifier }) => {
        if (!codeVerifier) {
          throw oidcError('oidc_pkce_verifier_missing', 'OIDC PKCE verifier is required');
        }
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectURI,
          code_verifier: codeVerifier,
        });
        const headers: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        if (row.token_endpoint_auth_method === 'client_secret_basic') {
          headers.Authorization = `Basic ${Buffer.from(
            `${encodeFormComponent(row.client_id)}:${encodeFormComponent(clientSecret)}`,
            'utf8'
          ).toString('base64')}`;
        } else {
          body.set('client_id', row.client_id);
          body.set('client_secret', clientSecret);
        }
        const token = tokenResponseSchema.parse(
          await requestData(request, new URL(row.token_url), {
            method: 'POST',
            headers,
            body: body.toString(),
          })
        );
        if (token.token_type && token.token_type.toLowerCase() !== 'bearer') {
          throw oidcError('oidc_token_type_unsupported', 'OIDC token type must be Bearer');
        }
        return {
          accessToken: token.access_token,
          tokenType: token.token_type,
          ...(token.expires_in
            ? { accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1_000) }
            : {}),
          ...(token.scope ? { scopes: token.scope.split(/\s+/u).filter(Boolean) } : {}),
        };
      },
      getUserInfo: async tokens => {
        const accessToken = tokens.accessToken;
        if (!accessToken) return null;
        try {
          const profile = userInfoSchema.parse(
            await requestData(request, new URL(row.user_info_url), {
              headers: { Authorization: `Bearer ${accessToken}` },
            })
          );
          const user = findMappedUser(database, profile.sub);
          if (!user || !user.emailVerified) return null;
          return {
            id: profile.sub,
            name: user.name,
            email: user.email,
            emailVerified: true,
          };
        } finally {
          tokens.accessToken = undefined;
        }
      },
    };
  };

  return {
    getProvider,
    getPublicProvider,
    isAuthorizationUrlAllowed,
    listMappings,
    configure,
    disable,
    configureMapping,
    deleteMapping,
    getRuntimeConfig,
  };
};

export type OidcControlPlane = ReturnType<typeof createOidcControlPlane>;
