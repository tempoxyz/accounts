"use client";

import { useState, type CSSProperties, type KeyboardEvent } from "react";
import type { DemoBodyProps } from "../types";
import { useBodyAnimation } from "./shared";

const ACCENTS = [
  { id: "neutral", label: "Neutral", color: "var(--swatch-neutral)" },
  { id: "blue", label: "Blue", color: "var(--swatch-blue)" },
  { id: "red", label: "Red", color: "var(--swatch-red)" },
  { id: "amber", label: "Amber", color: "var(--swatch-amber)" },
  { id: "green", label: "Green", color: "var(--swatch-green)" },
  { id: "purple", label: "Purple", color: "var(--swatch-purple)" },
] as const;

const RADII = [
  { id: "none", label: "None", value: "0px" },
  { id: "small", label: "Small", value: "4px" },
  { id: "medium", label: "Medium", value: "6px" },
  { id: "large", label: "Large", value: "12px" },
] as const;

const SCHEMES = ["light", "dark"] as const;

function activateOnKey(
  event: KeyboardEvent<HTMLButtonElement>,
  activate: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

export function ThemesBody({ delay }: DemoBodyProps) {
  const body = useBodyAnimation(delay);
  const [accent, setAccent] = useState<(typeof ACCENTS)[number]>(ACCENTS[0]);
  const [radius, setRadius] = useState<(typeof RADII)[number]>(RADII[1]);
  const [scheme, setScheme] = useState<(typeof SCHEMES)[number]>("light");
  const preview =
    scheme === "light"
      ? {
          bg: "var(--preview-light-bg)",
          text: "var(--preview-light-header)",
          muted: "var(--preview-light-meta)",
        }
      : {
          bg: "var(--preview-dark-bg)",
          text: "var(--preview-dark-header)",
          muted: "var(--preview-dark-meta)",
        };

  return (
    <div
      ref={body.ref}
      className="flex w-full max-w-[460px] flex-col gap-5 bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-foreground-muted">Embedded prompt</p>
        <p className="text-[20px] leading-tight text-foreground">
          Choose your favorite style
        </p>
      </div>

      <div
        className="flex flex-col gap-4 p-4"
        style={{
          "--theme-accent": accent.color,
          "--theme-accent-hover":
            "oklch(from var(--theme-accent) calc(l + (clamp(0, (0.6 - l) * 999, 1) * 0.075) - (clamp(0, (l - 0.6) * 999, 1) * 0.06)) calc(c * 0.98) h)",
          "--theme-accent-active":
            "oklch(from var(--theme-accent) calc(l + (clamp(0, (0.6 - l) * 999, 1) * 0.13) - (clamp(0, (l - 0.6) * 999, 1) * 0.12)) calc(c * 0.96) h)",
          "--theme-on-accent":
            "oklch(from var(--theme-accent) clamp(0, (0.6 - l) * 999, 1) 0 0)",
          background: preview.bg,
          color: preview.text,
          colorScheme: scheme,
          borderRadius: radius.value,
        } as CSSProperties}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: "var(--theme-accent)" }}
          />
          <span className="text-[12px]" style={{ color: preview.muted }}>
            Tempo Wallet
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-[16px] leading-tight" style={{ color: preview.text }}>
            Sign in to continue
          </p>
          <p className="text-[12px]" style={{ color: preview.muted }}>
            Your account prompt uses the style selected by your app.
          </p>
        </div>
        <button
          type="button"
          className="h-11 w-full bg-[var(--theme-accent)] px-5 text-[14px] text-white outline-none hover:bg-[var(--theme-accent-hover)] active:bg-[var(--theme-accent-active)]"
          style={{
            borderRadius: radius.value,
            color: "var(--theme-on-accent)",
          }}
        >
          Continue with Tempo
        </button>
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <div className="min-w-0 flex flex-col gap-2">
            <p className="font-mono text-[11px] tracking-[0.08em] text-foreground-subtle uppercase">
              Scheme
            </p>
            <div className="grid grid-cols-2 gap-1">
              {SCHEMES.map((item) => {
                const active = item === scheme;
                return (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={active}
                    onPointerDown={() => setScheme(item)}
                    onKeyDown={(event) => activateOnKey(event, () => setScheme(item))}
                    className={`px-2 py-1.5 font-mono text-[11px] capitalize outline-none hover:bg-secondary-hover active:bg-secondary-active active:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 ${active ? "bg-secondary-hover text-foreground" : "bg-secondary text-foreground-muted"}`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[11px] tracking-[0.08em] text-foreground-subtle uppercase">
              Accent
            </p>
            <div
              className="flex flex-wrap gap-2 pb-1.5"
              style={{ colorScheme: scheme }}
            >
              {ACCENTS.map((item) => {
                const active = item.id === accent.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={item.label}
                    aria-pressed={active}
                    onPointerDown={() => setAccent(item)}
                    onKeyDown={(event) => activateOnKey(event, () => setAccent(item))}
                    className="relative size-7 border border-[color-mix(in_oklab,var(--foreground)_14%,transparent)] outline-none active:border-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
                    style={{ background: item.color }}
                  >
                    <span
                      aria-hidden
                      className={`absolute -bottom-1.5 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-foreground ${active ? "opacity-100" : "opacity-0"}`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="min-w-0 flex flex-col gap-2">
          <p className="font-mono text-[11px] tracking-[0.08em] text-foreground-subtle uppercase">
            Radius
          </p>
          <div className="grid grid-cols-4 gap-1">
            {RADII.map((item) => {
              const active = item.id === radius.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onPointerDown={() => setRadius(item)}
                  onKeyDown={(event) => activateOnKey(event, () => setRadius(item))}
                  className={`min-w-0 px-2 py-1.5 font-mono text-[11px] outline-none hover:bg-secondary-hover active:bg-secondary-active active:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 ${active ? "bg-secondary-hover text-foreground" : "bg-secondary text-foreground-muted"}`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
