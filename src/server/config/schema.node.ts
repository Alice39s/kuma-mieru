import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalConfigSchema,
  defaultRetentionPolicy,
  extendRetentionPolicy,
  resolveRetentionPolicy,
  smtpDeliverySchema,
} from './schema.js';

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

test('keeps retention defaults backward compatible and enforces safety floors', () => {
  assert.deepEqual(resolveRetentionPolicy(), defaultRetentionPolicy);
  const extended = canonicalConfigSchema.parse({
    schemaVersion: 1,
    server: {},
    sources: [],
    pages: [],
    dataLifecycle: {
      retention: {
        eventDraftDays: 180,
        adminAuditDays: 730,
        deliveryAttemptDays: 180,
        backupDays: 60,
      },
    },
  });
  assert.equal(extended.dataLifecycle?.retention?.backupDays, 60);
  assert.throws(() =>
    resolveRetentionPolicy({
      eventDraftDays: 29,
      adminAuditDays: 365,
      deliveryAttemptDays: 90,
      backupDays: 30,
    })
  );
  assert.deepEqual(
    extendRetentionPolicy(defaultRetentionPolicy, {
      eventDraftDays: 180,
      adminAuditDays: 730,
      deliveryAttemptDays: 180,
      backupDays: 60,
    }),
    {
      eventDraftDays: 180,
      adminAuditDays: 730,
      deliveryAttemptDays: 180,
      backupDays: 60,
    }
  );
});
