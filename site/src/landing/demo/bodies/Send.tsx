"use client";

import type { DemoBodyProps } from "../types";
import { shorten } from "../sdk";
import { PrimaryButton, useBodyAnimation } from "./shared";

/**
 * Curated, display-only destinations. The actual on-chain `wallet_send`
 * routes to the user's own address (self-transfer) so the demo signs a
 * real mainnet tx without sending funds to a stranger. The recipient
 * label + memo are storytelling for the body.
 */
export const DESTINATIONS = [
  {
    id: "coffee",
    label: "Coffee Cart",
    address: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEbb",
    memo: "Latte",
  },
  {
    id: "alex",
    label: "Gavin Belson",
    address: "0x9c12Cf3F40d8b07816e7dDA3b18BcDbF6E0B6271",
    memo: "Hooli sub",
  },
  {
    id: "invoice",
    label: "Pearson Spectre",
    address: "0x4dCe5DD53d65d12C09D6f7c1Dc9B0d7C2b15A7B0",
    memo: "Invoice #482",
  },
] as const;

export type DestinationId = (typeof DESTINATIONS)[number]["id"];

export function SendBody({
  status,
  result,
  onAction,
  delay,
  connectedBalance,
  selectedId,
  onSelect,
}: DemoBodyProps & {
  selectedId: DestinationId;
  onSelect: (id: DestinationId) => void;
}) {
  const body = useBodyAnimation(delay);
  const dest = DESTINATIONS.find((d) => d.id === selectedId) ?? DESTINATIONS[0];

  const buttonLabel =
    status === "running"
      ? "Sending…"
      : status === "done"
        ? "Sent"
        : `Send $0.01 to ${dest.label}`;

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

      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-foreground-muted">Saved recipients</p>
        <div className="flex flex-col gap-1.5">
          {DESTINATIONS.map((d) => {
            const active = d.id === selectedId;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onSelect(d.id)}
                className={`flex items-center justify-between gap-3 border px-3 py-2.5 text-left outline-none hover:bg-secondary-hover active:bg-secondary-active focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 ${active ? "border-panel-edge bg-secondary-hover" : "border-transparent bg-secondary"}`}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] text-foreground">{d.label}</span>
                  <span className="font-mono text-[11px] text-foreground-subtle">
                    {shorten(d.address)}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-foreground-muted">
                  {d.memo}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <PrimaryButton
        label={buttonLabel}
        status={status}
        onClick={() => onAction(dest.id)}
        className="h-11 w-full"
      />
      {result?.summary ? (
        <p className="font-mono text-[12px] text-foreground-muted">{result.summary}</p>
      ) : null}
    </div>
  );
}
