"use client";

import type { DemoBodyProps } from "../types";
import { PrimaryButton, useBodyAnimation } from "./shared";

export function PayOnceBody(props: DemoBodyProps) {
  const { status, result, onAction, delay } = props;
  const body = useBodyAnimation(delay);
  const done = status === "done";
  const buttonLabel = done ? "Transfer sent" : "Send transfer";

  return (
    <div
      ref={body.ref}
      className="relative flex w-full max-w-[366px] flex-col gap-4 overflow-hidden bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[14px] text-foreground-muted">Transfer</p>
        <p className="font-mono text-[36px] leading-none text-foreground">
          $240
        </p>
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between bg-panel-3 px-4 py-3">
          <span className="text-[12px] text-foreground-muted">Recipient</span>
          <span className="font-mono text-[12px] text-foreground">
            Main account
          </span>
        </div>
        <div className="flex items-center justify-between bg-panel-3 px-4 py-3">
          <span className="text-[12px] text-foreground-muted">Memo</span>
          <span className="font-mono text-[12px] text-foreground">
            Monthly transfer
          </span>
        </div>
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
          <p className="font-mono text-[12px] text-foreground-subtle">{result.summary}</p>
        )
      ) : null}
    </div>
  );
}
