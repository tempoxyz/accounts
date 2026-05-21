"use client";

import { useEffect, useRef, useState } from "react";

export function ScrollableTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (t: T) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 4;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setEdges((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  // Auto-scroll the active tab into view when value changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLButtonElement>(
      `button[data-tab="${value}"]`,
    );
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const parentRect = el.getBoundingClientRect();
    if (rect.left < parentRect.left || rect.right > parentRect.right) {
      target.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [value]);

  return (
    <div className="relative w-full">
      <div
        ref={scrollRef}
        className="scrollbar-hide flex w-full items-center justify-start gap-0 overflow-x-auto px-6"
        style={{ scrollSnapType: "x proximity" }}
      >
        <div className="mx-auto flex shrink-0 items-center">
          {tabs.map((t) => {
            const active = t === value;
            return (
              <button
                key={t}
                type="button"
                data-tab={t}
                onClick={() => onChange(t)}
                className={`relative flex shrink-0 items-center justify-center border px-2.5 py-1.5 font-mono text-[14px] outline-none focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[background-color,border-color,color] duration-150 ${active ? "border-panel-edge bg-panel-1 text-foreground" : "border-transparent bg-panel-0 text-foreground-muted"}`}
                style={{ scrollSnapAlign: "center" }}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-panel-0 to-transparent transition-opacity duration-200"
        style={{ opacity: edges.left ? 1 : 0 }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-panel-0 to-transparent transition-opacity duration-200"
        style={{ opacity: edges.right ? 1 : 0 }}
      />
    </div>
  );
}
