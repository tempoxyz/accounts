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
            className="flex items-center justify-center px-2.5 py-1.5 font-mono text-[14px] outline-none transition-colors duration-150"
            style={{
              background: active ? "#141414" : "#0c0c0c",
              border: active ? "1px solid #2e2e2e" : "1px solid transparent",
              color: active ? "#ffffff" : "rgba(255,255,255,0.5)",
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
