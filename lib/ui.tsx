"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { GEvent, Task } from "./types";

export type CalView = "week" | "month";

/** What the editor dialog is working on. `draft` carries defaults for a not-yet-saved item. */
export type EditorTarget =
  | { kind: "task"; task: Task; isNew?: boolean }
  | { kind: "event"; event: GEvent | null; draft?: { start: string; end: string; all_day: boolean; calendar_id?: string }; isNew?: boolean };

interface UiState {
  calView: CalView;
  setCalView: (v: CalView) => void;
  calDate: Date;
  setCalDate: (d: Date) => void;
  quickAddOpen: boolean;
  setQuickAddOpen: (b: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (b: boolean) => void;
  editor: EditorTarget | null;
  openEditor: (t: EditorTarget | null) => void;
  toast: (message: string) => void;
  toasts: { id: number; message: string }[];
}

const Ctx = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [calView, setCalViewState] = useState<CalView>(() => {
    try {
      return (localStorage.getItem("sd-cal-view") as CalView) === "month" ? "month" : "week";
    } catch {
      return "week";
    }
  });
  const [calDate, setCalDate] = useState(() => new Date());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editor, openEditor] = useState<EditorTarget | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const nextId = useRef(1);

  const setCalView = useCallback((v: CalView) => {
    setCalViewState(v);
    try {
      localStorage.setItem("sd-cal-view", v);
    } catch {}
  }, []);

  const toast = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-1), { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);

  const value = useMemo(
    () => ({ calView, setCalView, calDate, setCalDate, quickAddOpen, setQuickAddOpen, searchOpen, setSearchOpen, editor, openEditor, toast, toasts }),
    [calView, setCalView, calDate, quickAddOpen, searchOpen, editor, toast, toasts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUi outside UiProvider");
  return v;
}
