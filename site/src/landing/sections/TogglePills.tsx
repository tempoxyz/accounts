"use client";

import { useEffect, useRef, useState } from "react";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Animated toggle pill group with a sliding active highlight. Modeled on
 * `AdapterTabs` in `hero.tsx`. Generic in `T` so options can carry a
 * typed `id` union (e.g. `"send" | "receive"`).
 */
export function TogglePills<const T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState({
    left: 0,
    width: 0,
    ready: false,
  });

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const button = container.querySelector<HTMLButtonElement>(
      `button[data-toggle="${value}"]`,
    );
    if (!button) return;
    setHighlight({
      left: button.offsetLeft,
      width: button.offsetWidth,
      ready: true,
    });
  }, [value]);

  return (
    <div className="flex items-stretch gap-3">
      {label ? (
        <span className="flex items-center pr-1 font-mono text-[10px] tracking-[0.18em] text-foreground-subtle uppercase">
          {label}
        </span>
      ) : null}
      <div ref={ref} className="relative flex items-center bg-panel-0">
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 border border-panel-edge bg-panel-1"
          style={{
            transform: `translateX(${highlight.left}px)`,
            width: highlight.width,
            opacity: highlight.ready ? 1 : 0,
            transition: highlight.ready
              ? `transform 280ms ${easeOut}, width 280ms ${easeOut}, opacity 200ms ease-out`
              : "opacity 200ms ease-out",
          }}
        />
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              data-toggle={o.id}
              onClick={() => onChange(o.id)}
              className={`relative z-10 flex items-center justify-center px-2.5 py-1.5 font-mono text-[14px] outline-none focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[color] duration-150 ${active ? "text-foreground" : "text-foreground-muted"}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
