"use client";

import { useEffect, useRef, useState } from "react";
import { InteractiveQr } from "../../sections/InteractiveQr";
import { shorten } from "../sdk";
import { bodyAnimation } from "./shared";

/**
 * Curated, display-only receive accounts. Each represents a sub-account
 * (Savings / Checking / Spending) with its own stable address. The
 * Receive demo is purely illustrative — the addresses don't correspond
 * to real on-chain accounts. The UI demonstrates how the SDK could
 * surface multi-account selection in a "receive into…" flow.
 */
export const RECEIVE_ACCOUNTS = [
  {
    id: "savings",
    label: "Savings",
    address: "0x16214C64fa1230b8DDc4F8e29D7AdAfee8b0B171",
  },
  {
    id: "checking",
    label: "Checking",
    address: "0x7d3F4d8E5a92B1C6e0fA3B27E91D4cFa8076Bce2",
  },
  {
    id: "spending",
    label: "Spending",
    address: "0xC4Bd8a7F6e5D4c3B2a1E0f9d8C7b6A5e4D3c2B1a",
  },
] as const;

export type ReceiveAccountId = (typeof RECEIVE_ACCOUNTS)[number]["id"];

export function ReceiveBody({
  selectedId,
  onSelect,
  delay,
}: {
  selectedId: ReceiveAccountId;
  onSelect: (id: ReceiveAccountId) => void;
  delay: number;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const account =
    RECEIVE_ACCOUNTS.find((a) => a.id === selectedId) ?? RECEIVE_ACCOUNTS[0];

  // Close the popover on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("click", onDocClick);
    return () => window.removeEventListener("click", onDocClick);
  }, [open]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(account.address);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  // EIP-681 payment URI so crypto-aware scanners recognise the payload.
  // Generic scanners fall back to the raw URI as text.
  const qrValue = `ethereum:${account.address}`;

  return (
    <div
      className="flex w-full max-w-[420px] flex-col gap-5 bg-[#181818] p-6"
      style={bodyAnimation(delay)}
    >
      <div ref={containerRef} className="relative flex flex-col gap-1.5">
        <p className="text-[13px] text-white/50">Receive into</p>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 border border-[#2e2e2e] bg-[#1f1f1f] px-3 py-2.5 text-left outline-none transition-colors hover:bg-[#252525] focus-visible:bg-[#252525]"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] text-white">{account.label}</span>
            <span className="font-mono text-[11px] text-white/40">
              {shorten(account.address)}
            </span>
          </div>
          <ChevronDown open={open} />
        </button>

        {open ? (
          <div
            role="listbox"
            className="absolute inset-x-0 top-full z-10 mt-1 flex flex-col border border-[#2e2e2e] bg-[#1f1f1f] shadow-lg"
          >
            {RECEIVE_ACCOUNTS.map((a) => {
              const active = a.id === selectedId;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onSelect(a.id);
                    setOpen(false);
                  }}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-[#262626] focus-visible:bg-[#262626]"
                  style={{ background: active ? "#262626" : "transparent" }}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] text-white">{a.label}</span>
                    <span className="font-mono text-[11px] text-white/40">
                      {shorten(a.address)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="grid place-items-center py-2">
        <InteractiveQr value={qrValue} size={240} />
      </div>

      <button
        type="button"
        onClick={onCopy}
        className="flex h-11 w-full items-center justify-center bg-white px-4 text-[14px] text-[#181818] outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90"
      >
        {copied ? "Copied" : "Copy address"}
      </button>
    </div>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className="shrink-0 text-white/50 transition-transform duration-150"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
