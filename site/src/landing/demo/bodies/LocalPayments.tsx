"use client";

import type { DemoBodyProps } from "../types";
import { PrimaryButton, bodyAnimation } from "./shared";

/** Preset deposit amounts (USD), surfaced as selectable chips in the body. */
export const DEPOSIT_AMOUNTS = [
  { id: "10", label: "$10" },
  { id: "50", label: "$50" },
  { id: "100", label: "$100" },
  { id: "500", label: "$500" },
] as const;

export type DepositAmountId = (typeof DEPOSIT_AMOUNTS)[number]["id"];

export function LocalPaymentsBody({
  status,
  result,
  onAction,
  delay,
  connectedBalance,
  selectedAmountId,
  onSelectAmount,
  methodLabel,
}: DemoBodyProps & {
  selectedAmountId: DepositAmountId;
  onSelectAmount: (id: DepositAmountId) => void;
  methodLabel: string;
}) {
  const selected =
    DEPOSIT_AMOUNTS.find((a) => a.id === selectedAmountId) ??
    DEPOSIT_AMOUNTS[0];

  const buttonLabel =
    status === "running"
      ? "Opening deposit…"
      : status === "done"
        ? "Funds received"
        : `Add ${selected.label} with ${methodLabel}`;

  return (
    <div
      className="flex w-full max-w-[420px] flex-col gap-5 bg-[#181818] p-6"
      style={bodyAnimation(delay)}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-white/50">Available balance</p>
        <p className="font-mono text-[28px] tabular-nums text-white">
          {connectedBalance ?? "$0.00"}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-white/50">Amount</p>
        <div className="grid grid-cols-4 gap-1.5">
          {DEPOSIT_AMOUNTS.map((a) => {
            const active = a.id === selectedAmountId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelectAmount(a.id)}
                className="flex items-center justify-center border py-2.5 text-left outline-none transition-colors duration-150"
                style={{
                  borderColor: active ? "#2e2e2e" : "transparent",
                  background: active ? "#262626" : "#1f1f1f",
                }}
              >
                <span
                  className="font-mono text-[14px] tabular-nums"
                  style={{
                    color: active ? "#ffffff" : "rgba(255,255,255,0.5)",
                  }}
                >
                  {a.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <PrimaryButton
        label={buttonLabel}
        status={status}
        onClick={() => onAction(selected.id)}
        className="h-11 w-full"
      />
      {result?.summary ? (
        <p className="font-mono text-[12px] text-white/50">{result.summary}</p>
      ) : null}
    </div>
  );
}
