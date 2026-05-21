"use client";

import type { DemoBodyProps } from "../types";
import { useBodyAnimation } from "./shared";

export function FeeSponsorshipBody({ delay }: DemoBodyProps) {
  const body = useBodyAnimation(delay);

  return (
    <div
      ref={body.ref}
      className="flex w-full max-w-[420px] flex-col gap-4 bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-[13px] text-foreground-muted">Sponsored Transfer</p>
          <p className="font-mono text-[28px] leading-none text-foreground">
            $2.00
          </p>
        </div>
        <span className="bg-panel-4 px-2 py-1 font-mono text-[11px] text-foreground-muted">
          approved
        </span>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between bg-panel-3 px-4 py-3">
          <span className="text-[12px] text-foreground-muted">User signs</span>
          <span className="font-mono text-[12px] text-foreground">transfer</span>
        </div>
        <div className="flex items-center justify-between bg-panel-3 px-4 py-3">
          <span className="text-[12px] text-foreground-muted">App covers</span>
          <span className="font-mono text-[12px] text-foreground">network fee</span>
        </div>
      </div>
    </div>
  );
}
