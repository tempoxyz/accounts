"use client";

import type { ReactNode } from "react";
import AsciiBackground from "../ascii-bg";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

export function SectionFrame({
  title,
  subheading,
  left,
  right,
}: {
  title: string;
  subheading: ReactNode;
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <section className="relative px-6 pt-20 pb-0 sm:pt-[80px]">
      <div className="flex flex-col items-center gap-3 text-center">
        <h2
          className="text-[32px] leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[48px]"
          style={{ animation: `fadeUp 600ms ${easeOut} 0ms both` }}
        >
          {title}
        </h2>
        <p
          className="max-w-[620px] text-[16px] text-foreground-muted sm:text-[20px]"
          style={{ animation: `fadeUp 600ms ${easeOut} 80ms both` }}
        >
          {subheading}
        </p>
      </div>
      <div
        className="-mx-6 mt-8 grid grid-cols-1 sm:mt-12 lg:grid-cols-[1fr_626px]"
        style={{ animation: `fadeUp 700ms ${easeOut} 120ms both` }}
      >
        <div className="flex flex-col gap-10 bg-panel-0 px-9 py-[26px] lg:min-h-[540px]">
          {left}
        </div>
        <div className="dash-l relative flex items-center justify-center overflow-hidden bg-background px-6 py-12 lg:min-h-[540px]">
          <AsciiBackground />
          <div className="relative z-10 w-full max-w-[420px]">{right}</div>
        </div>
      </div>
    </section>
  );
}
