import { describe, expect, test } from 'bun:test';
import type { AdminPasskey } from './admin/api';
import {
  canUsePasskeys,
  matchesPasskeyConfirmation,
  passkeyLabel,
  passkeyUnavailableReason,
} from './admin/passkey-model';

const passkey: AdminPasskey = {
  id: 'passkey-123456789',
  name: 'MacBook Touch ID',
  deviceType: 'multiDevice',
  backedUp: true,
  createdAt: '2026-07-25T00:00:00.000Z',
};

describe('passkey security model', () => {
  test('requires both a secure context and WebAuthn support', () => {
    expect(canUsePasskeys({ secureContext: true, publicKeyCredential: true })).toBe(true);
    expect(canUsePasskeys({ secureContext: false, publicKeyCredential: true })).toBe(false);
    expect(canUsePasskeys({ secureContext: true, publicKeyCredential: false })).toBe(false);
  });

  test('explains the first unavailable browser boundary', () => {
    expect(
      passkeyUnavailableReason({ secureContext: false, publicKeyCredential: false })
    ).toContain('HTTPS');
    expect(passkeyUnavailableReason({ secureContext: true, publicKeyCredential: false })).toContain(
      'WebAuthn'
    );
    expect(passkeyUnavailableReason({ secureContext: true, publicKeyCredential: true })).toBeNull();
  });

  test('uses a stable fallback label and exact deletion confirmation', () => {
    expect(passkeyLabel(passkey)).toBe('MacBook Touch ID');
    expect(passkeyLabel({ ...passkey, name: null })).toBe('Passkey passkey-');
    expect(matchesPasskeyConfirmation(passkey, 'passkey-123456789')).toBe(true);
    expect(matchesPasskeyConfirmation(passkey, 'passkey-123')).toBe(false);
  });
});
