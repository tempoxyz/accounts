"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

/** Three states the toggle cycles through. `system` follows the OS. */
export type Theme = "system" | "light" | "dark";
/** The concrete theme that ends up on the DOM. */
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "accounts-landing-theme";
const DATASET_KEY = "accountsLandingTheme";
const TRANSITIONS_DATASET_KEY = "accountsLandingTransitions";
const TARGET_TRANSITIONS_DATASET_KEY = "themeTransitions";

const isBrowser = typeof window !== "undefined";

function readStored(): Theme {
  if (!isBrowser) return "system";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

function systemPrefersLight(): boolean {
  if (!isBrowser || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

/** Resolves `system` against the live OS preference. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "light" || theme === "dark") return theme;
  return systemPrefersLight() ? "light" : "dark";
}

/** Synchronous initial pick used to avoid flash-of-wrong-theme on first paint.
 * Prefers the value the head script already wrote onto <html>; falls back to
 * a fresh resolve from localStorage + matchMedia. */
function getInitialResolved(): ResolvedTheme {
  if (!isBrowser) return "dark";
  const cached = document.documentElement.dataset[DATASET_KEY];
  if (cached === "light" || cached === "dark") return cached;
  return resolveTheme(readStored());
}

type Ctx = {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (next: Theme) => void;
  cycleTheme: () => void;
};

const ThemeContext = createContext<Ctx | null>(null);

/** Mounted at the landing root. Owns the `data-theme` attribute on the
 * `.accounts-landing` element and the localStorage round-trip. */
export function ThemeProvider({
  target,
  children,
}: {
  target: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(() => readStored());
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    getInitialResolved(),
  );

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      const order: Theme[] = ["system", "light", "dark"];
      const next = order[(order.indexOf(prev) + 1) % order.length] ?? "system";
      try {
        if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
        else window.localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    setResolved(resolveTheme(theme));
  }, [theme]);

  useEffect(() => {
    if (theme !== "system" || !isBrowser) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setResolved(mq.matches ? "light" : "dark");
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [theme]);

  useLayoutEffect(() => {
    if (!isBrowser) return;
    const root = document.documentElement;
    const el = target.current;
    root.dataset[TRANSITIONS_DATASET_KEY] = "disabled";
    if (el) el.dataset[TARGET_TRANSITIONS_DATASET_KEY] = "disabled";
    if (el) el.dataset.theme = resolved;
    root.dataset[DATASET_KEY] = resolved;

    const frame = window.requestAnimationFrame(() => {
      delete root.dataset[TRANSITIONS_DATASET_KEY];
      if (el) delete el.dataset[TARGET_TRANSITIONS_DATASET_KEY];
    });

    return () => {
      window.cancelAnimationFrame(frame);
      delete root.dataset[TRANSITIONS_DATASET_KEY];
      if (el) delete el.dataset[TARGET_TRANSITIONS_DATASET_KEY];
    };
  }, [target, resolved]);

  const ctx = useMemo<Ctx>(
    () => ({ theme, resolved, setTheme, cycleTheme }),
    [theme, resolved, setTheme, cycleTheme],
  );

  return <ThemeContext.Provider value={ctx}>{children}</ThemeContext.Provider>;
}

/** Read theme state from any landing component. */
export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx)
    throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

/** Convenience: read a CSS custom property from a themed root. Used by
 * canvas components to consume the colour catalogue at draw time. */
export function readCssVar(el: Element | null, name: string): string {
  if (!el || !isBrowser) return "";
  return getComputedStyle(el).getPropertyValue(name).trim();
}
