import type { DemoBodyProps } from "../types";
import { PrimaryButton, bodyAnimation } from "./shared";

export function LogInBody({
  status,
  result,
  onAction,
  delay,
  adapter,
}: DemoBodyProps) {
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

  const ctaLabel =
    status === "running"
      ? runningCta
      : status === "done"
        ? result?.summary ?? "Signed in"
        : idleCta;

  return (
    <div
      className="flex w-full max-w-[420px] flex-col gap-5 bg-[#181818] p-6"
      style={bodyAnimation(delay)}
    >
      <div className="flex flex-col gap-1.5">
        <p className="text-[18px] text-white">Sign in to your account</p>
        <p className="text-[13px] text-white/50">{description}</p>
      </div>

      <PrimaryButton
        label={ctaLabel}
        status={status}
        onClick={onAction}
        className="h-11 w-full"
      />

      {status === "done" && result?.summary ? (
        <p className="font-mono text-[12px] text-white/50">{result.summary}</p>
      ) : null}
    </div>
  );
}
