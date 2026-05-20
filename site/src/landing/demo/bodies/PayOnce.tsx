"use client";

import type { DemoBodyProps } from "../types";
import { bodyAnimation } from "./shared";

export function PayOnceBody({
  status,
  result,
  onAction,
  delay,
}: DemoBodyProps) {
  const buttonLabel =
    status === "running"
      ? "Opening Tempo…"
      : status === "done"
        ? "Payment sent"
        : "Complete purchase";

  return (
    <div
      className="flex w-full max-w-[366px] flex-col gap-4 bg-panel-2 p-6"
      style={bodyAnimation(delay)}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-foreground-muted">Pro Plan</p>
        <p className="font-mono text-[32px] leading-none text-foreground sm:text-[36px]">
          $240
        </p>
      </div>
      <button
        type="button"
        onClick={() => onAction()}
        disabled={status === "running"}
        className="mt-2 flex w-full items-center justify-center bg-cta px-2.5 py-2 outline-none focus-visible:outline-2 focus-visible:outline-info focus-visible:outline-offset-2 transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:opacity-80"
      >
        {status === "running" ? (
          <span
            aria-hidden
            className="mr-2 size-1.5 shrink-0 rounded-full bg-cta-fg"
            style={{ animation: "pulseDot 900ms ease-in-out infinite" }}
          />
        ) : null}
        <span className="text-[14px] text-cta-fg">{buttonLabel}</span>
      </button>
      {result?.summary ? (
        <p className="font-mono text-[10px] text-foreground-subtle">{result.summary}</p>
      ) : null}
    </div>
  );
}
