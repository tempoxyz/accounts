"use client";

import { useEffect, useState } from "react";
import type { DemoBodyProps } from "../types";
import { PrimaryButton, bodyAnimation } from "./shared";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

export function PayPerUseBody({
  status,
  result,
  onAction,
  delay,
}: DemoBodyProps) {
  const calls = 1247;
  const cap = 5000;
  const pct = Math.min(100, (calls / cap) * 100);

  // Fill from 0 → pct once the card has faded in. Re-arms on remount
  // (e.g. when the user navigates back to this demo).
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setFilled(true), delay + 80);
    return () => clearTimeout(id);
  }, [delay]);

  const buttonLabel =
    status === "running"
      ? "Authorizing…"
      : status === "done"
        ? "Authorized"
        : "Authorize spending";

  return (
    <div
      className="flex w-full max-w-[420px] flex-col gap-5 bg-panel-2 p-6"
      style={bodyAnimation(delay)}
    >
      <div className="flex items-end justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-[13px] text-foreground-muted">API calls today</p>
          <p className="font-mono text-[28px] tabular-nums text-foreground">
            {calls.toLocaleString()}
            <span className="text-foreground-subtle">{" / "}{cap.toLocaleString()}</span>
          </p>
        </div>
        <p className="font-mono text-[12px] text-foreground-muted">$0.012 / call</p>
      </div>

      <div className="h-1 w-full bg-panel-4">
        <div
          className="h-full bg-foreground"
          style={{
            width: `${filled ? pct : 0}%`,
            transition: `width 1100ms ${easeOut}`,
          }}
        />
      </div>

      <p className="text-[13px] text-foreground-muted">
        Settles automatically per call. No prompt after authorization until the
        cap is reached.
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
