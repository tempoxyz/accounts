"use client";

import type { DemoBodyProps } from "../types";
import { FundingOverlay, PrimaryButton, useBodyAnimation } from "./shared";

function SwapArrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M5 2v10M5 12L2 9M5 12l3-3M11 14V4M11 4l-3 3M11 4l3 3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TokenRow({
  label,
  amount,
  token,
}: {
  label: string;
  amount: string;
  token: string;
}) {
  return (
    <div className="flex flex-col gap-2 bg-panel-3 px-4 py-3 sm:px-5 sm:py-4">
      <p className="text-[12px] text-foreground-muted">{label}</p>
      <div className="flex items-baseline justify-between gap-2.5">
        <p className="font-mono text-[20px] leading-none tabular-nums text-foreground sm:text-[24px]">
          {amount}
        </p>
        <span className="bg-panel-4 px-2 py-0.5 font-mono text-[11px] tracking-wide text-foreground-muted">
          {token}
        </span>
      </div>
    </div>
  );
}

export function TradeBody(props: DemoBodyProps) {
  const { status, result, onAction, delay } = props;
  const body = useBodyAnimation(delay);
  const done = status === "done";
  const buttonLabel =
    status === "running"
      ? "Reviewing…"
      : done
        ? "Exchange submitted"
        : "Exchange $1.00";

  return (
    <div
      ref={body.ref}
      className="relative flex w-full max-w-[420px] flex-col gap-3 overflow-hidden bg-panel-2 p-6"
      style={body.style}
    >
      <TokenRow label="From" amount="1.00" token="pathUSD" />
      <div className="flex items-center justify-center py-2 text-foreground-muted">
        <SwapArrow />
      </div>
      <TokenRow label="Receive" amount="1.00" token="alphaUSD" />

      <div className="grid gap-2">
        <div className="flex items-center justify-between bg-panel-3 px-4 py-3">
          <span className="text-[12px] text-foreground-muted">Route</span>
          <span className="font-mono text-[12px] text-foreground">
            Stablecoin DEX
          </span>
        </div>
        <div className="flex items-center justify-between bg-panel-3 px-4 py-3">
          <span className="text-[12px] text-foreground-muted">Max slippage</span>
          <span className="font-mono text-[12px] text-foreground">0.5%</span>
        </div>
      </div>

      <PrimaryButton
        label={buttonLabel}
        status={status === "running" ? "running" : "idle"}
        disabled={done}
        onClick={onAction}
        className="mt-2 h-11 w-full"
      />
      {result?.summary ? (
        result.href && result.hrefLabel ? (
          <p className="font-mono text-[10px] text-foreground-subtle">
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
          <p className="font-mono text-[10px] text-foreground-subtle">
            {result.summary}
          </p>
        )
      ) : null}
      <FundingOverlay {...props} />
    </div>
  );
}
