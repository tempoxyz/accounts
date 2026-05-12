"use client";
import { useState } from "react";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

type ThemePreset = "Default" | "Minimal" | "Marketplace";

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

const NATIVE: Record<
  "orderPizza" | "balancesDark" | "clearInvoice" | "reload",
  Palette
> = {
  orderPizza: {
    bg: "#fff5f5",
    border: "#2e2e2e",
    rounded: "24px",
    headerColor: "#2d2d2d",
    metaColor: "#000000",
    skeleton: "#FFDAD4",
    buttonBg: "#eb0000",
    buttonText: "#ffffff",
    buttonRounded: "9999px",
  },
  balancesDark: {
    bg: "#141414",
    border: "#2e2e2e",
    headerColor: "#ededed",
    metaColor: "#a1a1a1",
    skeleton: "#292929",
    buttonBg: "#050505",
    buttonText: "#ffffff",
  },
  clearInvoice: {
    bg: "#395241",
    headerColor: "#ededed",
    metaColor: "#ffe3e3",
    skeleton: "#2e4435",
    buttonBg: "#26392c",
    buttonText: "#ffffff",
  },
  reload: {
    bg: "#ffd4a3",
    border: "#2e2e2e",
    headerColor: "#ff941a",
    metaColor: "#a1a1a1",
    skeleton: "#ffc27b",
    buttonBg: "#ffc27b",
    buttonText: "#ffffff",
  },
};

const MINIMAL: Palette = {
  bg: "#395241",
  headerColor: "#ededed",
  metaColor: "#ffe3e3",
  skeleton: "#2e4435",
  buttonBg: "#26392c",
  buttonText: "#ffffff",
};

const MARKETPLACE: Palette = {
  bg: "#fff5f5",
  border: "#2e2e2e",
  rounded: "24px",
  headerColor: "#2d2d2d",
  metaColor: "#7a1f1f",
  skeleton: "#FFDAD4",
  buttonBg: "#eb0000",
  buttonText: "#ffffff",
  buttonRounded: "9999px",
};

function paletteFor(
  preset: ThemePreset,
  cardKey: keyof typeof NATIVE,
): Palette {
  if (preset === "Minimal") return MINIMAL;
  if (preset === "Marketplace") return MARKETPLACE;
  return NATIVE[cardKey];
}

function Skeleton({
  className,
  bg,
  delay = 0,
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
        animation: `pulseDot 1600ms ease-in-out ${delay}ms infinite`,
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
      className={`grid h-9 place-items-center text-[11.336px] tracking-[0.1134px] outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90 ${full ? "w-full" : "w-[313px] self-center"}`}
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
            className="text-[11.336px] tracking-[0.1134px]"
            style={{ color: palette.headerColor }}
          >
            Order Pizza
          </p>
          <p
            className="text-[9.919px] tracking-[0.0992px]"
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
            className="text-[11.336px] tracking-[0.1134px]"
            style={{ color: palette.headerColor }}
          >
            Balances
          </p>
          <p
            className="text-[9.919px] tracking-[0.0992px]"
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
            className="text-[11.336px] tracking-[0.1134px]"
            style={{ color: palette.headerColor }}
          >
            Clear Invoice
          </p>
          <p
            className="text-[9.919px] tracking-[0.0992px]"
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
            className="text-[9.919px] tracking-[0.0992px]"
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
  const presets: ThemePreset[] = ["Default", "Minimal", "Marketplace"];
  return (
    <div className="flex items-center">
      {presets.map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className="flex items-center justify-center px-2.5 py-1.5 font-mono text-[14px] outline-none transition-colors duration-150"
            style={{
              background: active ? "#141414" : "#0c0c0c",
              border: active ? "1px solid #2e2e2e" : "1px solid transparent",
              color: active ? "#ffffff" : "rgba(255,255,255,0.5)",
            }}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

export default function Customize() {
  const [theme, setTheme] = useState<ThemePreset>("Default");

  const cards = (
    <>
      <OrderPizzaCard palette={paletteFor(theme, "orderPizza")} />
      <BalancesCard palette={paletteFor(theme, "balancesDark")} />
      <ClearInvoiceCard palette={paletteFor(theme, "clearInvoice")} />
      <ReloadCard palette={paletteFor(theme, "reload")} />
      <BalancesCard palette={paletteFor(theme, "balancesDark")} />
    </>
  );

  return (
    <section
      className="px-6 pt-[100px] pb-[120px]"
      style={{ animation: `fadeUp 600ms ${easeOut} 0ms both` }}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <h2 className="text-[32px] leading-[1.1] tracking-[-0.02em] text-white sm:text-[40px]">
          Customize to <br className="sm:hidden" /> match your app
        </h2>
        <p className="max-w-[600px] text-[16px] text-white/50 sm:text-[18px]">
          The Accounts SDK ships with full control on customizability to allow
          you to design embed like your native styles.
        </p>
        <div className="mt-5">
          <ThemeSwitcher value={theme} onChange={setTheme} />
        </div>
      </div>

      <div className="group mt-14 -mx-6 overflow-hidden">
        <div
          className="flex w-max items-center"
          style={{
            animation: "marquee 50s linear infinite",
            animationPlayState: "running",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.animationPlayState =
              "paused";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.animationPlayState =
              "running";
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
