"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ListDot } from "@/components/bits";
import { IconChevron, IconPlus, IconTrash } from "@/components/icons";
import { ThemePicker } from "@/components/theme-toggle";
import { uid } from "@/lib/dates";
import { localMode, OWNER_EMAIL } from "@/lib/env";
import { useCalendars, useGoogleStatus, useLists, useReminderSettings, useRowMutations, useSaveReminderSettings, useTasks } from "@/lib/hooks";
import { DEFAULT_OFFSET_CHOICES } from "@/lib/reminders";
import { INKS } from "@/lib/seed";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { AREAS, type Area, type List } from "@/lib/types";
import { useUi } from "@/lib/ui";

const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-rulestrong pt-6 md:grid-cols-[14rem_1fr] md:gap-10">
      <div>
        <h2 className="display text-2xl">{title}</h2>
        {hint && <p className="mt-1 text-sm text-ink3">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

// ------------------------------------------------------------ lists

function ListEditor({ list, siblings }: { list: List; siblings: List[] }) {
  const { upsert, remove } = useRowMutations("lists");
  const tasks = useTasks();
  const [name, setName] = useState(list.name);
  const [picking, setPicking] = useState(false);
  const idx = siblings.findIndex((l) => l.id === list.id);
  const count = tasks.filter((t) => t.list_id === list.id && !t.completed_at).length;

  const swap = async (other: List) => {
    await upsert({ ...list, sort: other.sort });
    await upsert({ ...other, sort: list.sort });
  };

  return (
    <li className="border-b border-rule py-2">
      <div className="flex items-center gap-2">
        <button
          className="grid h-8 w-8 place-items-center rounded hover:bg-sheet2"
          aria-label={`Change colour of ${list.name}`}
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
        >
          <ListDot color={list.color} size={14} />
        </button>
        <input
          className="field !min-h-8 flex-1"
          aria-label="List name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== list.name && upsert({ ...list, name: name.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <button className="btn btn-ghost !min-h-8 !px-1.5" aria-label="Move up" disabled={idx === 0} onClick={() => swap(siblings[idx - 1])}>
          <span style={{ display: "inline-block", transform: "rotate(-90deg)" }}>
            <IconChevron />
          </span>
        </button>
        <button className="btn btn-ghost !min-h-8 !px-1.5" aria-label="Move down" disabled={idx === siblings.length - 1} onClick={() => swap(siblings[idx + 1])}>
          <IconChevron dir="down" />
        </button>
        <button
          className="btn btn-ghost !min-h-8 !px-1.5 text-ink3 hover:text-overdue"
          aria-label={`Delete ${list.name}`}
          onClick={() => {
            if (confirm(count ? `Delete “${list.name}”? Its ${count} open task${count > 1 ? "s" : ""} will stay, with no list.` : `Delete “${list.name}”?`)) void remove(list.id);
          }}
        >
          <IconTrash width={16} height={16} />
        </button>
      </div>
      {picking && (
        <div className="anim-fade mt-2 flex flex-wrap gap-2 pl-10" role="radiogroup" aria-label="List colour">
          {INKS.map((ink) => (
            <button
              key={ink.value}
              role="radio"
              aria-checked={list.color === ink.value}
              aria-label={ink.name}
              title={ink.name}
              className="h-6 w-6 rounded-full"
              style={{ background: ink.value, outline: list.color === ink.value ? "2px solid var(--ink)" : "none", outlineOffset: 2 }}
              onClick={() => {
                void upsert({ ...list, color: ink.value });
                setPicking(false);
              }}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function ListsSection() {
  const lists = useLists();
  const { upsert } = useRowMutations("lists");
  const [adding, setAdding] = useState<Record<string, string>>({});

  async function add(area: Area) {
    const name = (adding[area] ?? "").trim();
    if (!name) return;
    const siblings = lists.filter((l) => l.area === area);
    const color = INKS[(lists.length + 2) % INKS.length].value;
    await upsert({ id: uid(), area, name, color, sort: (siblings.at(-1)?.sort ?? -1) + 1 });
    setAdding({ ...adding, [area]: "" });
  }

  return (
    <Section title="Lists" hint="Rename, recolour and reorder the lists inside each area.">
      <div className="grid gap-6">
        {AREAS.map((a) => {
          const siblings = lists.filter((l) => l.area === a.id);
          return (
            <div key={a.id}>
              <h3 className="display mb-1 text-lg" style={{ color: `var(--${a.id})` }}>
                {a.label}
              </h3>
              <ul>
                {siblings.map((l) => (
                  <ListEditor key={l.id + l.name + l.color + l.sort} list={l} siblings={siblings} />
                ))}
              </ul>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void add(a.id);
                }}
              >
                <input className="field !min-h-8 flex-1" placeholder={`New list in ${a.label}`} aria-label={`New list in ${a.label}`} value={adding[a.id] ?? ""} onChange={(e) => setAdding({ ...adding, [a.id]: e.target.value })} />
                <button className="btn !min-h-8" type="submit">
                  <IconPlus width={16} height={16} /> Add
                </button>
              </form>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------ google

function GoogleSection() {
  const { data: status, isLoading } = useGoogleStatus();
  const calendars = useCalendars();
  const { upsert } = useRowMutations("calendars");
  const qc = useQueryClient();
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    // The redirect URL must match Supabase's allow-list exactly (a query string falls back to the Site URL),
    // so the post-login destination travels in a short-lived cookie instead.
    document.cookie = "auth_next=/settings; path=/; max-age=600; samesite=lax";
    await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: GOOGLE_SCOPES,
        redirectTo: `${location.origin}/auth/callback`,
        queryParams: { access_type: "offline", prompt: "consent", login_hint: OWNER_EMAIL },
      },
    });
  }

  async function refresh() {
    setBusy(true);
    try {
      const res = await fetch("/api/google/calendars", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "failed");
      qc.setQueryData(["calendars"], json.calendars);
      await qc.invalidateQueries({ queryKey: ["gevents"] });
      toast("Calendars updated");
    } catch (e) {
      toast(e instanceof Error && e.message === "google-not-connected" ? "Google access expired. Connect again." : "Couldn't load calendars.");
    } finally {
      setBusy(false);
    }
  }

  // First time connected: pull the calendar list automatically.
  const needsFirstLoad = !!status?.connected && calendars.length === 0;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (needsFirstLoad) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFirstLoad]);

  const setEnabled = async (c: (typeof calendars)[number], enabled: boolean) => {
    await upsert({ ...c, enabled, is_default: enabled ? c.is_default : false });
    void qc.invalidateQueries({ queryKey: ["gevents"] });
  };
  const setDefault = async (c: (typeof calendars)[number]) => {
    for (const other of calendars.filter((x) => x.is_default && x.id !== c.id)) await upsert({ ...other, is_default: false });
    await upsert({ ...c, enabled: true, is_default: true });
  };

  return (
    <Section title="Google Calendar" hint="Events live in Google. The dashboard is a fast front end for them.">
      {localMode || !status?.configured ? (
        <div className="grid gap-2">
          <button className="btn w-fit" disabled>
            Connect Google Calendar (setup needed)
          </button>
          <p className="text-sm text-ink3">
            {localMode ? "Local dev mode has no accounts." : "Google isn't set up for this app yet."} Tasks, lists and hours all work without it. Follow GOOGLE_SETUP.md to switch calendar sync on.
          </p>
        </div>
      ) : !status.connected ? (
        <div className="grid gap-2">
          <button className="btn btn-primary w-fit" onClick={connect} disabled={busy || isLoading}>
            Connect Google Calendar
          </button>
          <p className="text-sm text-ink3">You&apos;ll be asked to let this app view and edit events and see your calendar list.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          <ul>
            {calendars.map((c) => (
              <li key={c.id} className="flex items-center gap-3 border-b border-rule py-2">
                <input type="checkbox" id={`cal-${c.id}`} checked={c.enabled} onChange={(e) => setEnabled(c, e.target.checked)} />
                <ListDot color={c.color} size={12} />
                <label htmlFor={`cal-${c.id}`} className="min-w-0 flex-1 truncate">
                  {c.summary}
                  {c.read_only && <span className="ml-2 text-xs text-ink3">read-only</span>}
                </label>
                {!c.read_only && (
                  <label className="flex items-center gap-1.5 text-sm text-ink2">
                    <input type="radio" name="default-cal" checked={c.is_default} onChange={() => setDefault(c)} />
                    New events
                  </label>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button className="btn" onClick={refresh} disabled={busy}>
              Refresh calendars
            </button>
            <button className="btn btn-ghost" onClick={connect} disabled={busy}>
              Reconnect
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ------------------------------------------------------------ notifications

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const toHhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** The default reminder every task with a due date gets. Stored in the database so the cron and every device agree. */
function DefaultReminder() {
  const settings = useReminderSettings();
  const save = useSaveReminderSettings();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="default-reminder" className="mb-1 block text-sm font-medium text-ink2">
          Default reminder
        </label>
        <select
          id="default-reminder"
          className="field"
          value={settings.default_remind_offset === null ? "none" : String(settings.default_remind_offset)}
          onChange={(e) => void save({ default_remind_offset: e.target.value === "none" ? null : Number(e.target.value) })}
        >
          {DEFAULT_OFFSET_CHOICES.map((c) => (
            <option key={String(c.value)} value={c.value === null ? "none" : String(c.value)}>
              {c.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink3">Every task with a due date gets this. Turn it off for one task in its editor, or add more reminders there.</p>
      </div>
      <div>
        <label htmlFor="allday-reminder" className="mb-1 block text-sm font-medium text-ink2">
          All-day tasks remind at
        </label>
        <input
          id="allday-reminder"
          type="time"
          className="field !w-36"
          value={toHhmm(settings.allday_remind_minutes)}
          onChange={(e) => {
            const [h, m] = e.target.value.split(":").map(Number);
            if (Number.isFinite(h) && Number.isFinite(m)) void save({ allday_remind_minutes: h * 60 + m });
          }}
        />
        <p className="mt-1 text-xs text-ink3">The time on the due day that the default reminder counts from.</p>
      </div>
    </div>
  );
}

function NotificationsSection() {
  const { toast } = useUi();
  const [state, setState] = useState<"checking" | "unsupported" | "needs-install" | "off" | "on" | "denied">("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
      if (ios && !standalone) return setState("needs-install");
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    })();
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw new Error("VAPID public key missing");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "could not save subscription");
      setState("on");
      toast("Notifications on for this device");
    } catch (e) {
      toast(`Couldn't turn on notifications: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
    setState("off");
  }

  async function test() {
    setBusy(true);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      toast(res.ok ? "Test sent. It should arrive in a few seconds." : "Couldn't send a test notification.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Notifications" hint="Task reminders arrive as push notifications at the exact time. Event alerts come from Google Calendar itself.">
      <div className="mb-5">
        <DefaultReminder />
      </div>
      {localMode ? (
        <p className="text-sm text-ink3">Push needs the database to store this device. It switches on once Supabase is connected.</p>
      ) : state === "needs-install" ? (
        <div className="grid gap-1 text-sm text-ink2">
          <p className="font-medium text-ink">Install on your iPhone first</p>
          <p>iPhone only allows notifications for apps on the Home Screen. In Safari tap Share, then Add to Home Screen, open Daybook from there, and come back to this page.</p>
        </div>
      ) : state === "unsupported" ? (
        <p className="text-sm text-ink3">This browser doesn&apos;t support push notifications.</p>
      ) : state === "denied" ? (
        <p className="text-sm text-ink2">Notifications are blocked for this site. Allow them in your browser or phone settings, then reload.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {state === "on" ? (
            <>
              <span className="chip">On for this device</span>
              <button className="btn" onClick={test} disabled={busy}>
                Send test
              </button>
              <button className="btn btn-ghost" onClick={disable}>
                Turn off
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={enable} disabled={busy || state === "checking"}>
              Turn on notifications
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

function InstallSection() {
  return (
    <Section title="Install" hint="Open it like an app, with its own icon.">
      <div className="grid gap-3 text-sm text-ink2 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 font-medium text-ink">iPhone</h3>
          <ol className="list-decimal pl-5">
            <li>Open this site in Safari.</li>
            <li>Tap Share, then Add to Home Screen.</li>
            <li>Open Daybook from the Home Screen. Turn on notifications here afterward.</li>
          </ol>
        </div>
        <div>
          <h3 className="mb-1 font-medium text-ink">Laptop</h3>
          <p>In Chrome or Edge, use the install icon in the address bar. In Safari, File, then Add to Dock.</p>
        </div>
      </div>
    </Section>
  );
}

export default function SettingsPage() {
  return (
    <div className="grid gap-8">
      <h1 className="display text-4xl md:text-5xl">Settings</h1>
      <Section title="Appearance" hint="Paper by day, lamplight at night.">
        <ThemePicker />
      </Section>
      <ListsSection />
      <GoogleSection />
      <NotificationsSection />
      <InstallSection />
      <Section title="Account">
        {localMode ? (
          <p className="text-sm text-ink2">Local dev data. Everything is stored in this browser only.</p>
        ) : (
          <form action="/auth/signout" method="post" className="flex items-center gap-3">
            <span className="text-sm text-ink2">Signed in as {OWNER_EMAIL}</span>
            <button className="btn" type="submit">
              Sign out
            </button>
          </form>
        )}
      </Section>
    </div>
  );
}
