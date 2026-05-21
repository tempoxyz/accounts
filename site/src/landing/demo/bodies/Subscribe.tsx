"use client";

import type { DemoBodyProps } from "../types";
import { PrimaryButton, useBodyAnimation } from "./shared";

export function SubscribeBody({
  status,
  result,
  onAction,
  delay,
}: DemoBodyProps) {
  const body = useBodyAnimation(delay);
  const buttonLabel =
    status === "running"
      ? "Setting up…"
      : status === "done"
        ? "Subscribed"
        : "Subscribe";

  return (
    <div
      ref={body.ref}
      className="flex w-full max-w-[420px] flex-col gap-5 bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-foreground-muted">Pro Plan</p>
        <p className="font-mono text-[28px] tabular-nums text-foreground">
          $24.99<span className="text-foreground-subtle">/mo</span>
        </p>
      </div>

      <p className="text-[12px] text-foreground-muted">
        Cancel anytime · auto-renews · access key authorized once.
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
