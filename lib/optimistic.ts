import type { QueryClient } from "@tanstack/react-query";

const idOf = (r: unknown) => (r as { id: string }).id;
const reason = (e: unknown) => (e instanceof Error ? e.message : "network error");

/**
 * Show `row` in the cached list right away, then save it. If saving fails the cache is rolled back, the user is told
 * through `onError`, and the result is false so the caller can stop (no follow-up writes, no success message).
 */
export async function optimisticUpsert<R>(
  qc: QueryClient,
  key: readonly unknown[],
  row: R,
  save: (row: R) => Promise<void>,
  onError: (message: string) => void,
): Promise<boolean> {
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<R[]>(key);
  qc.setQueryData<R[]>(key, (old = []) => {
    const i = old.findIndex((r) => idOf(r) === idOf(row));
    if (i < 0) return [...old, row];
    const copy = old.slice();
    copy[i] = row;
    return copy;
  });
  try {
    await save(row);
    return true;
  } catch (e) {
    qc.setQueryData(key, prev);
    onError(`Couldn't save: ${reason(e)}`);
    return false;
  }
}

/** Remove row `id` from the cached list, then delete it. Rolls back and returns false on failure. */
export async function optimisticRemove<R>(
  qc: QueryClient,
  key: readonly unknown[],
  id: string,
  del: (id: string) => Promise<void>,
  onError: (message: string) => void,
): Promise<boolean> {
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<R[]>(key);
  qc.setQueryData<R[]>(key, (old = []) => old.filter((r) => idOf(r) !== id));
  try {
    await del(id);
    return true;
  } catch (e) {
    qc.setQueryData(key, prev);
    onError(`Couldn't delete: ${reason(e)}`);
    return false;
  }
}
