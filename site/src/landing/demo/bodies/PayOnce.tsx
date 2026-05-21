"use client";

import type { DemoBodyProps } from "../types";
import { PrimaryButton, useBodyAnimation } from "./shared";

export function PayOnceBody({
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
        ? "Payment sent"
        : "Complete purchase";

  return (
    <div
      ref={body.ref}
      className="flex w-full max-w-[366px] flex-col gap-4 bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-foreground-muted">Pro Plan</p>
        <p className="font-mono text-[32px] leading-none text-foreground sm:text-[36px]">
          $240
        </p>
      </div>
      <PrimaryButton
        label={buttonLabel}
        status={status}
        onClick={onAction}
        className="mt-2 h-11 w-full"
      />
      {result?.summary ? (
        <p className="font-mono text-[10px] text-foreground-subtle">{result.summary}</p>
      ) : null}
    </div>
  );
}
