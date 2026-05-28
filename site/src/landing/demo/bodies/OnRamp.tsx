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

  return (
    <div
      ref={body.ref}
      className="flex w-full max-w-[420px] flex-col gap-4 bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[14px] text-foreground-muted">Available balance</p>
        <p className="font-mono text-[28px] tabular-nums text-foreground">
          {connectedBalance ?? "$0.00"}
        </p>
      </div>
      <p className="text-[14px] text-foreground-muted">
        Open the wallet deposit flow with cards, Apple Pay, crypto, and X
        verification.
      </p>
      <PrimaryButton
        label="Add funds"
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
