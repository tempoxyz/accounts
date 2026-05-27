"use client";

import type { DemoBodyProps } from "../types";
import { PrimaryButton, useBodyAnimation } from "./shared";

export function LogInBody({
  status,
  result,
  onAction,
  onDisconnect,
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
  const description =
    adapter === "webAuth"
      ? "Sign in with an on-device passkey — no popup, no third-party host."
      : adapter === "privy"
        ? "Sign in via Privy. The SDK manages access keys after authentication."
        : "Continue with your Tempo wallet — passkeys and access keys handled by the SDK.";

  const connected = status === "done" && Boolean(result?.summary);
  const accountLabel = connected ? result?.summary : "Not connected";

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

      <div className="flex min-h-8 items-center gap-2 bg-panel-3 px-3 py-2">
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${connected ? "bg-accent-live" : "bg-foreground-subtle"}`}
        />
        <p className="truncate font-mono text-[12px] text-foreground-muted">
          {accountLabel}
        </p>
      </div>

      {connected ? (
        <button
          type="button"
          onClick={onDisconnect}
          disabled={!onDisconnect}
          className="flex h-11 w-full items-center justify-center bg-panel-3 px-4 text-[14px] text-foreground-muted outline-none active:bg-surface-active focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
        >
          Log out
        </button>
      ) : (
        <PrimaryButton
          label={idleCta}
          status="idle"
          onClick={onAction}
          className="h-11 w-full"
        />
      )}
    </div>
  );
}
