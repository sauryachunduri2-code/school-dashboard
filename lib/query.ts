import { QueryClient } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

const KEY = "school-dashboard-query-cache";
export const CACHE_BUSTER = "v3";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 1000 * 60 * 60 * 24 * 14,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 1,
      },
    },
  });
}

/** Cache lives in IndexedDB so the app paints from the last known state before any network call. */
export function idbPersister(): Persister {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: PersistedClient | null = null;
  const flush = () => {
    clearTimeout(timer);
    if (pending) void set(KEY, pending).catch(() => {});
    pending = null;
  };
  if (typeof window !== "undefined") {
    // Don't lose the last few edits when the tab is closed or backgrounded.
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  }
  return {
    persistClient(client) {
      pending = client;
      clearTimeout(timer);
      timer = setTimeout(flush, 400);
    },
    async restoreClient() {
      return (await get<PersistedClient>(KEY)) ?? undefined;
    },
    async removeClient() {
      await del(KEY);
    },
  };
}
