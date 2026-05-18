"use client";

import type { Status } from "../types";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

export function bodyAnimation(delay: number) {
  return { animation: `fadeUp 540ms ${easeOut} ${delay}ms both` };
}

export function PrimaryButton({
  label,
  status,
  onClick,
  className = "",
}: {
  label: string;
  status: Status;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "running"}
      className={`flex h-10 items-center justify-center gap-2 bg-cta px-4 outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:opacity-80 ${className}`}
    >
      {status === "running" ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-cta-fg"
          style={{ animation: "pulseDot 900ms ease-in-out infinite" }}
        />
      ) : null}
      <span className="text-[14px] text-cta-fg">{label}</span>
    </button>
  );
}

export function SecondaryButton({
  label,
  onClick,
  className = "",
  status,
  prefix,
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  status?: Status;
  prefix?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "running"}
      className={`flex h-10 items-center justify-center gap-2 bg-panel-3 px-4 outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:opacity-80 ${className}`}
    >
      {prefix}
      <span className="text-[14px] text-foreground">{label}</span>
    </button>
  );
}

export function StatusLabel({
  status,
  defaultLabel,
  runningLabel,
  doneLabel,
}: {
  status: Status;
  defaultLabel: string;
  runningLabel: string;
  doneLabel: string;
}) {
  if (status === "running") return <>{runningLabel}</>;
  if (status === "done") return <>{doneLabel}</>;
  return <>{defaultLabel}</>;
}
