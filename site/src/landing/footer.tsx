"use client";

import { useEffect, useState } from "react";
import AsciiBackground from "./ascii-bg";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Delays opacity transition by one frame after mount so the canvas inside
 * has time to size + draw its first frame. Without this the wrapper's
 * opacity animation runs against an empty canvas, then dots snap in
 * mid-fade — looks like an instant pop instead of a smooth reveal.
 */
function FadeInOnMount({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShown(true), 30);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        opacity: shown ? 1 : 0,
        transition: "opacity 420ms cubic-bezier(0.23, 1, 0.32, 1)",
      }}
    >
      {children}
    </div>
  );
}

export default function Footer() {
  const [hovered, setHovered] = useState(false);
  return (
    <footer
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative flex items-center justify-center overflow-hidden px-6 py-12 text-[13px] text-white/45 sm:px-9 sm:py-14 sm:text-[14px]"
      style={{ animation: `fadeUp 600ms ${easeOut} 0ms both` }}
    >
      {hovered ? (
        <FadeInOnMount>
          <AsciiBackground />
        </FadeInOnMount>
      ) : null}
      <span
        className="relative z-10"
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
    </footer>
  );
}
