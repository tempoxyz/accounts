"use client";

import { waapi, type WAAPIAnimation } from "animejs";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { springs } from "../../animation";
import type { SetupStatus, Status } from "../types";

const bodyInitialStyle = {
  opacity: 0,
  translate: "0 12px",
  transformOrigin: "top left",
  willChange: "opacity, translate",
} satisfies CSSProperties;

export function useBodyAnimation(delay: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    setReady(false);
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReady(true);
      return;
    }

    let disposed = false;
    const animation: WAAPIAnimation = waapi.animate(el, {
      opacity: [0, 1],
      translate: ["0 12px", "0 0"],
      delay,
      ease: springs.entrance,
    });

    void animation.then(() => {
      if (disposed) return;
      setReady(true);
    });

    return () => {
      disposed = true;
      animation.cancel();
    };
  }, [delay]);

  return {
    ref,
    style: ready ? undefined : bodyInitialStyle,
  };
}

export function PrimaryButton({
  label,
  status,
  onClick,
  className = "",
  disabled = false,
}: {
  label: string;
  status: Status;
  onClick: () => void;
  className?: string;
  disabled?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={status === "running" || disabled}
      className={`flex h-10 items-center justify-center gap-2 bg-accent px-4 outline-none enabled:hover:bg-accent-hover enabled:active:bg-accent-active focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-80 ${className}`}
    >
      {status === "running" ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-on-accent"
          style={{ animation: "pulseDot 900ms ease-in-out infinite" }}
        />
      ) : null}
      <span className="text-[14px] text-on-accent">{label}</span>
    </button>
  );
}

export function FundingOverlay({
  connectedBalance,
  needsFunding,
  onSetupConnect,
  onSetupFund,
  setupError,
  setupStatus,
}: {
  connectedBalance: string | null;
  needsFunding: boolean;
  onSetupConnect: () => void;
  onSetupFund: () => void;
  setupError: string | null;
  setupStatus: SetupStatus;
}) {
  if (!needsFunding) return null;

  const busy = setupStatus !== "idle";
  const connected = connectedBalance !== null;
  const connectLabel = setupStatus === "connecting" ? "Connecting…" : "Connect";
  const fundLabel = setupStatus === "funding" ? "Requesting…" : "Request funds";

  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-center gap-4 bg-panel-2/95 p-6 backdrop-blur-sm">
      <div className="flex flex-col gap-1">
        <p className="text-[16px] text-foreground">Add funds to continue</p>
        <p className="text-[13px] text-foreground-muted">
          {connected
            ? `Current balance is ${connectedBalance}.`
            : "Connect, then request faucet funds to try this demo."}
        </p>
        {setupError ? (
          <p className="text-[12px] text-danger">{setupError}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {connected ? (
          <button
            type="button"
            onClick={onSetupFund}
            disabled={busy}
            className="h-8 bg-accent px-2.5 font-mono text-[11px] text-on-accent outline-none enabled:hover:bg-accent-hover enabled:active:bg-accent-active focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-80"
          >
            {fundLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onSetupConnect}
            disabled={busy}
            className="h-8 bg-accent px-2.5 font-mono text-[11px] text-on-accent outline-none enabled:hover:bg-accent-hover enabled:active:bg-accent-active focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-80"
          >
            {connectLabel}
          </button>
        )}
      </div>
    </div>
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
      className={`flex h-10 items-center justify-center gap-2 bg-secondary px-4 outline-none hover:bg-secondary-hover active:bg-secondary-active focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 disabled:opacity-80 ${className}`}
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
