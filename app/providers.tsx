"use client";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useEffect, useState, type ReactNode } from "react";
import { CACHE_BUSTER, idbPersister, makeQueryClient } from "@/lib/query";
import { UiProvider } from "@/lib/ui";
import { ThemeClock } from "@/components/theme-toggle";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  const [persister] = useState(idbPersister);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
  }, []);

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{ persister, buster: CACHE_BUSTER, maxAge: 1000 * 60 * 60 * 24 * 14 }}
      // Paint from the saved cache immediately, then refresh everything in the background.
      onSuccess={() => void client.invalidateQueries()}
    >
      <ThemeClock />
      <UiProvider>{children}</UiProvider>
    </PersistQueryClientProvider>
  );
}
