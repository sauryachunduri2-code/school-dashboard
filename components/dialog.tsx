"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Centered modal on desktop, bottom sheet on phones. Esc and backdrop click close it. */
export function Dialog({
  open,
  onClose,
  label,
  children,
  wide,
  top,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  wide?: boolean;
  top?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus(), 10);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      clearTimeout(t);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-center" style={{ alignItems: top ? "flex-start" : undefined }}>
      <div className="anim-fade absolute inset-0 bg-black/35" onMouseDown={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`anim-pop sheet relative z-10 mt-auto max-h-[92dvh] w-full overflow-y-auto rounded-b-none rounded-t-xl md:my-auto md:rounded-md ${wide ? "md:max-w-2xl" : "md:max-w-lg"} ${top ? "md:mt-[12vh] md:mb-auto" : ""}`}
        style={{ border: "1px solid var(--rule-strong)" }}
      >
        {children}
      </div>
    </div>
  );
}
