import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

export interface PiiProtector {
  encrypt(value: string): string;
  decrypt(value: string): string;
  emailHash(email: string): string;
  tokenHash(token: string): string;
  normalizeEmail(email: string): string;
}

export const createPiiProtector = (secret: string): PiiProtector => {
  const key = createHash('sha256').update(`subscriber-pii:${secret}`, 'utf8').digest();
  const keyedHash = (namespace: string, value: string) =>
    createHmac('sha256', secret).update(`${namespace}:${value}`, 'utf8').digest('base64url');
  const normalizeEmail = (email: string) => email.trim().toLowerCase().normalize('NFKC');

  const encrypt = (value: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  };

  const decrypt = (value: string) => {
    const payload = Buffer.from(value, 'base64url');
    if (payload.length < 29) throw new Error('Encrypted subscriber payload is invalid');
    const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString(
      'utf8'
    );
  };

  return {
    encrypt,
    decrypt,
    normalizeEmail,
    emailHash: email => keyedHash('subscriber-email', normalizeEmail(email)),
    tokenHash: token => keyedHash('subscriber-token', token),
  };
};
