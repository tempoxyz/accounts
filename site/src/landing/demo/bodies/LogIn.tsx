"use client";

import type { DemoBodyProps } from "../types";
import { PrimaryButton, useBodyAnimation } from "./shared";

export function LogInBody({
  status,
  result,
  onAction,
  onNextDemo,
  delay,
  adapter,
}: DemoBodyProps) {
  const body = useBodyAnimation(delay);
  const idleCta =
    adapter === "webAuth"
      ? "Continue with passkey"
      : adapter === "privy"
        ? "Continue with Privy"
        : "Continue with Tempo";
  const runningCta =
    adapter === "webAuth"
      ? "Awaiting passkey…"
      : adapter === "privy"
        ? "Opening Privy…"
        : "Opening Tempo…";
  const description =
    adapter === "webAuth"
      ? "Sign in with an on-device passkey — no popup, no third-party host."
      : adapter === "privy"
        ? "Sign in via Privy. The SDK manages access keys after authentication."
        : "Continue with your Tempo wallet — passkeys and access keys handled by the SDK.";

  const ctaLabel = status === "running" ? runningCta : idleCta;

  return (
    <div
      ref={body.ref}
      className="flex w-full max-w-[420px] flex-col gap-5 bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex flex-col gap-1.5">
        <p className="text-[18px] text-foreground">Sign in to your account</p>
        <p className="text-[13px] text-foreground-muted">{description}</p>
      </div>

      {status === "done" && result?.summary ? (
        <>
          <div className="flex items-center gap-2 bg-panel-3 px-3 py-2">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent-live" />
            <p className="truncate font-mono text-[12px] text-foreground-muted">
              {result.summary}
            </p>
          </div>
          <PrimaryButton
            label="Next demo"
            status="idle"
            onClick={onNextDemo}
            className="h-11 w-full"
          />
        </>
      ) : (
        <PrimaryButton
          label={ctaLabel}
          status={status}
          onClick={onAction}
          className="h-11 w-full"
        />
      )}
    </div>
  );
}
