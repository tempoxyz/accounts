"use client";

import type { DemoBodyProps } from "../types";
import { PrimaryButton, useBodyAnimation } from "./shared";

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
  const body = useBodyAnimation(delay);
  const selected =
    DEPOSIT_AMOUNTS.find((a) => a.id === selectedAmountId) ??
    DEPOSIT_AMOUNTS[0];

  const buttonLabel = `Add ${selected.label} with ${methodLabel}`;

  return (
    <div
      ref={body.ref}
      className="flex w-full max-w-[420px] flex-col gap-5 bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-foreground-muted">Available balance</p>
        <p className="font-mono text-[28px] tabular-nums text-foreground">
          {connectedBalance ?? "$0.00"}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-foreground-muted">Amount</p>
        <div className="grid grid-cols-4 gap-1.5">
          {DEPOSIT_AMOUNTS.map((a) => {
            const active = a.id === selectedAmountId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelectAmount(a.id)}
                className={`relative flex items-center justify-center border py-2.5 text-left outline-none hover:bg-secondary-hover active:bg-secondary-active focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 ${active ? "border-panel-edge bg-secondary-hover" : "border-transparent bg-secondary"}`}
              >
                <span
                  className={`font-mono text-[14px] tabular-nums ${active ? "text-foreground" : "text-foreground-muted"}`}
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
        <p className="font-mono text-[12px] text-foreground-muted">{result.summary}</p>
      ) : null}
    </div>
  );
}
