"use client";

import type { DemoBodyProps } from "../types";
import { shorten } from "../sdk";
import { PrimaryButton, bodyAnimation } from "./shared";

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
  const dest = DESTINATIONS.find((d) => d.id === selectedId) ?? DESTINATIONS[0];

  const buttonLabel =
    status === "running"
      ? "Sending…"
      : status === "done"
        ? "Sent"
        : `Send $0.01 to ${dest.label}`;

  return (
    <div
      className="flex w-full max-w-[420px] flex-col gap-4 bg-[#181818] p-6"
      style={bodyAnimation(delay)}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-white/50">Available balance</p>
        <p className="font-mono text-[28px] tabular-nums text-white">
          {connectedBalance ?? "$0.00"}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-white/50">Saved recipients</p>
        <div className="flex flex-col gap-1.5">
          {DESTINATIONS.map((d) => {
            const active = d.id === selectedId;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onSelect(d.id)}
                className="flex items-center justify-between gap-3 border px-3 py-2.5 text-left outline-none transition-colors duration-150"
                style={{
                  borderColor: active ? "#2e2e2e" : "transparent",
                  background: active ? "#262626" : "#1f1f1f",
                }}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] text-white">{d.label}</span>
                  <span className="font-mono text-[11px] text-white/40">
                    {shorten(d.address)}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-white/50">
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
        <p className="font-mono text-[12px] text-white/50">{result.summary}</p>
      ) : null}
    </div>
  );
}
