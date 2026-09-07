export function createInFlightLoader<Key, Value>() {
  const pending = new Map<Key, Promise<Value>>();

  return (key: Key, load: () => Promise<Value>): Promise<Value> => {
    const existing = pending.get(key);
    if (existing) return existing;

    const request = load().finally(() => {
      pending.delete(key);
    });
    pending.set(key, request);
    return request;
  };
}
