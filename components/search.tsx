"use client";

import { useMemo, useState } from "react";
import { eventItem, taskItem, type AgendaItem } from "@/lib/agenda";
import { format } from "@/lib/dates";
import { useGoogleEvents, useLists, useTasks } from "@/lib/hooks";
import { useUi } from "@/lib/ui";
import { Dialog } from "./dialog";
import { ListDot } from "./bits";

export function SearchDialog() {
  const { searchOpen, setSearchOpen, openEditor } = useUi();
  return (
    <Dialog open={searchOpen} onClose={() => setSearchOpen(false)} label="Search" top>
      {searchOpen && (
        <SearchBody
          onPick={(i) => {
            setSearchOpen(false);
            if (i.task) openEditor({ kind: "task", task: i.task });
            else if (i.event) openEditor({ kind: "event", event: i.event });
          }}
        />
      )}
    </Dialog>
  );
}

function SearchBody({ onPick }: { onPick: (i: AgendaItem) => void }) {
  const [q, setQ] = useState("");
  const tasks = useTasks();
  const events = useGoogleEvents();
  const lists = useLists();

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const listName = (id: string | null) => lists.find((l) => l.id === id)?.name.toLowerCase() ?? "";
    const hit = (title: string, notes: string, listId: string | null) =>
      title.toLowerCase().includes(needle) || notes.toLowerCase().includes(needle) || listName(listId).includes(needle);
    const out = [
      ...tasks.filter((t) => hit(t.title, t.notes, t.list_id)).map(taskItem),
      ...events.filter((e) => hit(e.summary, e.description, e.list_id)).map((e) => eventItem(e)),
    ];
    return out.sort((a, b) => +!!a.done - +!!b.done || +a.at - +b.at).slice(0, 30);
  }, [q, tasks, events, lists]);

  return (
    <div className="p-4">
      <label htmlFor="search" className="sr-only">
        Search tasks and events
      </label>
      <input id="search" data-autofocus className="field !min-h-11 !text-base" placeholder="Search tasks and events" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      <ul className="mt-3 max-h-[50dvh] overflow-y-auto">
        {results.map((i) => {
          const list = lists.find((l) => l.id === i.listId);
          return (
            <li key={i.key}>
              <button className="flex w-full items-center gap-3 rounded px-2 py-2 text-left hover:bg-sheet2" onClick={() => onPick(i)}>
                {list ? <ListDot color={list.color} /> : <span className="w-[9px]" />}
                <span className={`flex-1 truncate ${i.done ? "text-ink3 line-through" : ""}`}>{i.title}</span>
                <span className="num text-xs text-ink3">
                  {i.kind === "event" ? "Event · " : ""}
                  {i.task && !i.task.due_at ? "No date" : format(i.at, "MMM d")}
                </span>
              </button>
            </li>
          );
        })}
        {q.trim() && results.length === 0 && <li className="px-2 py-6 text-center text-sm text-ink3">Nothing matches “{q}”.</li>}
      </ul>
    </div>
  );
}
