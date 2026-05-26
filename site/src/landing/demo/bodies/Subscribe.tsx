"use client";

import { useEffect, useState } from "react";
import { shorten } from "../sdk";
import type { DemoBodyProps } from "../types";
import { FundingOverlay, PrimaryButton, useBodyAnimation } from "./shared";

export function SubscribeBody(props: DemoBodyProps) {
  const { status, result, onAction, lastVariant, delay } = props;
  const body = useBodyAnimation(delay);
  const [now, setNow] = useState(() => Date.now());
  const subscriptionId = result?.subscriptionId;
  const receipts = result?.subscriptionReceipts ?? [];
  const collected = result?.subscriptionState === "collected";
  const nextCollectAt = result?.subscriptionNextCollectAt;
  const secondsUntilCollect =
    nextCollectAt === undefined
      ? undefined
      : Math.max(0, Math.ceil((nextCollectAt - now) / 1000));
  const waiting =
    Boolean(subscriptionId) &&
    !collected &&
    secondsUntilCollect !== undefined &&
    secondsUntilCollect > 0;
  const canCollect = Boolean(subscriptionId) && !collected && !waiting;
  const buttonLabel = (() => {
    if (status === "running")
      return lastVariant === "collect" ? "Collecting…" : "Subscribing…";
    if (collected) return "Renewal collected";
    if (waiting) return `Collect renewal in ${secondsUntilCollect}s`;
    if (canCollect) return "Collect renewal";
    return "Subscribe";
  })();

  useEffect(() => {
    if (!subscriptionId || collected) return;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [collected, subscriptionId]);

  return (
    <div
      ref={body.ref}
      className="relative flex w-full max-w-[420px] flex-col gap-5 overflow-hidden bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-foreground-muted">Pro Plan</p>
        <p className="font-mono text-[28px] tabular-nums text-foreground">
          $0.01<span className="text-foreground-subtle">/10s</span>
        </p>
      </div>

      <p className="text-[12px] text-foreground-muted">
        The server gates access with an MPP subscription and collects the next
        period from the approved plan.
      </p>

      {subscriptionId ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-panel-3 px-3 py-2">
          <p className="text-[11px] text-foreground-muted">Subscription</p>
          <p className="text-right text-[11px] text-foreground-muted">
            Next collection
          </p>
          <p className="truncate font-mono text-[12px] text-foreground">
            {shorten(subscriptionId)}
          </p>
          <p className="text-right font-mono text-[12px] text-foreground">
            {collected
              ? "Collected"
              : secondsUntilCollect === undefined
                ? "Pending"
                : secondsUntilCollect > 0
                  ? `${secondsUntilCollect}s`
                  : "Due"}
          </p>
        </div>
      ) : null}

      <PrimaryButton
        label={buttonLabel}
        status={status === "running" ? "running" : "idle"}
        disabled={collected || waiting}
        onClick={() => onAction(subscriptionId ? "collect" : "subscribe")}
        className="h-11 w-full"
      />
      {result?.summary ? (
        <p className="font-mono text-[12px] text-foreground-muted">{result.summary}</p>
      ) : null}
      {receipts.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-foreground-muted">Receipts</p>
          <div className="flex flex-col gap-1">
            {receipts.map((receipt) =>
              receipt.href ? (
                <a
                  key={`${receipt.label}-${receipt.reference}`}
                  href={receipt.href}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-mono text-[11px] text-foreground-subtle outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
                >
                  {receipt.label}
                </a>
              ) : (
                <span
                  key={`${receipt.label}-${receipt.reference}`}
                  className="truncate font-mono text-[11px] text-foreground-subtle"
                >
                  {receipt.label}
                </span>
              ),
            )}
          </div>
        </div>
      ) : null}
      <FundingOverlay {...props} />
    </div>
  );
}
