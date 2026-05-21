"use client";

import type { DemoBodyProps } from "../types";
import { PrimaryButton, useBodyAnimation } from "./shared";

export function OnRampBody({
  status,
  result,
  onAction,
  delay,
  connectedBalance,
}: DemoBodyProps) {
  const body = useBodyAnimation(delay);
  const buttonLabel =
    status === "running"
      ? "Opening deposit…"
      : status === "done"
        ? "Funds received"
        : "Deposit funds";

  return (
    <div
      ref={body.ref}
      className="flex w-full max-w-[420px] flex-col gap-4 bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-foreground-muted">Available balance</p>
        <p className="font-mono text-[28px] tabular-nums text-foreground">
          {connectedBalance ?? "$0.00"}
        </p>
      </div>
      <p className="text-[13px] text-foreground-muted">
        The wallet renders the full deposit UI (cards, Apple Pay, crypto, X
        verification) — your app just calls{" "}
        <span className="font-mono text-foreground">wallet_deposit</span>.
      </p>
      <PrimaryButton
        label={buttonLabel}
        status={status}
        onClick={onAction}
        className="h-11 w-full"
      />
      {result?.summary ? (
        <p className="font-mono text-[12px] text-foreground-muted">{result.summary}</p>
      ) : null}
    </div>
  );
}
