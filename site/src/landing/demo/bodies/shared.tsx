"use client";

import { waapi, type WAAPIAnimation } from "animejs";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { springs } from "../../animation";
import type { Status } from "../types";

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
