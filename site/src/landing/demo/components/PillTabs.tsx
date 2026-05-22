"use client";

export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="flex items-center">
      {tabs.map((t) => {
        const active = t === value;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={`relative flex items-center justify-center border px-2.5 py-1.5 font-mono text-[14px] outline-none hover:bg-secondary-hover active:bg-secondary-active active:text-foreground focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 ${active ? "border-panel-edge bg-secondary-hover text-foreground" : "border-transparent bg-panel-0 text-foreground-muted"}`}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
