"use client";

import { onlineManager, useIsFetching } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { localMode } from "@/lib/env";
import { useLists, useTasks } from "@/lib/hooks";
import { useUi } from "@/lib/ui";
import { EditorDialog } from "./editor";
import { Mounted } from "./mounted";
import { IconAreas, IconCalendar, IconClock, IconHome, IconPlus, IconSearch, IconSettings } from "./icons";
import { QuickAddDialog } from "./quickadd";
import { SearchDialog } from "./search";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/", label: "Home", icon: IconHome, hint: "G H" },
  { href: "/calendar", label: "Calendar", icon: IconCalendar, hint: "G C" },
  { href: "/areas", label: "Areas", icon: IconAreas, hint: "G A" },
  { href: "/hours", label: "Hours", icon: IconClock, hint: "G L" },
  { href: "/settings", label: "Settings", icon: IconSettings, hint: "G S" },
];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

function useOnline() {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

function SyncDot() {
  const fetching = useIsFetching();
  const online = useOnline();
  const label = !online ? "Offline: showing saved data" : fetching ? "Syncing" : "Up to date";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-ink2" role="status">
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${!online ? "bg-overdue" : fetching ? "animate-pulse bg-margin" : "bg-ecs"}`}
      />
      {label}
    </span>
  );
}

function Toasts() {
  const { toasts } = useUi();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 md:bottom-6" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="anim-pop sheet pointer-events-auto max-w-[90vw] px-4 py-2 text-sm" style={{ border: "1px solid var(--rule-strong)" }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function Shortcuts() {
  const router = useRouter();
  const path = usePathname();
  const ui = useUi();
  const gPending = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.setQuickAddOpen(true);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (ui.editor || ui.quickAddOpen || ui.searchOpen) return;
      const k = e.key.toLowerCase();

      if (gPending.current && Date.now() - gPending.current < 1200) {
        gPending.current = null;
        const dest: Record<string, string> = { h: "/", c: "/calendar", l: "/hours", a: "/areas", s: "/settings" };
        if (dest[k]) {
          e.preventDefault();
          router.push(dest[k]);
        }
        return;
      }
      if (k === "g") gPending.current = Date.now();
      else if (k === "n") {
        e.preventDefault();
        ui.setQuickAddOpen(true);
      } else if (e.key === "/") {
        e.preventDefault();
        ui.setSearchOpen(true);
      } else if (k === "t") {
        ui.setCalDate(new Date());
        if (path !== "/calendar") router.push(path === "/" ? "/" : "/calendar");
      } else if (k === "w" || k === "m") {
        ui.setCalView(k === "w" ? "week" : "month");
        if (path !== "/calendar") router.push("/calendar");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui, router, path]);
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { setQuickAddOpen, setSearchOpen } = useUi();
  const lists = useLists();
  const tasks = useTasks();
  void lists;
  const openCount = tasks.filter((t) => !t.completed_at).length;

  return (
    <div className="relative z-[1] min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-rule px-4 py-6 md:flex">
        <Link href="/" className="display mb-8 px-2 text-2xl leading-none italic">
          Daybook
          <span className="mt-1 block text-[0.7rem] not-italic tracking-wide text-ink3" style={{ fontFamily: "var(--f-body)" }}>
            school &amp; extracurriculars
          </span>
        </Link>
        <button className="btn btn-primary mb-5 w-full justify-between" onClick={() => setQuickAddOpen(true)}>
          <span className="inline-flex items-center gap-2">
            <IconPlus /> Add
          </span>
          <kbd className="text-xs opacity-70">N</kbd>
        </button>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV.map((n) => {
            const active = isActive(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-md px-3 py-2 transition-colors ${active ? "bg-sheet2 font-semibold" : "text-ink2 hover:bg-sheet2/70 hover:text-ink"}`}
                style={active ? { boxShadow: "inset 3px 0 0 var(--margin)" } : undefined}
              >
                <n.icon />
                <span className="flex-1">{n.label}</span>
                <span className="text-[0.68rem] text-ink3 opacity-0 transition-opacity group-hover:opacity-100">{n.hint}</span>
              </Link>
            );
          })}
        </nav>
        <button className="btn btn-ghost mt-3 justify-start text-ink2" onClick={() => setSearchOpen(true)}>
          <IconSearch /> Search <kbd className="ml-auto text-xs text-ink3">/</kbd>
        </button>
        <div className="mt-auto flex flex-col gap-2 px-1">
          <p className="num px-2 text-xs text-ink3">{openCount} open tasks</p>
          <SyncDot />
          <ThemeToggle className="!justify-start" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-rule bg-paper/90 px-4 py-2 backdrop-blur md:hidden" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
          <Link href="/" className="display text-xl italic">
            Daybook
          </Link>
          <div className="flex items-center gap-1">
            <SyncDot />
            <button className="btn btn-ghost !px-2" aria-label="Search" onClick={() => setSearchOpen(true)}>
              <IconSearch />
            </button>
            <Link href="/settings" className="btn btn-ghost !px-2" aria-label="Settings">
              <IconSettings />
            </Link>
          </div>
        </header>
        {localMode && (
          <div className="border-b border-rule bg-sheet2 px-4 py-1.5 text-center text-xs text-ink2">
            Local dev data: stored only in this browser. Supabase isn&apos;t connected yet, so nothing syncs.
          </div>
        )}
        <main className="w-full min-w-0 flex-1 px-4 pb-32 pt-5 md:px-8 md:pb-16 md:pt-9 2xl:px-12"><Mounted>{children}</Mounted></main>
      </div>

      <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-rulestrong bg-paper/95 backdrop-blur md:hidden">
        {[NAV[0], NAV[1], null, NAV[2], NAV[3]].map((n, i) =>
          n ? (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(path, n.href) ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-[0.7rem] ${isActive(path, n.href) ? "font-semibold text-ink" : "text-ink2"}`}
            >
              <n.icon />
              {n.label}
              <span aria-hidden className="h-0.5 w-5 rounded-full" style={{ background: isActive(path, n.href) ? "var(--margin)" : "transparent" }} />
            </Link>
          ) : (
            <button key={i} className="flex items-center justify-center" aria-label="Add" onClick={() => setQuickAddOpen(true)}>
              <span className="grid h-11 w-11 place-items-center rounded-full bg-accent text-accentink shadow-lg">
                <IconPlus />
              </span>
            </button>
          ),
        )}
      </nav>

      <Shortcuts />
      <QuickAddDialog />
      <SearchDialog />
      <EditorDialog />
      <Toasts />
    </div>
  );
}
