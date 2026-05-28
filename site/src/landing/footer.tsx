"use client";

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { PlayMark } from "./icons";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

const DinoGame = lazy(() =>
  import("./dino-game").then((module) => ({ default: module.DinoGame })),
);

function GameLoading() {
  return (
    <div className="flex h-[280px] w-full items-center justify-center font-mono text-[12px] uppercase tracking-[0.18em] text-foreground-subtle">
      Loading game
    </div>
  );
}

export default function Footer() {
  const [revealed, setRevealed] = useState(false);
  const footerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!revealed || !footerRef.current) return;
    const id = window.requestAnimationFrame(() => {
      footerRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [revealed]);

  return (
    <footer
      ref={footerRef}
      className="group relative flex items-center justify-center overflow-hidden py-12 text-[14px] text-foreground-subtle sm:py-14"
      style={{ animation: `fadeUp 600ms ${easeOut} 0ms both` }}
    >
      {revealed ? (
        <div
          className="relative w-full"
          style={{ animation: `slideDown 480ms ${easeOut} 0ms both` }}
        >
          <Suspense fallback={<GameLoading />}>
            <DinoGame />
          </Suspense>
          <div className="mt-4 flex items-center justify-center gap-5 px-6 text-[12px] text-foreground-subtle sm:px-9">
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border-strong bg-foreground/[0.05] px-1.5 font-mono text-[12px] leading-none text-foreground-muted">
                space
              </kbd>
              jump
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border-strong bg-foreground/[0.05] px-1.5 font-mono text-[12px] leading-none text-foreground-muted">
                ↓
              </kbd>
              duck
            </span>
          </div>
          <button
            type="button"
            aria-label="Close game"
            onClick={(e) => {
              e.stopPropagation();
              setRevealed(false);
            }}
            className="absolute top-3 left-6 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-border bg-foreground/[0.04] font-mono text-[16px] leading-none text-foreground-muted backdrop-blur-sm transition-[background-color,border-color,color] duration-150 hover:border-border-strong hover:bg-foreground/[0.08] hover:text-foreground sm:left-9"
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-label="Open game"
          onClick={() => setRevealed(true)}
          className="relative z-10 px-6 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[opacity,transform] hover:opacity-80 active:translate-y-px sm:px-9"
          style={{
            filter:
              "drop-shadow(0 0 12px var(--footer-glow)) drop-shadow(0 0 24px var(--footer-glow))",
          }}
        >
          <PlayMark className="h-8 w-auto" />
        </button>
      )}
    </footer>
  );
}
