"use client";

import { animate, onScroll } from "animejs";
import { useEffect, useRef, useState } from "react";
import { springs } from "../animation";
import { useTheme } from "../useTheme";
import { BrowserMockup } from "./components/BrowserMockup";
import { DEMOS } from "./config";
import {
  connectWallet,
  createProvider,
  ensureNetwork,
  PATH_USD,
  shorten,
} from "./sdk";
import type {
  AccountStatus,
  AccountsProvider,
  Adapter,
  DemoKind,
  DemoNetwork,
  DemoResult,
  SetupStatus,
  Status,
} from "./types";

// Privy is intentionally NOT wired in V1.
// React 19's dev-mode component logging (logComponentRender) walks all props,
// and Privy's internal iframe/window references trip a cross-origin
// SecurityError that leaves the React reconciler stuck — this in turn
// silently breaks unrelated state updates (e.g., webAuth status transitions).
// The privy adapter falls back to the Tempo dialog in sdk.ts; re-enable
// PrivyProvider when we have a proper integration path that doesn't keep
// cross-origin window refs on a React-walkable path.

type Connected = {
  address: `0x${string}`;
  balanceDisplay: string;
  balance: bigint;
};

const DEPOSIT_BALANCE_ATTEMPTS = 40;
const DEPOSIT_BALANCE_INTERVAL_MS = 1500;
const FUNDING_BALANCE_ATTEMPTS = 20;
const FUNDING_BALANCE_INTERVAL_MS = 1500;

/** Scale when the demo box first enters from the bottom of the viewport. */
const SCROLL_START_SCALE = 0.92;
/** Max translateY (px, upward) applied at full progress. */
const SCROLL_LIFT_PX = 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const formatUsd = (balance: bigint) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(balance) / 1_000_000);

const parseBalance = (balance: unknown) => {
  if (typeof balance === "bigint") return balance;
  if (typeof balance === "string") {
    try {
      return BigInt(balance);
    } catch {
      return 0n;
    }
  }
  return 0n;
};

export default function Demo() {
  const [adapter] = useState<Adapter>("tempoAuth");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) return;

    el.style.transformOrigin = "center";
    el.style.willChange = "transform";
    const animation = animate(el, {
      scale: [SCROLL_START_SCALE, 1],
      y: [0, -SCROLL_LIFT_PX],
      ease: springs.scroll,
      autoplay: onScroll({
        target: el,
        // 0 when the box enters from the viewport bottom; 1 after it has
        // crossed 80% of the viewport, then clamp at full size.
        enter: "end start",
        leave: "20% start",
        sync: true,
      }),
    });

    return () => {
      animation.revert();
      el.style.willChange = "";
      el.style.transformOrigin = "";
    };
  }, []);

  const [demo, setDemo] = useState<DemoKind>("Log In");
  const [status, setStatus] = useState<Status>("idle");
  const [setupStatus, setSetupStatus] = useState<SetupStatus>("idle");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [lastVariant, setLastVariant] = useState<string | null>(null);
  const [connected, setConnected] = useState<Connected | null>(null);
  const [accountStatus, setAccountStatus] =
    useState<AccountStatus>("checking");
  const providerRef = useRef<AccountsProvider | null>(null);
  const providerAdapterRef = useRef<Adapter | null>(null);
  const providerNetworkRef = useRef<DemoNetwork | null>(null);
  const providerSchemeRef = useRef<"light" | "dark" | null>(null);
  const activeDemoRef = useRef<DemoKind>("Log In");
  const statusRef = useRef<Status>("idle");
  const depositWatchRef = useRef(0);
  const { resolved } = useTheme();

  activeDemoRef.current = demo;
  statusRef.current = status;

  const selectDemo = (next: DemoKind) => {
    depositWatchRef.current += 1;
    if (DEMOS[next].network !== DEMOS[demo].network) {
      setConnected(null);
      setAccountStatus("checking");
    }
    setDemo(next);
    setStatus("idle");
    setSetupStatus("idle");
    setSetupError(null);
    setResult(null);
    setLastVariant(null);
  };

  const refreshBalance = async (
    provider: AccountsProvider,
    address: `0x${string}`,
    network: DemoNetwork = DEMOS[activeDemoRef.current].network,
  ) => {
    try {
      await ensureNetwork(provider, network);
      const balances = (await provider.request({
        method: "wallet_getBalances",
        params: [{ account: address, tokens: [PATH_USD] }],
      } as Parameters<typeof provider.request>[0])) as ReadonlyArray<{
        balance?: `0x${string}` | bigint | undefined;
        display?: string | undefined;
      }>;
      const native = balances?.[0];
      const balance = parseBalance(native?.balance);
      console.info("[demo] pathUSD balance", { account: address, balance });
      const next = {
        address,
        balanceDisplay: native?.display ?? formatUsd(balance),
        balance,
      };
      if (DEMOS[activeDemoRef.current].network === network) setConnected(next);
      return next;
    } catch (e) {
      console.warn("[demo] pathUSD balance failed", e);
      const next = { address, balanceDisplay: "$0.00", balance: 0n };
      if (DEMOS[activeDemoRef.current].network === network) setConnected(next);
      return next;
    }
  };

  const onDisconnect = async () => {
    depositWatchRef.current += 1;
    try {
      const provider = providerRef.current;
      if (provider) {
        await provider.request({ method: "wallet_disconnect" } as Parameters<
          typeof provider.request
        >[0]);
      }
    } catch {
      // ignore — clear local state regardless so the UI doesn't lock up.
    }
    setConnected(null);
    setAccountStatus("disconnected");
    setStatus("idle");
    setSetupStatus("idle");
    setSetupError(null);
    setResult(null);
    setLastVariant(null);
  };

  // Recreate the provider when the adapter, active network, or resolved
  // landing theme changes. Tempo's dialog adapter dedupes by host, so
  // re-running `createProvider` just `syncTheme`s the cached iframe —
  // no flicker, no session loss.
  const ensureProvider = (next: Adapter, network: DemoNetwork) => {
    if (
      !providerRef.current ||
      providerAdapterRef.current !== next ||
      providerNetworkRef.current !== network ||
      providerSchemeRef.current !== resolved
    ) {
      providerRef.current = createProvider(next, resolved, network);
      providerAdapterRef.current = next;
      providerNetworkRef.current = network;
      providerSchemeRef.current = resolved;
    }
    return providerRef.current;
  };

  useEffect(() => {
    if (
      providerRef.current &&
      providerAdapterRef.current &&
      providerNetworkRef.current &&
      providerSchemeRef.current !== resolved
    ) {
      providerRef.current = createProvider(
        providerAdapterRef.current,
        resolved,
        providerNetworkRef.current,
      );
      providerSchemeRef.current = resolved;
    }
  }, [resolved]);

  // Hydrate the active network from persisted storage. Only the Log In demo
  // gets a "Signed in" result line; other demos should stay idle and simply
  // show the account state in the browser chrome.
  useEffect(() => {
    let cancelled = false;
    const currentDemo = demo;
    const network = DEMOS[currentDemo].network;
    const hydrate = async () => {
      try {
        const provider = ensureProvider(adapter, network);
        await ensureNetwork(provider, network);
        // Small delay so zustand persist middleware finishes hydrating.
        await new Promise((r) => setTimeout(r, 150));
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as readonly `0x${string}`[];
        if (cancelled || activeDemoRef.current !== currentDemo) return;
        const addr = accounts?.[0];
        if (addr) {
          await refreshBalance(provider, addr, network);
          if (cancelled || activeDemoRef.current !== currentDemo) return;
          setAccountStatus("connected");
          if (currentDemo === "Log In" && statusRef.current !== "running") {
            setResult({ summary: `Signed in · ${shorten(addr)}` });
            setStatus("done");
            setLastVariant(null);
          }
        } else {
          if (DEMOS[activeDemoRef.current].network === network) {
            setConnected(null);
            setAccountStatus("disconnected");
          }
        }
      } catch {
        if (!cancelled && DEMOS[activeDemoRef.current].network === network) {
          setConnected(null);
          setAccountStatus("disconnected");
        }
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
    // Re-run when the demo/network or adapter changes — different adapter
    // means a fresh session, different network means a separate wallet state.
  }, [adapter, demo]);

  // Suppress the React-19 dev-overlay SecurityError that fires when
  // `logComponentRender` walks props that touch the wallet iframe's
  // cross-origin contentWindow. It's a dev-only artifact; functionality
  // is unaffected. Strips noise so the user can keep clicking through demos.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onError = (e: ErrorEvent) => {
      const msg = e.message ?? e.error?.message ?? "";
      if (
        typeof msg === "string" &&
        msg.includes("Blocked a frame") &&
        msg.includes("cross-origin")
      ) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };
    window.addEventListener("error", onError, true);
    return () => window.removeEventListener("error", onError, true);
  }, []);

  const handleDemo = (next: DemoKind) => {
    if (next === demo) return;
    selectDemo(next);
  };

  const onAction = async (variant?: string) => {
    if (status === "running") return;
    const nonBlockingDeposit = demo === "Add Funds";
    setStatus(nonBlockingDeposit ? "idle" : "running");
    setLastVariant(variant ?? null);
    const def = DEMOS[demo];
    const provider = ensureProvider(adapter, def.network);
    await ensureNetwork(provider, def.network);
    let depositBaseline = connected?.balance ?? 0n;
    let depositBaselineAddress = connected?.address ?? null;

    if (nonBlockingDeposit) {
      try {
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as readonly `0x${string}`[];
        const addr = accounts?.[0];
        if (addr) {
          const current = await refreshBalance(provider, addr, def.network);
          depositBaseline = current.balance;
          depositBaselineAddress = addr;
          setAccountStatus("connected");
        }
      } catch {
        // The deposit dialog can still connect an account; the balance
        // watcher below treats a new positive balance as the completion.
      }
    }

    const ctx = {
      adapter,
      // privy hooks intentionally omitted — see header comment.
    };
    const runPromise = def.run(
      provider,
      variant === undefined ? ctx : { ...ctx, variant },
    );

    if (nonBlockingDeposit) {
      try {
        await runPromise;
        if (activeDemoRef.current !== demo) return;
        setResult(null);
        const watch = depositWatchRef.current + 1;
        depositWatchRef.current = watch;
        void (async () => {
          for (let i = 0; i < DEPOSIT_BALANCE_ATTEMPTS; i += 1) {
            await sleep(DEPOSIT_BALANCE_INTERVAL_MS);
            if (depositWatchRef.current !== watch) return;
            if (activeDemoRef.current !== "Add Funds") return;
            try {
              const accounts = (await provider.request({
                method: "eth_accounts",
              })) as readonly `0x${string}`[];
              const addr = accounts?.[0] ?? depositBaselineAddress;
              if (!addr) continue;
              const next = await refreshBalance(provider, addr, def.network);
              if (activeDemoRef.current !== "Add Funds") return;
              setAccountStatus("connected");
              if (next.balance > depositBaseline) {
                setResult({ summary: `Balance updated · ${next.balanceDisplay}` });
                setStatus("done");
                return;
              }
            } catch {
              // Balance may lag the deposit path; keep polling.
            }
          }
        })();
      } catch (e) {
        if (activeDemoRef.current !== demo) return;
        console.warn("[demo] run failed", e);
        setStatus("idle");
        setResult(null);
      }
      return;
    }

    // Active poll: only for Log In. The SDK's wallet_connect promise
    // occasionally hangs after the iframe completes auth — polling lets us
    // short-circuit as soon as the wallet persists the address. Other demos
    // must let their SDK request win, otherwise an existing account can make
    // a deposit/payment action incorrectly render "Signed in".
    const POLL_INTERVAL_MS = 1500;
    const POLL_TIMEOUT_MS = 60_000;
    const shouldPollAccounts = demo === "Log In";
    let pollHandle: ReturnType<typeof setInterval> | undefined;
    const pollPromise = shouldPollAccounts
      ? new Promise<{ __polled: `0x${string}` } | { __pollTimeout: true }>(
          (resolve) => {
            const startedAt = Date.now();
            pollHandle = setInterval(async () => {
              try {
                const accounts = (await provider.request({
                  method: "eth_accounts",
                })) as readonly `0x${string}`[];
                const next = accounts?.[0];
                if (next) {
                  resolve({ __polled: next });
                } else if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
                  resolve({ __pollTimeout: true });
                }
              } catch {
                // transient — keep polling
              }
            }, POLL_INTERVAL_MS);
          },
        )
      : null;

    try {
      const sdkPromise = runPromise.then((v) => ({ __sdk: v }) as const);
      const winner = await (pollPromise
        ? Promise.race([sdkPromise, pollPromise])
        : sdkPromise);
      if (pollHandle) clearInterval(pollHandle);
      if (activeDemoRef.current !== demo) return;

      let nextResult: DemoResult;
      if ("__sdk" in winner) {
        nextResult = winner.__sdk;
      } else if ("__polled" in winner) {
        nextResult = { summary: `Signed in · ${shorten(winner.__polled)}` };
      } else {
        // poll timed out without auth completing
        console.warn("[demo] action timed out without resolution");
        setStatus("idle");
        setResult(null);
        return;
      }

      // Refresh wallet status (address + balance) after success.
      try {
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as readonly `0x${string}`[];
        const addr = accounts?.[0];
        if (addr) {
          await refreshBalance(provider, addr, def.network);
          if (activeDemoRef.current === demo) setAccountStatus("connected");
        } else if (DEMOS[activeDemoRef.current].network === def.network) {
          setAccountStatus("disconnected");
        }
      } catch {
        // ignore
      }
      if (activeDemoRef.current !== demo) return;
      setResult(nextResult);
      setStatus("done");
    } catch (e) {
      if (pollHandle) clearInterval(pollHandle);
      if (activeDemoRef.current !== demo) return;
      console.warn("[demo] run failed", e);
      setStatus("idle");
      setResult(null);
    }
  };

  const onSetupConnect = async () => {
    if (setupStatus !== "idle") return;
    const network = DEMOS[demo].network;
    if (network !== "testnet") return;
    setSetupError(null);
    setSetupStatus("connecting");
    try {
      const provider = ensureProvider(adapter, network);
      await ensureNetwork(provider, network);
      const addr = await connectWallet(provider);
      if (addr) {
        await refreshBalance(provider, addr, network);
        if (DEMOS[activeDemoRef.current].network === network)
          setAccountStatus("connected");
      } else {
        setAccountStatus("disconnected");
      }
    } catch (e) {
      console.warn("[demo] testnet connect failed", e);
      if (!connected) setAccountStatus("disconnected");
      setSetupError("Could not connect. Try again.");
    } finally {
      setSetupStatus("idle");
    }
  };

  const onSetupFund = async () => {
    if (setupStatus !== "idle") return;
    const network = DEMOS[demo].network;
    if (network !== "testnet") return;
    setSetupError(null);
    setSetupStatus("funding");
    try {
      const provider = ensureProvider(adapter, network);
      await ensureNetwork(provider, network);
      let accounts = (await provider.request({
        method: "eth_accounts",
      })) as readonly `0x${string}`[];
      let addr = accounts?.[0] ?? connected?.address ?? null;
      if (!addr) {
        const connectedAddr = await connectWallet(provider);
        accounts = (await provider.request({
          method: "eth_accounts",
        })) as readonly `0x${string}`[];
        addr = accounts?.[0] ?? connectedAddr;
      }
      if (!addr) {
        setAccountStatus("disconnected");
        setSetupError("Connect first, then request funds.");
        return;
      }
      await provider.request({
        method: "tempo_fundAddress",
        params: [addr],
      } as Parameters<typeof provider.request>[0]);
      let next = await refreshBalance(provider, addr, network);
      for (
        let i = 0;
        i < FUNDING_BALANCE_ATTEMPTS && next.balance <= 0n;
        i += 1
      ) {
        await sleep(FUNDING_BALANCE_INTERVAL_MS);
        next = await refreshBalance(provider, addr, network);
      }
      if (next.balance <= 0n)
        console.warn("[demo] faucet completed but balance stayed zero", {
          account: addr,
        });
      if (DEMOS[activeDemoRef.current].network === network)
        setAccountStatus("connected");
      if (next.balance <= 0n) setSetupError("Funds requested. Balance is still updating.");
    } catch (e) {
      console.warn("[demo] testnet funding failed", e);
      setSetupError("Could not request funds. Try again.");
    } finally {
      setSetupStatus("idle");
    }
  };

  const def = DEMOS[demo];

  return (
    <section className="relative px-6 pt-2 pb-32 sm:pt-4 sm:pb-[200px]">
      <div ref={boxRef} className="relative">
        <BrowserMockup
          demo={demo}
          def={def}
          status={status}
          setupStatus={setupStatus}
          setupError={setupError}
          result={result}
          adapter={adapter}
          lastVariant={lastVariant}
          connected={connected}
          accountStatus={accountStatus}
          onAction={onAction}
          onSetupConnect={onSetupConnect}
          onSetupFund={onSetupFund}
          onChangeDemo={handleDemo}
          onDisconnect={onDisconnect}
        />
      </div>
    </section>
  );
}
