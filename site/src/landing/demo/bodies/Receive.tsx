"use client";

import { useEffect, useRef, useState } from "react";
import { InteractiveQr } from "../../sections/InteractiveQr";
import { shorten } from "../sdk";
import { useBodyAnimation } from "./shared";

/**
 * Pre-connect placeholder address. The Tempo wallet exposes a single
 * account per session, so the Receive demo always points at that
 * account. Before a wallet session has hydrated we surface this
 * placeholder so the section still renders end-to-end (QR, copy
 * button) without a connected user.
 */
export const RECEIVE_FALLBACK_ADDRESS =
  "0x16214C64fa1230b8DDc4F8e29D7AdAfee8b0B171" as const;

export function ReceiveBody({
  address,
  delay,
}: {
  address: `0x${string}`;
  delay: number;
}) {
  const body = useBodyAnimation(delay);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  // EIP-681 payment URI so crypto-aware scanners recognise the payload.
  // Generic scanners fall back to the raw URI as text.
  const qrValue = `ethereum:${address}`;

  return (
    <div
      ref={body.ref}
      className="flex w-full max-w-[420px] flex-col gap-5 bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] text-foreground-muted">Receive into</p>
        <div className="flex w-full items-center justify-between gap-3 border border-panel-edge bg-panel-3 px-3 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] text-foreground">Account</span>
            <span className="font-mono text-[11px] text-foreground-subtle">
              {shorten(address)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid place-items-center py-2">
        <InteractiveQr value={qrValue} size={240} />
      </div>

      <button
        type="button"
        onClick={onCopy}
        className="flex h-11 w-full items-center justify-center bg-accent px-4 text-[14px] text-on-accent outline-none hover:bg-accent-hover active:bg-accent-active focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
      >
        {copied ? "Copied" : "Copy address"}
      </button>
    </div>
  );
}
