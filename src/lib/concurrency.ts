/**
 * Runs `fn` over `items` with at most `limit` running at once, and returns the results in the
 * items' order. After a failure no new item starts; the ones already running finish, then the
 * first error is thrown, so nothing is left running behind the caller's back.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed: { error: unknown } | null = null;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (error) {
        failed ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed) throw (failed as { error: unknown }).error;
  return results;
}

/** A lock: the functions passed to it run one at a time, in the order they were passed. */
export function createLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * Starts a read now so it runs while the caller does other work, and hands it over later.
 * A failure is only raised where the result is taken, never as an unhandled rejection.
 */
export function readAhead<K, T>(key: K, read: () => Promise<T>) {
  const promise = read();
  promise.catch(() => undefined);
  return { key, promise };
}
