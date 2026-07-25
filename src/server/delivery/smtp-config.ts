import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  smtpDeliverySchema,
  type EnabledSmtpDeliveryConfig,
  type SmtpDeliveryConfig,
} from '../config/schema.js';
import type { SecretStore } from '../secrets/store.js';
import { createSmtpTransport, type SmtpTransportConfig } from './smtp.js';
import type { EmailDeliveryTransport } from './transport.js';

export interface SmtpTestResult {
  token: string;
  expiresAt: string;
}

export interface SmtpTestService {
  test(config: SmtpDeliveryConfig): Promise<SmtpTestResult>;
  validate(config: SmtpDeliveryConfig, token: string): boolean;
  sendTest(config: SmtpDeliveryConfig, recipient: string): Promise<{ messageId: string }>;
}

export interface CreateSmtpTestServiceOptions {
  secret: string;
  secretStore: SecretStore;
  lifetimeMs?: number;
  createTransport?: (config: SmtpTransportConfig) => EmailDeliveryTransport;
  now?: () => Date;
}

const enabledConfig = (input: SmtpDeliveryConfig): EnabledSmtpDeliveryConfig => {
  const parsed = smtpDeliverySchema.parse(input);
  if (!parsed.enabled) {
    throw Object.assign(new Error('SMTP delivery is disabled'), { code: 'smtp_disabled' });
  }
  return parsed;
};

const smtpHash = (config: SmtpDeliveryConfig) =>
  createHash('sha256')
    .update(JSON.stringify(smtpDeliverySchema.parse(config)), 'utf8')
    .digest('hex');

export const resolveSmtpTransportConfig = (
  rawConfig: SmtpDeliveryConfig,
  secretStore: SecretStore
): SmtpTransportConfig => {
  const config = enabledConfig(rawConfig);
  const resourceId = config.credentialSetId ? `delivery.smtp:${config.credentialSetId}` : undefined;
  const username =
    resourceId && config.usernameRef
      ? secretStore.resolve(config.usernameRef, {
          resourceId,
          fieldName: 'username',
          purpose: 'smtp-credential',
        })
      : undefined;
  const password =
    resourceId && config.passwordRef
      ? secretStore.resolve(config.passwordRef, {
          resourceId,
          fieldName: 'password',
          purpose: 'smtp-credential',
        })
      : undefined;
  return {
    host: config.host,
    port: config.port,
    tls: config.tls,
    username,
    password,
    from: config.from,
    replyTo: config.replyTo,
  };
};

export const createSmtpTestService = ({
  secret,
  secretStore,
  lifetimeMs = 5 * 60_000,
  createTransport: transportFactory = createSmtpTransport,
  now = () => new Date(),
}: CreateSmtpTestServiceOptions): SmtpTestService => {
  const sign = (payload: string) =>
    createHmac('sha256', secret).update(`smtp-test:${payload}`, 'utf8').digest('base64url');

  const test = async (rawConfig: SmtpDeliveryConfig) => {
    const config = enabledConfig(rawConfig);
    const transport = transportFactory(resolveSmtpTransportConfig(config, secretStore));
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
    const expiresAt = new Date(now().valueOf() + lifetimeMs);
    const payload = Buffer.from(
      JSON.stringify({ smtpHash: smtpHash(config), expiresAt: expiresAt.toISOString() }),
      'utf8'
    ).toString('base64url');
    return { token: `${payload}.${sign(payload)}`, expiresAt: expiresAt.toISOString() };
  };

  const validate = (rawConfig: SmtpDeliveryConfig, token: string) => {
    const config = smtpDeliverySchema.safeParse(rawConfig);
    if (!config.success || !config.data.enabled) return false;
    const [payload, signature, ...extra] = token.split('.');
    if (!payload || !signature || extra.length > 0) return false;
    const expected = Buffer.from(sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
    try {
      const decoded = z
        .object({ smtpHash: z.string(), expiresAt: z.string().datetime() })
        .parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
      return (
        decoded.smtpHash === smtpHash(config.data) &&
        Date.parse(decoded.expiresAt) > now().valueOf()
      );
    } catch {
      return false;
    }
  };

  const sendTest = async (rawConfig: SmtpDeliveryConfig, recipient: string) => {
    const config = enabledConfig(rawConfig);
    const transport = transportFactory(resolveSmtpTransportConfig(config, secretStore));
    const senderDomain = config.from.address.slice(config.from.address.lastIndexOf('@') + 1);
    try {
      return await transport.send({
        to: z.email().max(320).parse(recipient),
        subject: 'Kuma Mieru SMTP delivery test',
        text: [
          'This message confirms that Kuma Mieru can submit mail through the active SMTP transport.',
          '',
          'No subscriber address, event payload, or credential is included in this test.',
        ].join('\n'),
        messageId: `<smtp-test-${randomUUID()}@${senderDomain}>`,
      });
    } finally {
      transport.close();
    }
  };

  return { test, validate, sendTest };
};
