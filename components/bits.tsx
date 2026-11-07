"use client";

import { AREAS, type List } from "@/lib/types";
import { IconFlag, IconStar } from "./icons";

export function ListDot({ color, size = 9 }: { color: string; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color }} />;
}

export function ListTag({ list }: { list?: List | null }) {
  if (!list) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink2">
      <ListDot color={list.color} size={8} />
      {list.name}
    </span>
  );
}

export function ListSelect({ lists, value, onChange, id }: { lists: List[]; value: string | null; onChange: (v: string | null) => void; id?: string }) {
  return (
    <select id={id} className="field" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No list</option>
      {AREAS.map((a) => (
        <optgroup key={a.id} label={a.label}>
          {lists
            .filter((l) => l.area === a.id)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export function StarFlag({
  starred,
  flagged,
  onStar,
  onFlag,
}: {
  starred: boolean;
  flagged: boolean;
  onStar?: () => void;
  onFlag?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={onStar}
        disabled={!onStar}
        aria-pressed={starred}
        aria-label={starred ? "Remove star (countdown)" : "Star for countdown"}
        className={`rounded p-1 ${starred ? "text-accent" : "text-ink3 hover:text-ink"} ${onStar ? "" : "pointer-events-none"}`}
        style={starred ? { color: "var(--margin)" } : undefined}
      >
        <IconStar filled={starred} width={16} height={16} />
      </button>
      <button
        type="button"
        onClick={onFlag}
        disabled={!onFlag}
        aria-pressed={flagged}
        aria-label={flagged ? "Remove flag" : "Flag as important"}
        className={`rounded p-1 ${flagged ? "text-overdue" : "text-ink3 hover:text-ink"} ${onFlag ? "" : "pointer-events-none"}`}
      >
        <IconFlag filled={flagged} width={16} height={16} />
      </button>
    </span>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="display text-lg italic text-ink2">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink3">{hint}</p>}
    </div>
  );
}
