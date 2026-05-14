"use client";

import type { DemoBodyProps } from "../types";
import { PrimaryButton, bodyAnimation } from "./shared";

export function OnRampBody({
  status,
  result,
  onAction,
  delay,
  connectedBalance,
}: DemoBodyProps) {
  const buttonLabel =
    status === "running"
      ? "Opening deposit…"
      : status === "done"
        ? "Funds received"
        : "Deposit funds";

  return (
    <div
      className="flex w-full max-w-[420px] flex-col gap-4 bg-[#181818] p-6"
      style={bodyAnimation(delay)}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-white/50">Available balance</p>
        <p className="font-mono text-[28px] tabular-nums text-white">
          {connectedBalance ?? "$0.00"}
        </p>
      </div>
      <p className="text-[13px] text-white/50">
        The wallet renders the full deposit UI (cards, Apple Pay, crypto, X
        verification) — your app just calls{" "}
        <span className="font-mono text-white/80">wallet_deposit</span>.
      </p>
      <PrimaryButton
        label={buttonLabel}
        status={status}
        onClick={onAction}
        className="h-11 w-full"
      />
      {result?.summary ? (
        <p className="font-mono text-[12px] text-white/50">{result.summary}</p>
      ) : null}
    </div>
  );
}
