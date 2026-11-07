"use client";

import { useMemo, useState } from "react";
import { Empty, ListDot, ListTag, StarFlag } from "@/components/bits";
import { IconRepeat } from "@/components/icons";
import { QuickAdd } from "@/components/quickadd";
import { TaskCheck } from "@/components/task-row";
import { format } from "@/lib/dates";
import { describeRrule } from "@/lib/recurrence";
import { useLists, useTaskActions, useTasks } from "@/lib/hooks";
import { isOverdue } from "@/lib/tasks";
import { AREAS, type List, type Task } from "@/lib/types";
import { useUi } from "@/lib/ui";

type Sel = { type: "list"; id: string } | { type: "smart"; id: "all" | "flagged" | "starred" | "completed" };

const SMART: { id: "all" | "flagged" | "starred" | "completed"; label: string }[] = [
  { id: "all", label: "All open" },
  { id: "flagged", label: "Flagged" },
  { id: "starred", label: "Starred" },
  { id: "completed", label: "Completed" },
];

const byDue = (a: Task, b: Task) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") || a.title.localeCompare(b.title);

function TaskLine({ task, list, showList }: { task: Task; list?: List; showList: boolean }) {
  const actions = useTaskActions();
  const { openEditor } = useUi();
  const overdue = isOverdue(task);
  return (
    <div className="flex min-h-[44px] items-center gap-3 border-b border-rule px-3 py-1.5">
      <TaskCheck done={!!task.completed_at} label={`Complete ${task.title}`} onToggle={() => actions.toggleComplete(task)} />
      <button className="flex min-w-0 flex-1 items-baseline gap-2 text-left" onClick={() => openEditor({ kind: "task", task })}>
        <span className={`truncate ${task.completed_at ? "text-ink3 line-through" : ""}`}>{task.title}</span>
        {task.rrule && <IconRepeat width={13} height={13} className="shrink-0 self-center text-ink3" aria-label={describeRrule(task.rrule)} />}
        {showList && (
          <span className="hidden shrink-0 sm:inline">
            <ListTag list={list} />
          </span>
        )}
      </button>
      {task.due_at && (
        <span className={`num shrink-0 text-xs ${overdue ? "font-semibold text-overdue" : "text-ink3"}`}>
          {format(new Date(task.due_at), task.all_day ? "EEE, MMM d" : "EEE, MMM d · h:mm a")}
        </span>
      )}
      <StarFlag
        starred={task.starred}
        flagged={task.flagged}
        onStar={() => actions.update(task, { starred: !task.starred })}
        onFlag={() => actions.update(task, { flagged: !task.flagged })}
      />
    </div>
  );
}

export default function AreasPage() {
  const lists = useLists();
  const tasks = useTasks();
  const [sel, setSel] = useState<Sel>({ type: "smart", id: "all" });

  const open = useMemo(() => tasks.filter((t) => !t.completed_at), [tasks]);
  const count = (id: string) => open.filter((t) => t.list_id === id).length;

  const shown = useMemo(() => {
    let rows: Task[];
    if (sel.type === "list") rows = tasks.filter((t) => t.list_id === sel.id && !t.completed_at);
    else if (sel.id === "all") rows = open;
    else if (sel.id === "flagged") rows = open.filter((t) => t.flagged);
    else if (sel.id === "starred") rows = open.filter((t) => t.starred);
    else rows = tasks.filter((t) => t.completed_at).sort((a, b) => b.completed_at!.localeCompare(a.completed_at!));
    return sel.type === "smart" && sel.id === "completed" ? rows : rows.sort(byDue);
  }, [tasks, open, sel]);

  const completedInList = sel.type === "list" ? tasks.filter((t) => t.list_id === sel.id && t.completed_at).sort((a, b) => b.completed_at!.localeCompare(a.completed_at!)) : [];
  const [showDone, setShowDone] = useState(false);
  const selList = sel.type === "list" ? lists.find((l) => l.id === sel.id) : undefined;
  const title = sel.type === "list" ? (selList?.name ?? "List") : SMART.find((s) => s.id === sel.id)!.label;

  const isSel = (s: Sel) => JSON.stringify(s) === JSON.stringify(sel);
  const pill = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${active ? "bg-sheet2 font-semibold" : "text-ink2 hover:bg-sheet2/70 hover:text-ink"}`;

  return (
    <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10">
      <nav aria-label="Lists" className="grid content-start gap-5">
        <div className="grid gap-0.5">
          {SMART.map((s) => {
            const state: Sel = { type: "smart", id: s.id };
            return (
              <button key={s.id} className={pill(isSel(state))} aria-current={isSel(state) ? "true" : undefined} onClick={() => setSel(state)}>
                {s.label}
                {s.id === "flagged" && <span className="num ml-auto text-xs text-ink3">{open.filter((t) => t.flagged).length || ""}</span>}
                {s.id === "starred" && <span className="num ml-auto text-xs text-ink3">{open.filter((t) => t.starred).length || ""}</span>}
                {s.id === "all" && <span className="num ml-auto text-xs text-ink3">{open.length || ""}</span>}
              </button>
            );
          })}
        </div>
        {AREAS.map((a) => (
          <div key={a.id}>
            <h2 className="display mb-1 px-3 text-lg" style={{ color: `var(--${a.id})` }}>
              {a.label}
            </h2>
            <div className="grid gap-0.5">
              {lists
                .filter((l) => l.area === a.id)
                .map((l) => {
                  const state: Sel = { type: "list", id: l.id };
                  return (
                    <button key={l.id} className={pill(isSel(state))} aria-current={isSel(state) ? "true" : undefined} onClick={() => setSel(state)}>
                      <ListDot color={l.color} />
                      <span className="truncate">{l.name}</span>
                      <span className="num ml-auto text-xs text-ink3">{count(l.id) || ""}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>

      <section aria-labelledby="area-title" className="min-w-0">
        <h1 id="area-title" className="display mb-1 flex items-center gap-3 text-4xl">
          {selList && <ListDot color={selList.color} size={14} />}
          {title}
        </h1>
        <p className="num mb-4 text-sm text-ink2">
          {shown.length} {sel.type === "smart" && sel.id === "completed" ? "completed" : "open"}
        </p>
        {!(sel.type === "smart" && sel.id === "completed") && <QuickAdd className="mb-4" defaultListId={selList?.id ?? null} placeholder={selList ? `Add to ${selList.name}` : "Add a task"} />}
        <div className="sheet overflow-hidden">
          {shown.length === 0 ? (
            <Empty title={sel.type === "smart" && sel.id === "completed" ? "Nothing completed yet." : "All clear here."} hint={sel.type === "list" ? "Add a task above." : undefined} />
          ) : (
            shown.map((t) => <TaskLine key={t.id} task={t} list={lists.find((l) => l.id === t.list_id)} showList={sel.type === "smart"} />)
          )}
        </div>
        {completedInList.length > 0 && (
          <div className="mt-5">
            <button className="btn btn-ghost !px-1 text-ink2" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
              Completed ({completedInList.length})
            </button>
            {showDone && (
              <div className="sheet mt-2 overflow-hidden">
                {completedInList.map((t) => (
                  <TaskLine key={t.id} task={t} list={selList} showList={false} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
