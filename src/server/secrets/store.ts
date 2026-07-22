import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SecretKeyring } from './keyring.js';

export interface SecretBinding {
  resourceId: string;
  fieldName: string;
  purpose: string;
}

export interface SecretMetadata extends SecretBinding {
  secretRef: string;
  keyId: string;
  createdAt: string;
  updatedAt: string;
}

interface SecretRow {
  secret_ref: string;
  resource_id: string;
  field_name: string;
  purpose: string;
  key_id: string;
  nonce: Buffer;
  ciphertext: Buffer;
  auth_tag: Buffer;
  created_at: string;
  updated_at: string;
}

const aadFor = (binding: SecretBinding, keyId: string) =>
  Buffer.from(`${binding.resourceId}\0${binding.fieldName}\0${keyId}`, 'utf8');

const encrypt = (value: string, binding: SecretBinding, keyId: string, key: Buffer) => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aadFor(binding, keyId));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { nonce, ciphertext, authTag: cipher.getAuthTag() };
};

const bindingFor = (row: SecretRow): SecretBinding => ({
  resourceId: row.resource_id,
  fieldName: row.field_name,
  purpose: row.purpose,
});

const metadataFor = (row: SecretRow): SecretMetadata => ({
  secretRef: row.secret_ref,
  ...bindingFor(row),
  keyId: row.key_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const assertBinding = (actual: SecretBinding, expected: SecretBinding) => {
  if (
    actual.resourceId !== expected.resourceId ||
    actual.fieldName !== expected.fieldName ||
    actual.purpose !== expected.purpose
  ) {
    throw Object.assign(new Error('Secret reference is not valid for this consumer'), {
      code: 'secret_binding_mismatch',
    });
  }
};

const decrypt = (row: SecretRow, keyring: SecretKeyring) => {
  const key = keyring.keys.get(row.key_id);
  if (!key) {
    throw Object.assign(new Error(`Secret key ${row.key_id} is unavailable`), {
      code: 'secret_key_unavailable',
    });
  }
  const decipher = createDecipheriv('aes-256-gcm', key, row.nonce);
  decipher.setAAD(aadFor(bindingFor(row), row.key_id));
  decipher.setAuthTag(row.auth_tag);
  return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8');
};

export const createSecretStore = (database: Database.Database, keyring: SecretKeyring) => {
  const currentKey = keyring.keys.get(keyring.currentKeyId);
  if (!currentKey) throw new Error('Current secret key is unavailable');

  const getRow = (secretRef: string) =>
    database.prepare('SELECT * FROM encrypted_secrets WHERE secret_ref = ?').get(secretRef) as
      | SecretRow
      | undefined;

  const put = (binding: SecretBinding, value: string): SecretMetadata => {
    if (!value) throw new Error('Secret value must not be empty');
    const now = new Date().toISOString();
    const existing = database
      .prepare('SELECT * FROM encrypted_secrets WHERE resource_id = ? AND field_name = ?')
      .get(binding.resourceId, binding.fieldName) as SecretRow | undefined;
    if (existing && existing.purpose !== binding.purpose) {
      throw Object.assign(new Error('Existing secret has a different purpose'), {
        code: 'secret_purpose_conflict',
      });
    }
    const secretRef = existing?.secret_ref ?? `sec_${randomUUID()}`;
    const encrypted = encrypt(value, binding, keyring.currentKeyId, currentKey);
    database
      .prepare(
        `INSERT INTO encrypted_secrets
          (secret_ref, resource_id, field_name, purpose, key_id, nonce, ciphertext, auth_tag,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(resource_id, field_name) DO UPDATE SET
           purpose = excluded.purpose,
           key_id = excluded.key_id,
           nonce = excluded.nonce,
           ciphertext = excluded.ciphertext,
           auth_tag = excluded.auth_tag,
           updated_at = excluded.updated_at`
      )
      .run(
        secretRef,
        binding.resourceId,
        binding.fieldName,
        binding.purpose,
        keyring.currentKeyId,
        encrypted.nonce,
        encrypted.ciphertext,
        encrypted.authTag,
        existing?.created_at ?? now,
        now
      );
    const row = getRow(secretRef);
    if (!row) throw new Error('Secret write did not persist');
    return metadataFor(row);
  };

  const resolve = (secretRef: string, expected: SecretBinding) => {
    const row = getRow(secretRef);
    if (!row) {
      throw Object.assign(new Error('Secret reference does not exist'), {
        code: 'secret_not_found',
      });
    }
    assertBinding(bindingFor(row), expected);
    return decrypt(row, keyring);
  };

  const list = (): SecretMetadata[] =>
    (
      database
        .prepare('SELECT * FROM encrypted_secrets ORDER BY resource_id, field_name')
        .all() as SecretRow[]
    ).map(metadataFor);

  const remove = (secretRef: string, expected: SecretBinding) => {
    const row = getRow(secretRef);
    if (!row) return false;
    assertBinding(bindingFor(row), expected);
    return (
      database.prepare('DELETE FROM encrypted_secrets WHERE secret_ref = ?').run(secretRef)
        .changes === 1
    );
  };

  const rotateAll = () =>
    database.transaction(() => {
      const rows = database
        .prepare('SELECT * FROM encrypted_secrets WHERE key_id != ? ORDER BY secret_ref')
        .all(keyring.currentKeyId) as SecretRow[];
      const now = new Date().toISOString();
      const update = database.prepare(
        `UPDATE encrypted_secrets
         SET key_id = ?, nonce = ?, ciphertext = ?, auth_tag = ?, updated_at = ?
         WHERE secret_ref = ?`
      );
      rows.forEach(row => {
        const binding = bindingFor(row);
        const encrypted = encrypt(decrypt(row, keyring), binding, keyring.currentKeyId, currentKey);
        update.run(
          keyring.currentKeyId,
          encrypted.nonce,
          encrypted.ciphertext,
          encrypted.authTag,
          now,
          row.secret_ref
        );
      });
      return rows.length;
    })();

  return { put, resolve, list, remove, rotateAll };
};

export type SecretStore = ReturnType<typeof createSecretStore>;
