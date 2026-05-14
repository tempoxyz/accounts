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
      className="flex w-full max-w-[366px] flex-col gap-4 bg-[#181818] p-6"
      style={bodyAnimation(delay)}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-white/50">Pro Plan</p>
        <p className="font-mono text-[32px] leading-none text-white sm:text-[36px]">
          $240
        </p>
      </div>
      <button
        type="button"
        onClick={() => onAction()}
        disabled={status === "running"}
        className="mt-2 flex w-full items-center justify-center bg-white px-2.5 py-2 outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:opacity-80"
      >
        {status === "running" ? (
          <span
            aria-hidden
            className="mr-2 size-1.5 shrink-0 rounded-full bg-[#181818]"
            style={{ animation: "pulseDot 900ms ease-in-out infinite" }}
          />
        ) : null}
        <span className="text-[14px] text-[#181818]">{buttonLabel}</span>
      </button>
      {result?.summary ? (
        <p className="font-mono text-[10px] text-white/40">{result.summary}</p>
      ) : null}
    </div>
  );
}
