"use client";

import { useTheme } from "./useTheme";

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={className}
    >
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.5v1.7M8 12.8v1.7M1.5 8h1.7M12.8 8h1.7M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M3.4 12.6l1.2-1.2M11.4 4.6l1.2-1.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M13 9.6A5.4 5.4 0 0 1 6.4 3a5.6 5.6 0 1 0 6.6 6.6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Two-state light/dark toggle. The icon shown represents the CURRENT
 * resolved theme (sun for light, moon for dark); clicking it flips to
 * the opposite. The hook still supports a `"system"` state for the
 * initial first-paint default; once the user clicks, the choice is
 * persisted to `localStorage` and the toggle owns the truth. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { resolved, setTheme } = useTheme();
  const next = resolved === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`grid size-7 place-items-center text-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[opacity,transform] hover:opacity-75 active:translate-y-px active:opacity-90 ${className ?? ""}`}
    >
      {resolved === "light" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
