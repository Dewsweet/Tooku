// Bounded, process-local cache. Shared reads keep independent cancellation lifetimes.
export function createRequestCache<T>(limit: number) {
  const values = new Map<string, { value: T; expires: number }>();
  type Pending = { controller: AbortController; users: number; promise: Promise<T> };
  const pending = new Map<string, Pending>();
  return {
    get(key: string, signal: AbortSignal, load: (signal: AbortSignal) => Promise<{ value: T; ttl: number }>): Promise<T> {
      signal.throwIfAborted();
      for (const [id, entry] of values) if (entry.expires <= Date.now()) values.delete(id);
      const cached = values.get(key);
      if (cached) {
        values.delete(key); values.set(key, cached);
        return Promise.resolve(structuredClone(cached.value));
      }
      let work = pending.get(key);
      if (!work) {
        if (pending.size >= limit) return Promise.reject(new Error('Too many pending catalog queries'));
        const controller = new AbortController();
        const next: Pending = { controller, users: 0, promise: Promise.resolve().then(() => { controller.signal.throwIfAborted(); return load(controller.signal); }).then(({ value, ttl }) => {
          controller.signal.throwIfAborted();
          if (ttl > 0 && Buffer.byteLength(JSON.stringify(value)) <= 32768) {
            values.delete(key); values.set(key, { value: structuredClone(value), expires: Date.now() + ttl });
            while (values.size > limit) { const oldest = values.keys().next().value; if (oldest !== undefined) values.delete(oldest); }
          }
          return value;
        }).finally(() => { if (pending.get(key) === next) pending.delete(key); }) };
        pending.set(key, next); work = next;
      }
      const active = work; active.users++;
      return new Promise<T>((resolve, reject) => {
        let done = false;
        const settle = (action: () => void) => {
          if (done) return;
          done = true; signal.removeEventListener('abort', cancel); active.users--;
          if (!active.users && pending.get(key) === active) { pending.delete(key); active.controller.abort(); }
          action();
        };
        const cancel = () => settle(() => reject(signal.reason));
        signal.addEventListener('abort', cancel, { once: true });
        active.promise.then((value) => settle(() => resolve(structuredClone(value))), (error: unknown) => settle(() => reject(error)));
      });
    },
    delete(key: string) { values.delete(key); },
    clear() {
      values.clear();
      for (const work of pending.values()) work.controller.abort();
      pending.clear();
    },
  };
}
