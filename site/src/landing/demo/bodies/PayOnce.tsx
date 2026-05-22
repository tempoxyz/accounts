"use client";

import type { DemoBodyProps } from "../types";
import { FundingOverlay, PrimaryButton, useBodyAnimation } from "./shared";

export function PayOnceBody(props: DemoBodyProps) {
  const { status, result, onAction, delay } = props;
  const body = useBodyAnimation(delay);
  const done = status === "done";
  const buttonLabel = done ? "Payment sent" : "Complete purchase";

  return (
    <div
      ref={body.ref}
      className="relative flex w-full max-w-[366px] flex-col gap-4 overflow-hidden bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-foreground-muted">Pro Plan</p>
        <p className="font-mono text-[32px] leading-none text-foreground sm:text-[36px]">
          $240
        </p>
      </div>
      <PrimaryButton
        label={buttonLabel}
        status={done ? "idle" : status}
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
          <p className="font-mono text-[10px] text-foreground-subtle">{result.summary}</p>
        )
      ) : null}
      <FundingOverlay {...props} />
    </div>
  );
}
