"use client";

import { waapi, type WAAPIAnimation } from "animejs";
import { useLayoutEffect, useRef } from "react";
import { springs } from "../../animation";
import type { DemoBodyProps } from "../types";
import { PrimaryButton, useBodyAnimation } from "./shared";

const BAR_DELAY_MS = 240;

export function PayPerUseBody({
  status,
  result,
  onAction,
  delay,
}: DemoBodyProps) {
  const calls = 1247;
  const cap = 5000;
  const pct = Math.min(100, (calls / cap) * 100);
  const body = useBodyAnimation(delay);
  const fillRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = fillRef.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.transform = `scaleX(${pct / 100})`;
      return;
    }

    const animation: WAAPIAnimation = waapi.animate(el, {
      scaleX: [0, pct / 100],
      delay: delay + BAR_DELAY_MS,
      ease: springs.progress,
    });

    return () => {
      animation.cancel();
    };
  }, [delay, pct]);

  const buttonLabel =
    status === "running"
      ? "Authorizing…"
      : status === "done"
        ? "Authorized"
        : "Authorize spending";

  return (
    <div
      ref={body.ref}
      className="flex w-full max-w-[420px] flex-col gap-5 bg-panel-2 p-6"
      style={body.style}
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

      <div className="h-1 w-full overflow-hidden bg-panel-4">
        <div
          ref={fillRef}
          className="h-full w-full origin-left bg-foreground"
          style={{ transform: "scaleX(0)" }}
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
