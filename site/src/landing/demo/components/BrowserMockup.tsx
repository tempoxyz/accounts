"use client";

import { useMemo, useState } from "react";
import type {
  Adapter,
  DemoDef,
  DemoKind,
  DemoResult,
  Status,
} from "../types";
import { shorten } from "../sdk";
import { ChatBubble } from "./ChatBubble";

const DEMO_STEPS: readonly DemoKind[] = [
  "Log In",
  "Onramp",
  "Pay Once",
  "Pay Per Use",
  "Subscribe",
  "FX Trade",
];

function ChevronRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M5 3L9 7L5 11"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      className="shrink-0 transition-transform duration-200 ease-out"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
    >
      <path
        d="M3 5L7 9L11 5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type ConnectedSession = {
  address: `0x${string}`;
  balanceDisplay: string;
};

export function BrowserMockup({
  demo,
  def,
  status,
  result,
  adapter,
  lastVariant,
  connected,
  onAction,
  onChangeDemo,
  onDisconnect,
}: {
  demo: DemoKind;
  def: DemoDef;
  status: Status;
  result: DemoResult | null;
  adapter: Adapter;
  lastVariant: string | null;
  connected: ConnectedSession | null;
  onAction: (variant?: string) => void;
  onChangeDemo: (d: DemoKind) => void;
  onDisconnect: () => void;
}) {
  const Body = def.Body;
  const preludeCount = def.prelude?.length ?? 0;
  const bodyDelay = useMemo(() => 120 + preludeCount * 220, [preludeCount]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const activeIndex = DEMO_STEPS.indexOf(demo);
  const activeStep = String(activeIndex + 1).padStart(2, "0");

  return (
    <div className="relative z-10 mx-auto w-full max-w-[1089px] border border-[#141414] bg-[rgba(11,11,11,0.75)] backdrop-blur-sm">
      {/* URL bar — wraps to two rows on small screens so the wallet info stays visible. */}
      <div className="m-3 mb-0 flex flex-wrap items-center justify-between gap-2 bg-[#101010] p-3 sm:m-[27px] sm:gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src="/icons/lock.svg"
            alt=""
            width={12}
            height={15}
            className="block shrink-0"
          />
          <p className="truncate font-mono text-[12px] whitespace-nowrap text-white sm:text-[14px]">
            {def.url}
          </p>
        </div>
        {connected ? (
          <div className="flex shrink-0 items-center gap-2">
            <span aria-hidden className="size-1.5 rounded-full bg-[#22c55e]" />
            <span className="font-mono text-[11px] text-white">
              {shorten(connected.address)}
            </span>
            {connected.balanceDisplay ? (
              <>
                <span className="hidden text-[11px] text-white/30 sm:inline">·</span>
                <span className="hidden font-mono text-[11px] text-white sm:inline">
                  {connected.balanceDisplay}
                </span>
              </>
            ) : null}
            <span className="text-[11px] text-white/30">·</span>
            <button
              type="button"
              onClick={onDisconnect}
              className="text-[11px] text-white/50 outline-none transition-colors duration-150 hover:text-white focus-visible:text-white"
            >
              Disconnect
            </button>
          </div>
        ) : null}
      </div>

      {/* Body — split:
          left pane (sm+) = numbered demo nav (acts as a stepper)
          right pane = chat orchestration + bespoke demo body
          Mobile shows the nav as a horizontal scroller via overflow-x-auto.
      */}
      <div className="grid min-h-[420px] grid-cols-1 sm:min-h-[510px] sm:grid-cols-[260px_1fr]">
        {/* Mobile: dropdown trigger sits below the demo body. Expanded
            panel floats up via absolute positioning so it doesn't push
            the rest of the page around. */}
        <div className="relative order-2 sm:hidden">
          <button
            type="button"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 border-t border-[#222] bg-black px-5 py-4 text-left text-white outline-none"
          >
            <div className="flex items-baseline gap-3">
              <span
                aria-hidden
                className="font-mono text-[11px] tracking-[0.05em] text-white/50"
              >
                {activeStep}
              </span>
              <span className="text-[15px]">{demo}</span>
            </div>
            <ChevronDown open={mobileNavOpen} />
          </button>
          <div
            className="absolute right-0 bottom-full left-0 z-20 overflow-hidden border-t border-[#222] bg-[#0c0c0c] transition-[max-height] duration-300 ease-out"
            style={{
              maxHeight: mobileNavOpen ? `${DEMO_STEPS.length * 56}px` : "0px",
            }}
          >
            <div className="flex flex-col">
              {DEMO_STEPS.map((d, i) => {
                const active = d === demo;
                const step = String(i + 1).padStart(2, "0");
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      onChangeDemo(d);
                      setMobileNavOpen(false);
                    }}
                    className="flex items-center justify-between gap-3 border-b border-[#222] px-5 py-3.5 text-left outline-none last:border-b-0"
                    style={{
                      background: active ? "rgba(255,255,255,0.04)" : "transparent",
                      color: active ? "#ffffff" : "rgba(255,255,255,0.55)",
                    }}
                  >
                    <div className="flex items-baseline gap-3">
                      <span
                        aria-hidden
                        className="font-mono text-[11px] tracking-[0.05em] text-white/30"
                      >
                        {step}
                      </span>
                      <span className="text-[15px]">{d}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Desktop: always-visible numbered stepper nav on the left */}
        <nav className="hidden flex-col border-r border-[#222] sm:flex">
          {DEMO_STEPS.map((d, i) => {
            const active = d === demo;
            const step = String(i + 1).padStart(2, "0");
            return (
              <button
                key={d}
                type="button"
                onClick={() => onChangeDemo(d)}
                className="group flex items-center justify-between gap-3 border-b border-[#222] px-5 py-6 text-left outline-none transition-colors duration-150 last:border-b-0"
                style={{
                  background: active ? "#000" : "transparent",
                  color: active ? "#ffffff" : "rgba(255,255,255,0.55)",
                }}
              >
                <div className="flex min-w-0 items-baseline gap-3">
                  <span
                    aria-hidden
                    className="font-mono text-[11px] tracking-[0.05em]"
                    style={{
                      color: active
                        ? "rgba(255,255,255,0.5)"
                        : "rgba(255,255,255,0.3)",
                    }}
                  >
                    {step}
                  </span>
                  <span className="truncate text-[15px] sm:text-[16px]">{d}</span>
                </div>
                <span
                  aria-hidden
                  className="opacity-60 transition-opacity duration-150 group-hover:opacity-100"
                >
                  <ChevronRight />
                </span>
              </button>
            );
          })}
        </nav>

        <div className="flex min-h-[420px] flex-col px-4 pt-3 pb-8 sm:min-h-[510px] sm:px-[27px] sm:pt-[15px] sm:pb-12">
          {def.prelude && def.prelude.length > 0 ? (
            <div className="flex w-full min-w-0 items-start gap-3">
              <div
                aria-hidden
                className="grid aspect-square h-9 shrink-0 place-items-center bg-black"
                style={{ animation: `fadeUp 480ms cubic-bezier(0.23, 1, 0.32, 1) 120ms both` }}
              >
                <img
                  src="/icons/tempo-logo.svg"
                  alt=""
                  width={14}
                  height={15}
                  className="block"
                />
              </div>
              <div className="flex w-full min-w-0 flex-col items-start gap-4">
                <div className="flex w-full min-w-0 flex-col items-start gap-2">
                  {def.prelude.map((m, i) => (
                    <ChatBubble
                      key={`${demo}-bubble-${i}`}
                      text={m}
                      delay={120 + i * 220}
                    />
                  ))}
                </div>
                <Body
                  key={`${demo}-body`}
                  status={status}
                  result={result}
                  lastVariant={lastVariant}
                  onAction={onAction}
                  delay={bodyDelay}
                  adapter={adapter}
                  connectedBalance={connected?.balanceDisplay ?? null}
                />
              </div>
            </div>
          ) : (
            <Body
              key={`${demo}-body`}
              status={status}
              result={result}
              lastVariant={lastVariant}
              onAction={onAction}
              delay={bodyDelay}
              adapter={adapter}
              connectedBalance={connected?.balanceDisplay ?? null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
