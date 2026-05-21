"use client";

import { useState } from "react";
import type { DemoBodyProps } from "../types";
import { useBodyAnimation } from "./shared";

const ACCENTS = [
  { id: "neutral", label: "Neutral", color: "#71717a" },
  { id: "blue", label: "Blue", color: "#3b82f6" },
  { id: "red", label: "Red", color: "#eb0000" },
  { id: "amber", label: "Amber", color: "#f59e0b" },
  { id: "green", label: "Green", color: "#22c55e" },
  { id: "purple", label: "Purple", color: "#a855f7" },
] as const;

const RADII = [
  { id: "none", label: "None", value: "0px" },
  { id: "small", label: "Small", value: "4px" },
  { id: "medium", label: "Medium", value: "12px" },
  { id: "large", label: "Large", value: "24px" },
] as const;

const SCHEMES = ["light", "dark"] as const;

export function ThemesBody({ delay }: DemoBodyProps) {
  const body = useBodyAnimation(delay);
  const [accent, setAccent] = useState<(typeof ACCENTS)[number]>(ACCENTS[1]);
  const [radius, setRadius] = useState<(typeof RADII)[number]>(RADII[2]);
  const [scheme, setScheme] = useState<(typeof SCHEMES)[number]>("light");
  const preview =
    scheme === "light"
      ? {
          bg: "var(--preview-light-bg)",
          border: "var(--preview-light-border)",
          text: "var(--preview-light-header)",
          muted: "var(--preview-light-meta)",
          buttonText: "#ffffff",
        }
      : {
          bg: "var(--preview-dark-bg)",
          border: "var(--preview-dark-border)",
          text: "var(--preview-dark-header)",
          muted: "var(--preview-dark-meta)",
          buttonText: "#ffffff",
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
        className="flex flex-col gap-4 border p-4"
        style={{
          background: preview.bg,
          borderColor: preview.border,
          color: preview.text,
          borderRadius: radius.value,
        }}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: accent.color }}
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
          className="h-11 w-full px-5 text-[14px] text-white outline-none"
          style={{
            background: accent.color,
            borderRadius: radius.value,
            color: preview.buttonText,
          }}
        >
          Continue with Tempo
        </button>
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <div className="min-w-[104px] flex flex-col gap-2">
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
                    onClick={() => setScheme(item)}
                    className={`border px-2 py-1.5 font-mono text-[11px] capitalize outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 active:translate-y-px ${active ? "border-foreground bg-foreground text-background" : "border-panel-edge bg-panel-3 text-foreground-muted"}`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-w-0 flex flex-col gap-2">
            <p className="font-mono text-[11px] tracking-[0.08em] text-foreground-subtle uppercase">
              Accent
            </p>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((item) => {
                const active = item.id === accent.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={item.label}
                    aria-pressed={active}
                    onClick={() => setAccent(item)}
                    className={`size-7 border outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 active:translate-y-px ${active ? "border-foreground" : "border-panel-edge"}`}
                    style={{ background: item.color }}
                  />
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
                  onClick={() => setRadius(item)}
                  className={`min-w-0 bg-panel-3 px-2 py-1.5 font-mono text-[11px] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 active:translate-y-px ${active ? "text-foreground" : "text-foreground-muted"}`}
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
