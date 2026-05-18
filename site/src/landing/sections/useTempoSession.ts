"use client";

import { useEffect, useRef, useState } from "react";
import {
  PATH_USD,
  createProvider,
  shorten,
} from "../demo/sdk";
import type {
  AccountsProvider,
  DemoResult,
  Status,
} from "../demo/types";
import { useTheme } from "../useTheme";

/**
 * Shared session state for landing sections. Mirrors the lifecycle in
 * `Demo.tsx` / `DemoSplit`'s `BalancesCard`: lazy-creates a `tempoAuth`
 * provider, hydrates from persisted cookie/localStorage on mount, then
 * exposes a `run(fn)` helper that wraps an SDK call with status +
 * result + balance refresh. Storage is namespaced to `tempo-accounts-
 * demo` (see `createProvider`), so all three sections plus `DemoSplit`
 * and the browser-mockup `Demo` share one signed-in session.
 */
export function useTempoSession() {
  const [status, setStatus] = useState<Status>("idle");
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [balanceDisplay, setBalanceDisplay] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);
  const providerRef = useRef<AccountsProvider | null>(null);
  const providerSchemeRef = useRef<"light" | "dark" | null>(null);
  const { resolved } = useTheme();

  // Recreate the provider when the resolved landing theme flips so the
  // wallet dialog opens in matching light/dark. The dialog adapter
  // dedupes by host, so this just calls `syncTheme` on the cached
  // iframe — no full reload, and storage (cookies + localStorage) is
  // shared so the signed-in session carries over.
  const getProvider = () => {
    if (!providerRef.current || providerSchemeRef.current !== resolved) {
      providerRef.current = createProvider("tempoAuth", resolved);
      providerSchemeRef.current = resolved;
    }
    return providerRef.current;
  };

  useEffect(() => {
    if (providerRef.current && providerSchemeRef.current !== resolved) {
      providerRef.current = createProvider("tempoAuth", resolved);
      providerSchemeRef.current = resolved;
    }
  }, [resolved]);

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
        const p = getProvider();
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
      const p = getProvider();
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
    } catch (e) {
      console.warn("[section] run failed", e);
      setStatus("idle");
      setResult(null);
    }
  };

  return { status, address, balanceDisplay, result, run };
}
