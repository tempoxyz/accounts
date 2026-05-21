"use client";

import { Suspense, lazy, useEffect, useRef, useState } from "react";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";
const REVEAL_EDGE_PX = 8;

const DinoGame = lazy(() =>
  import("./dino-game").then((module) => ({ default: module.DinoGame })),
);

function GameLoading() {
  return (
    <div className="flex h-[280px] w-full items-center justify-center font-mono text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">
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
      className="group relative flex items-center justify-center overflow-hidden py-12 text-[13px] text-foreground-subtle sm:py-14 sm:text-[14px]"
      style={{ animation: `fadeUp 600ms ${easeOut} 0ms both` }}
    >
      {!revealed ? (
        <div
          aria-hidden
          className="fixed inset-x-0 bottom-0 z-50 cursor-default"
          style={{ height: REVEAL_EDGE_PX }}
          onPointerEnter={() => setRevealed(true)}
          onPointerDown={() => setRevealed(true)}
        />
      ) : null}
      {revealed ? (
        <div
          className="relative w-full"
          style={{ animation: `slideDown 480ms ${easeOut} 0ms both` }}
        >
          <Suspense fallback={<GameLoading />}>
            <DinoGame />
          </Suspense>
          <div className="mt-4 flex items-center justify-center gap-5 px-6 text-[11px] text-foreground-subtle sm:px-9">
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border-strong bg-foreground/[0.05] px-1.5 font-mono text-[10px] leading-none text-foreground-muted">
                space
              </kbd>
              jump
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border-strong bg-foreground/[0.05] px-1.5 font-mono text-[10px] leading-none text-foreground-muted">
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
            className="absolute top-3 left-6 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-border bg-foreground/[0.04] font-mono text-[14px] leading-none text-foreground-muted backdrop-blur-sm transition-[background-color,border-color,color] duration-150 hover:border-border-strong hover:bg-foreground/[0.08] hover:text-foreground sm:left-9"
          >
            ×
          </button>
        </div>
      ) : (
        <span
          className="relative z-10 px-6 sm:px-9"
          style={{
            textShadow:
              "0 0 12px var(--footer-glow), 0 0 24px var(--footer-glow)",
          }}
        >
          Powered by{" "}
          <a
            href="https://tempo.xyz"
            target="_blank"
            rel="noreferrer"
            className="text-foreground-muted underline-offset-4 transition-[background-color,border-color,color] duration-150 hover:text-foreground hover:underline"
          >
            Tempo
          </a>
        </span>
      )}
    </footer>
  );
}
