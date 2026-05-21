"use client";

import type { DemoBodyProps } from "../types";
import { PrimaryButton, useBodyAnimation } from "./shared";

function SwapArrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M5 2v10M5 12L2 9M5 12l3-3M11 14V4M11 4l-3 3M11 4l3 3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TokenRow({
  label,
  amount,
  token,
}: {
  label: string;
  amount: string;
  token: string;
}) {
  return (
    <div className="flex flex-col gap-2 bg-panel-3 px-4 py-3 sm:px-5 sm:py-4">
      <p className="text-[12px] text-foreground-muted">{label}</p>
      <div className="flex items-baseline justify-between gap-2.5">
        <p className="font-mono text-[20px] leading-none tabular-nums text-foreground sm:text-[24px]">
          {amount}
        </p>
        <span className="bg-panel-4 px-2 py-0.5 font-mono text-[11px] tracking-wide text-foreground-muted">
          {token}
        </span>
      </div>
    </div>
  );
}

export function TradeBody({
  status,
  result,
  onAction,
  delay,
}: DemoBodyProps) {
  const body = useBodyAnimation(delay);
  const buttonLabel =
    status === "running"
      ? "Opening Tempo…"
      : status === "done"
        ? "Exchanged"
        : "Exchange";

  return (
    <div
      ref={body.ref}
      className="flex w-full max-w-[420px] flex-col gap-3 bg-panel-2 p-6"
      style={body.style}
    >
      <TokenRow label="From" amount="100" token="USDC" />
      <div className="flex items-center justify-center py-2 text-foreground-muted">
        <SwapArrow />
      </div>
      <TokenRow label="To" amount="92.34" token="EURC" />

      <PrimaryButton
        label={buttonLabel}
        status={status}
        onClick={onAction}
        className="mt-2 h-11 w-full"
      />
      {result?.summary ? (
        <p className="font-mono text-[12px] text-foreground-muted">{result.summary}</p>
      ) : null}
    </div>
  );
}
