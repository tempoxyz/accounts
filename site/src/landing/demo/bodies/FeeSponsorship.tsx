"use client";

import { shorten } from "../sdk";
import type { DemoBodyProps } from "../types";
import { PrimaryButton, useBodyAnimation } from "./shared";

export function FeeSponsorshipBody(props: DemoBodyProps) {
  const { delay, onAction, result, status } = props;
  const body = useBodyAnimation(delay);
  const done = status === "done";
  const buttonLabel =
    status === "running"
      ? "Sending..."
      : done
        ? "Sponsored transfer sent"
        : "Send without fees";

  return (
    <div
      ref={body.ref}
      className="relative flex w-full max-w-[420px] flex-col gap-4 overflow-hidden bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-[14px] text-foreground-muted">No-fee transfer</p>
          <p className="font-mono text-[28px] leading-none text-foreground">
            $1.00
          </p>
        </div>
        <span className="bg-panel-4 px-2 py-1 font-mono text-[12px] text-foreground-muted">
          {done ? "sponsored" : "approved"}
        </span>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between bg-panel-3 px-4 py-3">
          <span className="text-[12px] text-foreground-muted">You send</span>
          <span className="font-mono text-[12px] text-foreground">$1.00</span>
        </div>
        <div className="flex items-center justify-between bg-panel-3 px-4 py-3">
          <span className="text-[12px] text-foreground-muted">Wisselbank covers</span>
          <span className="font-mono text-[12px] text-foreground">
            {result?.sponsoredFee ?? "network fee"}
          </span>
        </div>
        {result?.feePayer ? (
          <div className="flex items-center justify-between bg-panel-3 px-4 py-3">
            <span className="text-[12px] text-foreground-muted">Fee payer</span>
            <span
              className="font-mono text-[12px] text-foreground"
              title={result.feePayer}
            >
              {shorten(result.feePayer)}
            </span>
          </div>
        ) : null}
      </div>
      <PrimaryButton
        label={buttonLabel}
        status={status === "running" ? "running" : "idle"}
        disabled={done}
        onClick={onAction}
        className="h-11 w-full"
      />
      {result?.summary ? (
        result.href && result.hrefLabel ? (
          <p className="font-mono text-[12px] text-foreground-subtle">
            {result.summary}{" "}
            <a
              href={result.href}
              target="_blank"
              rel="noreferrer"
              className="outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
            >
              {result.hrefLabel}
            </a>
          </p>
        ) : (
          <p className="font-mono text-[12px] text-foreground-subtle">
            {result.summary}
          </p>
        )
      ) : null}
    </div>
  );
}
