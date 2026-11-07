"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const subscribe = () => () => {};

/**
 * Dates and "today" only exist on the device, so page bodies render after mount.
 * The shell (sidebar, tab bar) is still server-rendered; the body paints from the
 * on-device cache in the same frame.
 */
export function Mounted({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return mounted ? <>{children}</> : null;
}
