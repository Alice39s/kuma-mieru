import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalConfigSchema, smtpDeliverySchema } from './schema.js';

test('requires an explicit public URL before SMTP delivery can be enabled', () => {
  const config = {
    schemaVersion: 1 as const,
    server: {},
    delivery: {
      smtp: {
        enabled: true as const,
        host: 'smtp.example.com',
        port: 587,
        tls: 'starttls' as const,
        from: { address: 'status@example.com' },
      },
    },
    sources: [],
    pages: [],
  };
  const parsed = canonicalConfigSchema.safeParse(config);
  assert.equal(parsed.success, false);
  assert.equal(
    parsed.error?.issues.some(issue => issue.path.join('.') === 'server.publicBaseUrl'),
    true
  );
  assert.equal(
    canonicalConfigSchema.safeParse({
      ...config,
      server: { publicBaseUrl: 'https://status.example.com' },
    }).success,
    true
  );
});

test('requires complete staged credentials and fixed implicit TLS semantics', () => {
  const base = {
    enabled: true as const,
    host: 'smtp.example.com',
    from: { address: 'status@example.com' },
  };
  assert.equal(
    smtpDeliverySchema.safeParse({
      ...base,
      port: 587,
      tls: 'starttls',
      credentialSetId: 'smtp_fixture',
      usernameRef: 'sec_username',
    }).success,
    false
  );
  assert.equal(
    smtpDeliverySchema.safeParse({
      ...base,
      port: 587,
      tls: 'implicit',
    }).success,
    false
  );
  assert.equal(
    smtpDeliverySchema.safeParse({
      ...base,
      port: 465,
      tls: 'implicit',
    }).success,
    true
  );
});
