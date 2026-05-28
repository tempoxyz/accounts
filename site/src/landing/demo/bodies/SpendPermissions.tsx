"use client";

import { waapi, type WAAPIAnimation } from "animejs";
import { useLayoutEffect, useRef } from "react";
import { springs } from "../../animation";
import type { DemoBodyProps } from "../types";
import {
  PrimaryButton,
  SecondaryButton,
  useBodyAnimation,
} from "./shared";

export function SpendPermissionsBody(props: DemoBodyProps) {
  const { status, result, lastVariant, onAction, delay } = props;
  const used = result?.progressValue ?? 0;
  const cap = result?.progressMax ?? 5;
  const pct = Math.min(100, (used / cap) * 100);
  const body = useBodyAnimation(delay);
  const fillRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef(0);
  const activePermission = result?.permissionState === "active";
  const removedPermission = result?.permissionState === "removed";
  const canSend =
    activePermission &&
    status === "done" &&
    result?.complete === false &&
    used < cap;
  const done = status === "done" && result?.complete !== false;
  const nextPayment = Math.min(used + 1, cap);
  const expiresAt = result?.permissionExpiresAt
    ? new Date(result.permissionExpiresAt * 1000)
    : null;
  const transactions = result?.transactions ?? [];

  useLayoutEffect(() => {
    const el = fillRef.current;
    if (!el) return;

    const previousPct = pctRef.current;
    pctRef.current = pct;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.transform = `scaleX(${pct / 100})`;
      return;
    }

    const animation: WAAPIAnimation = waapi.animate(el, {
      scaleX: [previousPct / 100, pct / 100],
      ease: springs.progress,
    });

    return () => {
      animation.cancel();
    };
  }, [pct]);

  const buttonLabel = (() => {
    if (status === "running")
      return lastVariant?.startsWith("spend") || lastVariant === "again"
        ? "Paying..."
        : "Approving...";
    if (canSend) return "Pay $0.01";
    if (done) return "Limit reached";
    if (removedPermission) return "Approve rule again";
    return "Approve spending rule";
  })();

  return (
    <div
      ref={body.ref}
      className="relative flex w-full max-w-[420px] flex-col gap-5 overflow-hidden bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex items-end justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-[14px] text-foreground-muted">
            Micro-payments
          </p>
          <p className="font-mono text-[28px] tabular-nums text-foreground">
            {used.toLocaleString()}
            <span className="text-foreground-subtle">
              {" / "}
              {cap.toLocaleString()}
            </span>
          </p>
        </div>
        <p className="font-mono text-[12px] text-foreground-muted">$0.01 each</p>
      </div>

      <div className="h-1 w-full overflow-hidden bg-panel-4">
        <div
          ref={fillRef}
          className="h-full w-full origin-left bg-foreground"
          style={{ transform: "scaleX(0)" }}
        />
      </div>

      <p className="text-[14px] text-foreground-muted">
        Set a spending limit once. Matching payments can run in the background
        until the limit or expiry is reached.
      </p>

      {activePermission ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-panel-3 px-3 py-2">
          <p className="text-[12px] text-foreground-muted">Budget</p>
          <p className="text-right text-[12px] text-foreground-muted">
            Remaining
          </p>
          <p className="font-mono text-[12px] text-foreground">
            {result?.permissionLimit ?? "$1.00"}
          </p>
          <p className="text-right font-mono text-[12px] text-foreground">
            {result?.permissionRemaining ?? "$1.00"}
          </p>
          <p className="col-span-2 font-mono text-[12px] text-foreground-muted">
            {result?.permissionSpent
              ? `${result.permissionSpent} used`
              : "$0.00 used"}
            {" · "}
            {expiresAt
              ? `valid until ${expiresAt.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : "valid for 24h"}
          </p>
        </div>
      ) : null}

      <PrimaryButton
        label={buttonLabel}
        status={status === "running" ? "running" : "idle"}
        disabled={done}
        onClick={() => onAction(canSend ? `spend:${nextPayment}` : "authorize")}
        className="h-11 w-full"
      />
      {activePermission ? (
        <SecondaryButton
          label={
            status === "running" && lastVariant === "revoke"
              ? "Removing..."
              : "Revoke rule"
          }
          status={status === "running" ? "running" : "idle"}
          onClick={() => onAction("revoke")}
          className="h-9 w-full"
        />
      ) : null}
      {result?.summary ? (
        <p className="font-mono text-[12px] text-foreground-muted">
          {result.summary}
        </p>
      ) : null}
      {transactions.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-[12px] text-foreground-muted">Transactions</p>
          <div className="flex flex-col gap-1">
            {transactions.map((transaction) => (
              <a
                key={transaction.hash}
                href={transaction.href}
                target="_blank"
                rel="noreferrer"
                className="truncate font-mono text-[12px] text-foreground-subtle outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
              >
                {transaction.label}
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
