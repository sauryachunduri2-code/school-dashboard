"use client";

import { useMemo, useState } from "react";
import { Empty, ListDot, ListSelect } from "@/components/bits";
import { IconDownload, IconTrash } from "@/components/icons";
import { hoursToCsv, totalsFor } from "@/lib/csv";
import { addDays, format, parseYmd, startOfWeek, WEEK_STARTS_ON, ymd } from "@/lib/dates";
import { newHoursLog, useHours, useLists, useRowMutations } from "@/lib/hooks";
import { useUi } from "@/lib/ui";
import { AREAS, type HoursLog } from "@/lib/types";

const r1 = (n: number) => Math.round(n * 10) / 10;

export default function HoursPage() {
  const lists = useLists();
  const logs = useHours();
  const { upsert, remove } = useRowMutations("hours_logs");
  const { toast } = useUi();

  const today = ymd(new Date());
  const ecLists = lists.filter((l) => l.area === "ecs");
  const [editing, setEditing] = useState<HoursLog | null>(null);
  const [date, setDate] = useState(today);
  // undefined = "not chosen yet": default to the first EC once lists have loaded
  const [chosenList, setListId] = useState<string | null | undefined>(undefined);
  const listId = chosenList === undefined ? (ecLists[0]?.id ?? null) : chosenList;
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [range, setRange] = useState<"month" | "all">("month");

  const monthPrefix = today.slice(0, 7);
  const weekStart = startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON });
  const t = useMemo(() => totalsFor(logs, monthPrefix, ymd(weekStart), ymd(addDays(weekStart, 7))), [logs, monthPrefix, weekStart]);

  const perList = useMemo(
    () =>
      lists
        .map((l) => ({ l, ...totalsFor(logs.filter((x) => x.list_id === l.id), monthPrefix, ymd(weekStart), ymd(addDays(weekStart, 7))) }))
        .filter((x) => x.all > 0)
        .sort((a, b) => b.all - a.all),
    [lists, logs, monthPrefix, weekStart],
  );
  const unassigned = logs.filter((l) => !l.list_id);

  const shown = useMemo(
    () => logs.filter((l) => range === "all" || l.date.startsWith(monthPrefix)).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)),
    [logs, range, monthPrefix],
  );

  function reset() {
    setEditing(null);
    setHours("");
    setNote("");
    setDate(today);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const h = parseFloat(hours);
    if (!(h > 0) || h > 24) {
      toast("Enter hours between 0 and 24.");
      return;
    }
    const value = Math.round(h * 100) / 100;
    if (editing) await upsert({ ...editing, date, list_id: listId, hours: value, note });
    else await upsert(newHoursLog({ date, list_id: listId, hours: value, note }));
    toast(editing ? "Entry updated" : `Logged ${value} h`);
    reset();
  }

  function exportCsv() {
    const blob = new Blob([hoursToCsv(logs, lists)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ec-hours-${today}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0" aria-labelledby="hours-title">
        <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h1 id="hours-title" className="display text-4xl md:text-5xl">
            Hours
          </h1>
          <button className="btn" onClick={exportCsv} disabled={logs.length === 0}>
            <IconDownload /> Export CSV
          </button>
        </header>

        <form onSubmit={submit} className="sheet mb-6 grid gap-3 p-4 sm:grid-cols-[9.5rem_1fr_6rem]">
          <label className="grid gap-1 text-sm font-medium text-ink2">
            Date
            <input type="date" className="field" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink2">
            EC
            <ListSelect lists={lists} value={listId} onChange={setListId} />
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink2">
            Hours
            <input className="field num" inputMode="decimal" placeholder="1.5" value={hours} onChange={(e) => setHours(e.target.value)} required />
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink2 sm:col-span-3">
            Note
            <input className="field" placeholder="What did you do?" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2 sm:col-span-3">
            {editing && (
              <button type="button" className="btn" onClick={reset}>
                Cancel
              </button>
            )}
            <button className="btn btn-primary" type="submit">
              {editing ? "Save entry" : "Log hours"}
            </button>
          </div>
        </form>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="display text-2xl">Log</h2>
          <div role="radiogroup" aria-label="Range" className="inline-flex overflow-hidden rounded-md border border-rulestrong text-sm">
            {(["month", "all"] as const).map((r) => (
              <button key={r} role="radio" aria-checked={range === r} onClick={() => setRange(r)} className={`px-3 py-1 ${range === r ? "bg-accent text-accentink" : "hover:bg-sheet2"}`}>
                {r === "month" ? format(new Date(), "MMMM") : "All time"}
              </button>
            ))}
          </div>
        </div>
        <div className="sheet overflow-hidden">
          {shown.length === 0 ? (
            <Empty title="No hours logged here yet." hint="Use the form, or type “log 2h hosa poster” in quick add." />
          ) : (
            shown.map((l) => {
              const list = lists.find((x) => x.id === l.list_id);
              return (
                <div key={l.id} className="flex items-center gap-3 border-b border-rule px-3 py-2.5">
                  <span className="num w-16 shrink-0 text-sm text-ink2">{format(parseYmd(l.date), "MMM d")}</span>
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => {
                      setEditing(l);
                      setDate(l.date);
                      setListId(l.list_id);
                      setHours(String(l.hours));
                      setNote(l.note);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    aria-label={`Edit ${l.hours} hours ${list?.name ?? ""} ${l.note}`}
                  >
                    {list ? <ListDot color={list.color} /> : <span className="w-[9px]" />}
                    <span className="truncate">
                      <span className="font-medium">{list?.name ?? "No EC"}</span>
                      {l.note && <span className="text-ink2"> · {l.note}</span>}
                    </span>
                  </button>
                  <span className="num shrink-0 font-medium">{r1(l.hours)} h</span>
                  <button className="btn btn-ghost !min-h-8 !px-2 text-ink3 hover:text-overdue" aria-label="Delete entry" onClick={() => remove(l.id)}>
                    <IconTrash width={16} height={16} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>

      <aside className="grid content-start gap-6" aria-label="Totals">
        <div>
          <h2 className="display mb-3 text-xl">Totals</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["This week", t.week],
              [format(new Date(), "MMM"), t.month],
              ["All time", t.all],
            ].map(([label, v]) => (
              <div key={label as string} className="sheet px-2 py-3">
                <div className="display num text-3xl leading-none">{r1(v as number)}</div>
                <div className="mt-1 text-xs text-ink2">{label}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="display mb-2 text-xl">By activity</h2>
          {perList.length === 0 && unassigned.length === 0 ? (
            <p className="text-sm text-ink3">Totals per EC appear here.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink3">
                  <th className="pb-1 font-medium">EC</th>
                  <th className="pb-1 text-right font-medium">Week</th>
                  <th className="pb-1 text-right font-medium">Month</th>
                  <th className="pb-1 text-right font-medium">All</th>
                </tr>
              </thead>
              <tbody>
                {AREAS.flatMap((a) => perList.filter((x) => x.l.area === a.id)).map(({ l, week, month, all }) => (
                  <tr key={l.id} className="border-t border-rule">
                    <td className="py-1.5">
                      <span className="flex items-center gap-2">
                        <ListDot color={l.color} />
                        {l.name}
                      </span>
                    </td>
                    <td className="num py-1.5 text-right text-ink2">{r1(week)}</td>
                    <td className="num py-1.5 text-right text-ink2">{r1(month)}</td>
                    <td className="num py-1.5 text-right font-medium">{r1(all)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </div>
  );
}
