import { useSyncExternalStore } from 'react';

const subscribeToNothing = () => () => {};

/**
 * Reads a browser-only value without a hydration mismatch: the server render and hydration use
 * `serverValue`, every later client render uses `getClientValue()`.
 */
export function useClientSnapshot<T>(getClientValue: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribeToNothing, getClientValue, () => serverValue);
}
