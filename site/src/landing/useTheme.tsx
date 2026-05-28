"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/** Three states the toggle cycles through. `system` follows the OS. */
export type Theme = "system" | "light" | "dark";
/** The concrete theme that ends up on the DOM. */
export type ResolvedTheme = "light" | "dark";

// We piggyback on vocs's theme rather than running a parallel themer: vocs
// owns the `vocs-theme` localStorage key and writes the resolved value onto
// `<html>`'s inline `color-scheme` (via a blocking head script, so it is set
// before first paint). The landing CSS keys its light overrides off that same
// `color-scheme`, so reading/writing it here keeps everything in lockstep.
const STORAGE_KEY = "vocs-theme";

const isBrowser = typeof window !== "undefined";

// Mirror vocs's own transition-kill so flipping the theme doesn't cross-fade.
const DISABLE_TRANSITIONS_CSS =
  "*,*::before,*::after{transition:none!important}";

function readStored(): Theme {
  if (!isBrowser) return "system";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

function systemTheme(): ResolvedTheme {
  if (!isBrowser || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Resolves `system` against the live OS preference. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "light" || theme === "dark") return theme;
  return systemTheme();
}

/** Reads vocs's authoritative signal: the `color-scheme` it writes on <html>.
 * Falls back to a fresh resolve from `vocs-theme` + matchMedia. */
function readResolved(): ResolvedTheme {
  if (!isBrowser) return "dark";
  const scheme = document.documentElement.style.colorScheme;
  if (scheme === "light" || scheme === "dark") return scheme;
  return resolveTheme(readStored());
}

/** Writes the resolved theme onto <html> the same way vocs does, with a
 * transient transition-kill to avoid a flash. */
function applyResolved(resolved: ResolvedTheme) {
  if (!isBrowser) return;
  const style = document.createElement("style");
  style.appendChild(document.createTextNode(DISABLE_TRANSITIONS_CSS));
  document.head.appendChild(style);
  document.documentElement.style.colorScheme = resolved;
  // Force a reflow so the color-scheme change commits before transitions
  // are re-enabled on the next frame.
  void window.getComputedStyle(document.body).opacity;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (style.parentNode) document.head.removeChild(style);
    });
  });
}

type Ctx = {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (next: Theme) => void;
  cycleTheme: () => void;
};

const ThemeContext = createContext<Ctx | null>(null);

/** Mounted at the landing root. Bridges the landing UI to vocs's theme:
 * reads the resolved value vocs put on <html>, and writes back through the
 * same `vocs-theme` + `color-scheme` channel when the landing toggle fires. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => readResolved());

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    const r = resolveTheme(next);
    setResolved(r);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    applyResolved(r);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      const order: Theme[] = ["system", "light", "dark"];
      const next = order[(order.indexOf(prev) + 1) % order.length] ?? "system";
      const r = resolveTheme(next);
      setResolved(r);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      applyResolved(r);
      return next;
    });
  }, []);

  // Track the OS preference while in `system` mode.
  useEffect(() => {
    if (theme !== "system" || !isBrowser) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r: ResolvedTheme = mq.matches ? "dark" : "light";
      setResolved(r);
      applyResolved(r);
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [theme]);

  // Sync with theme changes made outside the landing toggle — vocs's own nav
  // toggle (writes `color-scheme` on <html>) or another tab (storage event).
  useEffect(() => {
    if (!isBrowser) return;
    setResolved(readResolved());
    setThemeState(readStored());

    const observer = new MutationObserver(() => setResolved(readResolved()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });

    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== STORAGE_KEY) return;
      setThemeState(readStored());
      setResolved(readResolved());
    };
    window.addEventListener("storage", onStorage);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const ctx = useMemo<Ctx>(
    () => ({ theme, resolved, setTheme, cycleTheme }),
    [theme, resolved, setTheme, cycleTheme],
  );

  return <ThemeContext.Provider value={ctx}>{children}</ThemeContext.Provider>;
}

/** Read theme state from any landing component. */
export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

/** Convenience: read a CSS custom property from a themed root. Used by
 * canvas components to consume the colour catalogue at draw time. */
export function readCssVar(el: Element | null, name: string): string {
  if (!el || !isBrowser) return "";
  return getComputedStyle(el).getPropertyValue(name).trim();
}
