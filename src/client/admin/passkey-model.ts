import type { AdminPasskey } from './api';

export interface WebAuthnEnvironment {
  secureContext: boolean;
  publicKeyCredential: boolean;
}

export const canUsePasskeys = (environment: WebAuthnEnvironment) =>
  environment.secureContext && environment.publicKeyCredential;

export const passkeyUnavailableReason = (environment: WebAuthnEnvironment) => {
  if (!environment.secureContext) {
    return 'Passkeys require HTTPS or a browser-recognized local secure context.';
  }
  if (!environment.publicKeyCredential) {
    return 'This browser does not expose the WebAuthn PublicKeyCredential API.';
  }
  return null;
};

export const passkeyLabel = (passkey: AdminPasskey) =>
  passkey.name?.trim() || `Passkey ${passkey.id.slice(0, 8)}`;

export const matchesPasskeyConfirmation = (passkey: AdminPasskey, confirmation: string) =>
  confirmation.trim() === passkey.id;
