"use client";

import { useEffect, useRef, useState } from "react";
import { DinoGame } from "./dino-game";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

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
      onMouseEnter={() => setRevealed(true)}
      className="group relative flex items-center justify-center overflow-hidden py-12 text-[13px] text-white/45 sm:py-14 sm:text-[14px]"
      style={{ animation: `fadeUp 600ms ${easeOut} 0ms both` }}
    >
      {revealed ? (
        <div
          className="relative w-full"
          style={{ animation: `slideDown 480ms ${easeOut} 0ms both` }}
        >
          <DinoGame />
          <div className="mt-4 flex items-center justify-center gap-5 px-6 text-[11px] text-white/45 sm:px-9">
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-white/15 bg-white/[0.05] px-1.5 font-mono text-[10px] leading-none text-white/70">
                space
              </kbd>
              jump
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-white/15 bg-white/[0.05] px-1.5 font-mono text-[10px] leading-none text-white/70">
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
            className="absolute top-3 left-6 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] font-mono text-[14px] leading-none text-white/55 backdrop-blur-sm transition-colors duration-150 hover:border-white/25 hover:bg-white/[0.08] hover:text-white sm:left-9"
          >
            ×
          </button>
        </div>
      ) : (
        <span
          className="relative z-10 px-6 sm:px-9"
          style={{
            textShadow:
              "0 0 12px rgba(0, 0, 0, 0.85), 0 0 24px rgba(0, 0, 0, 0.6)",
          }}
        >
          Powered by{" "}
          <a
            href="https://tempo.xyz"
            target="_blank"
            rel="noreferrer"
            className="text-white/70 underline-offset-4 transition-colors duration-150 hover:text-white hover:underline"
          >
            Tempo
          </a>
        </span>
      )}
    </footer>
  );
}
