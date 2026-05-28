"use client";

import { waapi, type WAAPIAnimation } from "animejs";
import { useEffect, useRef, useState } from "react";
import { springs } from "./animation";
import { useTheme } from "./useTheme";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

type ThemePreset = "Default" | "Minimal" | "Marketplace" | "Custom";

type Palette = {
  bg: string;
  border?: string;
  rounded?: string;
  headerColor: string;
  metaColor: string;
  skeleton: string;
  buttonBg: string;
  buttonText: string;
  buttonRounded?: string;
  /** Used by OrderPizzaCard's accent block; falls back to skeleton. */
  accent?: string;
};

/** Maps `Dialog.Theme` from the SDK 1:1 — the three settings the wallet dialog supports. */
type CustomTheme = {
  /** Hex/CSS color for the primary action (button). */
  accent: string;
  radius: "none" | "small" | "medium" | "large" | "full";
  scheme: "light" | "dark";
};

// Note: the accent presets are passed as `Dialog.Theme["accent"]` to the
// SDK and recorded as the literal hex value. To keep that contract clear
// these stay as hex strings (also mirrored into styles.css as
// `--swatch-*` tokens for visual reference).
const ACCENT_PRESETS = [
  { id: "neutral", label: "Neutral", color: "#71717a" },
  { id: "blue", label: "Blue", color: "#3b82f6" },
  { id: "red", label: "Red", color: "#eb0000" },
  { id: "amber", label: "Amber", color: "#f59e0b" },
  { id: "green", label: "Green", color: "#22c55e" },
  { id: "purple", label: "Purple", color: "#a855f7" },
] as const;

const RADIUS_OPTIONS = [
  { id: "none", label: "None", px: "0px" },
  { id: "small", label: "Sm", px: "4px" },
  { id: "medium", label: "Md", px: "12px" },
  { id: "large", label: "Lg", px: "24px" },
  { id: "full", label: "Full", px: "9999px" },
] as const;

const RADIUS_BY_ID: Record<CustomTheme["radius"], string> = {
  none: "0px",
  small: "4px",
  medium: "12px",
  large: "24px",
  full: "9999px",
};

// The preview palettes describe what the *SDK dialog* looks like, so
// they're intentionally theme-invariant (the page's light/dark toggle
// doesn't repaint these — they're sample wallets). All colour values are
// kept in styles.css as `--preview-*` tokens so the catalogue stays
// single-sourced.
function customPalette(theme: CustomTheme): Palette {
  const radius = RADIUS_BY_ID[theme.radius];
  // The SDK's `full` preset is designed for small elements (buttons,
  // pills). Applying it to a 358×384 card renders a giant stadium —
  // not representative of the SDK's intent. Cap card rounded at a
  // sensible value, while the small button stays fully round.
  const cardRadius = theme.radius === "full" ? "32px" : radius;
  if (theme.scheme === "dark") {
    return {
      bg: "var(--preview-dark-bg)",
      border: "var(--preview-dark-border)",
      rounded: cardRadius,
      headerColor: "var(--preview-dark-header)",
      metaColor: "var(--preview-dark-meta)",
      skeleton: "var(--preview-dark-skeleton)",
      buttonBg: theme.accent,
      buttonText: "var(--preview-button-text)",
      buttonRounded: radius,
    };
  }
  return {
    bg: "var(--preview-light-bg)",
    border: "var(--preview-light-border)",
    rounded: cardRadius,
    headerColor: "var(--preview-light-header)",
    metaColor: "var(--preview-light-meta)",
    skeleton: "var(--preview-light-skeleton)",
    buttonBg: theme.accent,
    buttonText: "var(--preview-button-text)",
    buttonRounded: radius,
  };
}

const NATIVE: Record<
  "orderPizza" | "balancesDark" | "clearInvoice" | "reload",
  Palette
> = {
  orderPizza: {
    bg: "var(--preview-pizza-bg)",
    border: "var(--preview-pizza-border)",
    rounded: "24px",
    headerColor: "var(--preview-pizza-header)",
    metaColor: "var(--preview-pizza-meta)",
    skeleton: "var(--preview-pizza-skeleton)",
    buttonBg: "var(--preview-pizza-button-bg)",
    buttonText: "var(--preview-button-text)",
    buttonRounded: "9999px",
  },
  balancesDark: {
    bg: "var(--preview-dark-bg)",
    border: "var(--preview-dark-border)",
    headerColor: "var(--preview-dark-header)",
    metaColor: "var(--preview-dark-meta)",
    skeleton: "var(--preview-dark-skeleton)",
    buttonBg: "var(--preview-dark-button-bg)",
    buttonText: "var(--preview-button-text)",
  },
  clearInvoice: {
    bg: "var(--preview-invoice-bg)",
    headerColor: "var(--preview-invoice-header)",
    metaColor: "var(--preview-invoice-meta)",
    skeleton: "var(--preview-invoice-skeleton)",
    buttonBg: "var(--preview-invoice-button-bg)",
    buttonText: "var(--preview-button-text)",
  },
  reload: {
    bg: "var(--preview-reload-bg)",
    border: "var(--preview-reload-border)",
    headerColor: "var(--preview-reload-header)",
    metaColor: "var(--preview-reload-meta)",
    skeleton: "var(--preview-reload-skeleton)",
    buttonBg: "var(--preview-reload-button-bg)",
    buttonText: "var(--preview-button-text)",
  },
};

const MINIMAL: Palette = {
  bg: "var(--preview-invoice-bg)",
  headerColor: "var(--preview-invoice-header)",
  metaColor: "var(--preview-invoice-meta)",
  skeleton: "var(--preview-invoice-skeleton)",
  buttonBg: "var(--preview-invoice-button-bg)",
  buttonText: "var(--preview-button-text)",
};

const MARKETPLACE: Palette = {
  bg: "var(--preview-pizza-bg)",
  border: "var(--preview-pizza-border)",
  rounded: "24px",
  headerColor: "var(--preview-pizza-header)",
  metaColor: "var(--preview-marketplace-meta)",
  skeleton: "var(--preview-pizza-skeleton)",
  buttonBg: "var(--preview-pizza-button-bg)",
  buttonText: "var(--preview-button-text)",
  buttonRounded: "9999px",
};

function paletteFor(
  preset: ThemePreset,
  cardKey: keyof typeof NATIVE,
  custom: CustomTheme,
): Palette {
  if (preset === "Minimal") return MINIMAL;
  if (preset === "Marketplace") return MARKETPLACE;
  if (preset === "Custom") return customPalette(custom);
  return NATIVE[cardKey];
}

function Skeleton({
  className,
  bg,
}: {
  className?: string;
  bg: string;
  delay?: number;
}) {
  return (
    <span
      aria-hidden
      className={`block ${className ?? ""}`}
      style={{
        background: bg,
        opacity: 0.82,
      }}
    />
  );
}

function CardShell({
  palette,
  children,
  width = 358,
}: {
  palette: Palette;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      data-customize-card
      className="flex h-[384px] shrink-0 flex-col justify-between p-[12.7px]"
      style={{
        width,
        background: palette.bg,
        borderRadius: palette.rounded ?? 0,
        border: palette.border ? `0.7px solid ${palette.border}` : undefined,
      }}
    >
      {children}
    </div>
  );
}

function Cta({
  label,
  palette,
  full = false,
}: {
  label: string;
  palette: Palette;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      className={`grid h-9 place-items-center text-[12px] tracking-[0.1134px] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-opacity hover:opacity-90 ${full ? "w-full" : "w-[313px] self-center"}`}
      style={{
        background: palette.buttonBg,
        color: palette.buttonText,
        borderRadius: palette.buttonRounded ?? 0,
      }}
    >
      {label}
    </button>
  );
}

function OrderPizzaCard({ palette }: { palette: Palette }) {
  const accent = palette.accent ?? palette.skeleton;
  return (
    <CardShell palette={palette}>
      <div className="flex flex-col">
        <div className="flex items-center justify-between pb-3">
          <p
            className="text-[12px] tracking-[0.1134px]"
            style={{ color: palette.headerColor }}
          >
            Order Pizza
          </p>
          <p
            className="text-[12px] tracking-[0.0992px]"
            style={{ color: palette.metaColor }}
          >
            View order
          </p>
        </div>
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <Skeleton className="size-[71px]" bg={accent} />
            <Skeleton className="h-9 w-[46px]" bg={accent} delay={120} />
          </div>
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Skeleton
                    className="size-[18px] rounded-full"
                    bg={palette.skeleton}
                    delay={i * 80}
                  />
                  <Skeleton
                    className="h-3 w-14"
                    bg={palette.skeleton}
                    delay={i * 80 + 40}
                  />
                </div>
                <Skeleton
                  className="h-3 w-[46px]"
                  bg={palette.skeleton}
                  delay={i * 80 + 80}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <Cta label="Make Payment" palette={palette} />
    </CardShell>
  );
}

function BalancesCard({ palette }: { palette: Palette }) {
  return (
    <CardShell palette={palette}>
      <div className="flex flex-col">
        <div className="flex items-center justify-between pb-3">
          <p
            className="text-[12px] tracking-[0.1134px]"
            style={{ color: palette.headerColor }}
          >
            Balances
          </p>
          <p
            className="text-[12px] tracking-[0.0992px]"
            style={{ color: palette.metaColor }}
          >
            View all
          </p>
        </div>
        <div className="flex flex-col gap-3 pb-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between py-[3px]">
              <div className="flex items-center gap-2">
                <Skeleton
                  className="size-[18px] rounded-full"
                  bg={palette.skeleton}
                  delay={i * 120}
                />
                <Skeleton
                  className="h-3 w-14"
                  bg={palette.skeleton}
                  delay={i * 120 + 80}
                />
              </div>
              <Skeleton
                className="h-3 w-[46px]"
                bg={palette.skeleton}
                delay={i * 120 + 160}
              />
            </div>
          ))}
        </div>
      </div>
      <Cta label="Sign in" palette={palette} />
    </CardShell>
  );
}

function ClearInvoiceCard({ palette }: { palette: Palette }) {
  return (
    <CardShell palette={palette} width={299}>
      <div className="flex flex-col">
        <div className="flex items-start justify-between pb-3">
          <p
            className="text-[12px] tracking-[0.1134px]"
            style={{ color: palette.headerColor }}
          >
            Clear Invoice
          </p>
          <p
            className="text-[12px] tracking-[0.0992px]"
            style={{ color: palette.metaColor }}
          >
            Paytrie Inc
          </p>
        </div>
        <div className="flex flex-col gap-3 pb-2">
          <div className="flex h-[144px] items-start justify-between py-[3px]">
            <Skeleton className="h-7 w-[157px]" bg={palette.skeleton} />
            <Skeleton
              className="h-3 w-[46px]"
              bg={palette.skeleton}
              delay={80}
            />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between py-[3px]">
              <div className="flex items-center gap-2">
                <Skeleton
                  className="size-[18px] rounded-full"
                  bg={palette.skeleton}
                  delay={i * 120}
                />
                <Skeleton
                  className="h-3 w-14"
                  bg={palette.skeleton}
                  delay={i * 120 + 80}
                />
              </div>
              <Skeleton
                className="h-3 w-[46px]"
                bg={palette.skeleton}
                delay={i * 120 + 160}
              />
            </div>
          ))}
        </div>
      </div>
      <Cta label="Sign in" palette={palette} full />
    </CardShell>
  );
}

function ReloadCard({ palette }: { palette: Palette }) {
  return (
    <CardShell palette={palette}>
      <div className="flex flex-col">
        <div className="flex items-center justify-between pb-3">
          <p
            className="text-[12px] tracking-[0.12px]"
            style={{ color: palette.headerColor }}
          >
            Reload Card
          </p>
          <p
            className="text-[12px] tracking-[0.0992px]"
            style={{ color: palette.metaColor }}
          >
            View all
          </p>
        </div>
        <div className="flex flex-col gap-3 pb-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between py-[3px]">
              <div className="flex items-center gap-2">
                <Skeleton
                  className="size-[18px] rounded-full"
                  bg={palette.skeleton}
                  delay={i * 120}
                />
                <Skeleton
                  className="h-3 w-14"
                  bg={palette.skeleton}
                  delay={i * 120 + 80}
                />
              </div>
              <Skeleton
                className="h-3 w-[46px]"
                bg={palette.skeleton}
                delay={i * 120 + 160}
              />
            </div>
          ))}
        </div>
      </div>
      <Cta label="Sign in" palette={palette} />
    </CardShell>
  );
}

function ThemeSwitcher({
  value,
  onChange,
}: {
  value: ThemePreset;
  onChange: (t: ThemePreset) => void;
}) {
  const presets: ThemePreset[] = [
    "Default",
    "Minimal",
    "Marketplace",
    "Custom",
  ];
  return (
    <div className="flex items-center">
      {presets.map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`relative flex items-center justify-center border px-2.5 py-1.5 font-mono text-[16px] outline-none focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[background-color,border-color,color] duration-150 ${active ? "border-panel-edge bg-panel-1 text-foreground" : "border-transparent bg-panel-0 text-foreground-muted"}`}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Floating toolbar that exposes the SDK's `Dialog.Theme` settings —
 * accent / radius / scheme. Live-updates the marquee cards as the
 * user changes any value.
 */
function CustomThemeToolbar({
  theme,
  onChange,
}: {
  theme: CustomTheme;
  onChange: (next: CustomTheme) => void;
}) {
  return (
    <div className="flex w-full max-w-[920px] flex-col gap-3 border border-panel-edge bg-panel-0 px-5 py-4 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-center sm:gap-x-6">
      {/* Accent */}
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[12px] tracking-[0.18em] text-foreground-subtle uppercase">
          Accent
        </span>
        <div className="flex items-center gap-1.5">
          {ACCENT_PRESETS.map((a) => {
            const active = theme.accent.toLowerCase() === a.color.toLowerCase();
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onChange({ ...theme, accent: a.color })}
                aria-label={a.label}
                aria-pressed={active}
                className="grid size-5 place-items-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-transform hover:scale-110"
                style={{
                  background: a.color,
                  boxShadow: active
                    ? "0 0 0 2px var(--panel-0), 0 0 0 4px var(--foreground-muted)"
                    : "0 0 0 1px var(--border-strong)",
                }}
              />
            );
          })}
        </div>
        <label
          className="ml-1 grid size-5 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-border-strong"
          aria-label="Custom accent"
          title="Custom color"
        >
          <input
            type="color"
            value={theme.accent}
            onChange={(e) => onChange({ ...theme, accent: e.target.value })}
            className="size-9 cursor-pointer border-0 bg-transparent p-0 opacity-0"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute size-5 rounded-full"
            style={{ background: "var(--preview-rainbow)" }}
          />
        </label>
      </div>

      <span aria-hidden className="hidden h-4 w-px bg-border-strong sm:block" />

      {/* Radius */}
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[12px] tracking-[0.18em] text-foreground-subtle uppercase">
          Radius
        </span>
        <div className="flex items-center gap-1">
          {RADIUS_OPTIONS.map((r) => {
            const active = theme.radius === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onChange({ ...theme, radius: r.id })}
                aria-pressed={active}
                className={`relative flex items-center justify-center border px-2 py-1 font-mono text-[12px] outline-none focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[background-color,border-color,color] duration-150 ${active ? "border-panel-edge bg-panel-3 text-foreground" : "border-transparent bg-transparent text-foreground-muted"}`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      <span aria-hidden className="hidden h-4 w-px bg-border-strong sm:block" />

      {/* Scheme */}
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[12px] tracking-[0.18em] text-foreground-subtle uppercase">
          Scheme
        </span>
        <div className="flex items-center gap-1">
          {(["light", "dark"] as const).map((s) => {
            const active = theme.scheme === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ ...theme, scheme: s })}
                aria-pressed={active}
                className={`relative flex items-center justify-center border px-2 py-1 font-mono text-[12px] capitalize outline-none focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[background-color,border-color,color] duration-150 ${active ? "border-panel-edge bg-panel-3 text-foreground" : "border-transparent bg-transparent text-foreground-muted"}`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Customize() {
  const [theme, setTheme] = useState<ThemePreset>("Custom");
  const sectionRef = useRef<HTMLElement | null>(null);
  const marqueeRef = useRef<HTMLDivElement | null>(null);
  const marqueeAnimationRef = useRef<WAAPIAnimation | null>(null);
  const cardAnimationRef = useRef<WAAPIAnimation | null>(null);
  // The Custom preset's `scheme` tracks the global site theme: it seeds
  // from the resolved theme on first paint and re-syncs whenever the user
  // flips the page's light/dark switch, so the preview always matches the
  // surrounding page. The toolbar's own Light/Dark toggle still lets the
  // user override it until the next global flip.
  const { resolved } = useTheme();
  const [custom, setCustom] = useState<CustomTheme>(() => ({
    accent: "#3b82f6",
    radius: "medium",
    scheme: resolved,
  }));

  useEffect(() => {
    setCustom((prev) =>
      prev.scheme === resolved ? prev : { ...prev, scheme: resolved },
    );
  }, [resolved]);

  useEffect(() => {
    const el = marqueeRef.current;
    if (!el) return;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    const start = () => {
      marqueeAnimationRef.current?.cancel();
      marqueeAnimationRef.current = null;

      if (media.matches) {
        el.style.transform = "translate3d(0, 0, 0)";
        return;
      }

      marqueeAnimationRef.current = waapi.animate(el, {
        transform: ["translate3d(0, 0, 0)", "translate3d(-50%, 0, 0)"],
        duration: 50_000,
        ease: "linear",
        loop: true,
      });
    };

    start();
    media.addEventListener("change", start);
    return () => {
      media.removeEventListener("change", start);
      marqueeAnimationRef.current?.cancel();
      marqueeAnimationRef.current = null;
    };
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;

    cardAnimationRef.current?.cancel();
    cardAnimationRef.current = waapi.animate(
      [...section.querySelectorAll<HTMLElement>("[data-customize-card]")],
      {
        opacity: [0.72, 1],
        translateY: [10, 0],
        delay: (_target, index) => (index % 5) * 22,
        ease: springs.gentle,
      },
    );

    return () => {
      cardAnimationRef.current?.cancel();
      cardAnimationRef.current = null;
    };
  }, [theme]);

  const cards = (
    <>
      <OrderPizzaCard palette={paletteFor(theme, "orderPizza", custom)} />
      <BalancesCard palette={paletteFor(theme, "balancesDark", custom)} />
      <ClearInvoiceCard palette={paletteFor(theme, "clearInvoice", custom)} />
      <ReloadCard palette={paletteFor(theme, "reload", custom)} />
      <BalancesCard palette={paletteFor(theme, "balancesDark", custom)} />
    </>
  );

  return (
    <section
      ref={sectionRef}
      className="px-6 pt-12 pb-20 sm:pt-14 sm:pb-28"
      style={{ animation: `fadeUp 600ms ${easeOut} 0ms both` }}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <h2 className="font-display text-[32px] leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[40px]">
          Customize to <br className="sm:hidden" /> match your app
        </h2>
        <p className="max-w-[600px] text-[18px] text-foreground-muted">
          Tempo Accounts SDK ships with full control on customizability to allow
          you to design embed like your native styles.
        </p>
        <div className="mt-5">
          <ThemeSwitcher value={theme} onChange={setTheme} />
        </div>
        <div
          aria-hidden={theme !== "Custom"}
          className="flex w-full justify-center overflow-hidden"
          style={{
            maxHeight: theme === "Custom" ? "260px" : "0",
            opacity: theme === "Custom" ? 1 : 0,
            transform:
              theme === "Custom" ? "translateY(0)" : "translateY(-8px)",
            marginTop: theme === "Custom" ? "20px" : "0",
            transition: `max-height 420ms ${easeOut}, opacity 280ms ${easeOut} ${theme === "Custom" ? "100ms" : "0ms"}, transform 420ms ${easeOut}, margin-top 420ms ${easeOut}`,
            pointerEvents: theme === "Custom" ? "auto" : "none",
          }}
        >
          <CustomThemeToolbar theme={custom} onChange={setCustom} />
        </div>
      </div>

      <div
        className="group mt-14 -mx-6 overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
        }}
      >
        <div
          ref={marqueeRef}
          className="flex w-max items-center will-change-transform"
          onMouseEnter={() => {
            marqueeAnimationRef.current?.pause();
          }}
          onMouseLeave={() => {
            marqueeAnimationRef.current?.resume();
          }}
        >
          {[0, 1].map((copy) => (
            <div
              key={copy}
              aria-hidden={copy === 1 ? true : undefined}
              className="flex shrink-0 items-center gap-[39px] pr-[39px]"
            >
              {cards}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
