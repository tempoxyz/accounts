"use client";

import { useEffect, useRef, useState } from "react";
import { getDemoProvider, PATH_USD, shorten } from "../demo/sdk";
import type {
  AccountsProvider,
  DemoResult,
  Status,
} from "../demo/types";

/**
 * Shared session state for landing sections. Mirrors the lifecycle in
 * `Demo.tsx` / `DemoSplit`'s `BalancesCard`: lazy-reads the shared
 * Tempo Wallet connector provider, hydrates from persisted storage, then
 * exposes a `run(fn)` helper that wraps an SDK call with status +
 * result + balance refresh. The shared storage namespace keeps all three
 * sections plus `DemoSplit` and the browser-mockup `Demo` on one session.
 */
export function useTempoSession() {
  const [status, setStatus] = useState<Status>("idle");
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [balanceDisplay, setBalanceDisplay] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);
  const providerRef = useRef<AccountsProvider | null>(null);

  const getProvider = async () => {
    providerRef.current ??= await getDemoProvider();
    return providerRef.current;
  };

  const refreshBalance = async (
    p: AccountsProvider,
    addr: `0x${string}`,
  ) => {
    try {
      const balances = (await p.request({
        method: "wallet_getBalances",
        params: [{ account: addr, tokens: [PATH_USD] }],
      } as Parameters<typeof p.request>[0])) as ReadonlyArray<{
        display: string;
      }>;
      setBalanceDisplay(balances?.[0]?.display ?? "$0.00");
    } catch {
      setBalanceDisplay("$0.00");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getProvider();
        const accounts = (await p.request({
          method: "eth_accounts",
        })) as readonly `0x${string}`[];
        if (cancelled) return;
        const addr = accounts?.[0];
        if (addr) {
          setAddress(addr);
          // Don't touch `status` — hydration is not an action completion.
          // Bodies that want to surface the signed-in state (e.g. the
          // Accounts section's LogInBody) can derive it from `address`.
          setResult({ summary: `Signed in · ${shorten(addr)}` });
          await refreshBalance(p, addr);
        }
      } catch {
        // No persisted session — stay idle.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (
    fn: (provider: AccountsProvider) => Promise<DemoResult>,
  ) => {
    if (status === "running") return;
    setStatus("running");
    try {
      const p = await getProvider();
      const r = await fn(p);
      setResult(r);
      setStatus("done");
      try {
        const accounts = (await p.request({
          method: "eth_accounts",
        })) as readonly `0x${string}`[];
        const addr = accounts?.[0];
        if (addr) {
          setAddress(addr);
          await refreshBalance(p, addr);
        }
      } catch {
        // ignore — keep prior balance/address.
      }
    } catch {
      setStatus("idle");
      setResult(null);
    }
  };

  return { status, address, balanceDisplay, result, run };
}
