import type { DemoBodyProps } from "../types";
import { PrimaryButton, bodyAnimation } from "./shared";

export function SubscribeBody({
  status,
  result,
  onAction,
  delay,
}: DemoBodyProps) {
  const buttonLabel =
    status === "running"
      ? "Setting up…"
      : status === "done"
        ? "Subscribed"
        : "Subscribe";

  return (
    <div
      className="flex w-full max-w-[420px] flex-col gap-5 bg-[#181818] p-6"
      style={bodyAnimation(delay)}
    >
      <div className="flex items-baseline justify-between">
        <div className="flex flex-col">
          <p className="text-[16px] text-white">Pro Plan</p>
          <p className="text-[12px] text-white/50">Monthly</p>
        </div>
        <p className="font-mono text-[28px] tabular-nums text-white">
          $24.99<span className="text-white/40">/mo</span>
        </p>
      </div>

      <p className="text-[12px] text-white/50">
        Cancel anytime · auto-renews · access key authorized once.
      </p>

      <PrimaryButton
        label={buttonLabel}
        status={status}
        onClick={onAction}
        className="h-11 w-full"
      />
      {result?.summary ? (
        <p className="font-mono text-[12px] text-white/50">{result.summary}</p>
      ) : null}
    </div>
  );
}
