"use client";

import { animate, onScroll } from "animejs";
import { useEffect, useRef, useState } from "react";
import { springs } from "../animation";
import { BrowserMockup } from "./components/BrowserMockup";
import { activeSpendPermissionResult, DEMOS } from "./config";
import {
  connectWallet,
  getDemoProvider,
  PATH_USD,
  shorten,
  TEMPO_MAINNET_CHAIN_ID,
  TEMPO_MODERATO_CHAIN_ID,
} from "./sdk";
import type {
  AccountStatus,
  AccountsProvider,
  Adapter,
  DemoKind,
  DemoResult,
  Status,
} from "./types";

// Privy is intentionally NOT wired in V1.
// React 19's dev-mode component logging (logComponentRender) walks all props,
// and Privy's internal iframe/window references trip a cross-origin
// SecurityError that leaves the React reconciler stuck — this in turn
// silently breaks unrelated state updates (e.g., webAuth status transitions).
// The live demo flow is pinned to the Tempo Wallet connector; re-enable
// PrivyProvider when we have a proper integration path that doesn't keep
// cross-origin window refs on a React-walkable path.

type Connected = {
  address: `0x${string}`;
  balanceDisplay: string;
  balance: bigint;
};

const ACTION_TIMEOUT_MS = 20_000;
const DEPOSIT_BALANCE_ATTEMPTS = 40;
const DEPOSIT_BALANCE_INTERVAL_MS = 1500;

/** Scale when the demo box first enters from the bottom of the viewport. */
const SCROLL_START_SCALE = 0.92;
/** Max translateY (px, upward) applied at full progress. */
const SCROLL_LIFT_PX = 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const balanceChainIdForDemo = (demo: DemoKind) =>
  demo === "Add Funds" ? TEMPO_MAINNET_CHAIN_ID : TEMPO_MODERATO_CHAIN_ID;

const rejectPendingRequests = (provider: AccountsProvider | null) => {
  provider?.store.setState((state) => ({
    ...state,
    requestQueue: state.requestQueue.map((queued) =>
      queued.status === "pending"
        ? {
            request: queued.request,
            error: { code: 4001, message: "Demo changed." },
            status: "error" as const,
          }
        : queued,
    ),
  }));
};

const cancelPendingRequests = (provider: AccountsProvider | null) => {
  rejectPendingRequests(provider);
};

const timeout = (ms: number) =>
  new Promise<{ __timeout: true }>((resolve) => {
    setTimeout(() => resolve({ __timeout: true }), ms);
  });

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
  const adapter: Adapter = "tempoAuth";
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
  const [signInStatus, setSignInStatus] = useState<Status>("idle");
  const [result, setResult] = useState<DemoResult | null>(null);
  const [lastVariant, setLastVariant] = useState<string | null>(null);
  const [connected, setConnected] = useState<Connected | null>(null);
  const [accountStatus, setAccountStatus] =
    useState<AccountStatus>("checking");
  const providerRef = useRef<AccountsProvider | null>(null);
  const activeDemoRef = useRef<DemoKind>("Log In");
  const statusRef = useRef<Status>("idle");
  const depositWatchRef = useRef(0);

  activeDemoRef.current = demo;
  statusRef.current = status;

  const selectDemo = (next: DemoKind) => {
    cancelPendingRequests(providerRef.current);
    depositWatchRef.current += 1;
    setDemo(next);
    setStatus("idle");
    setSignInStatus("idle");
    setResult(null);
    setLastVariant(null);
  };

  const refreshBalance = async (
    provider: AccountsProvider,
    address: `0x${string}`,
    options: { chainId?: number | undefined } = {},
  ) => {
    try {
      const params = {
        account: address,
        tokens: [PATH_USD],
        ...(options.chainId === undefined ? {} : { chainId: options.chainId }),
      };
      const balances = (await provider.request({
        method: "wallet_getBalances",
        params: [params],
      } as Parameters<typeof provider.request>[0])) as ReadonlyArray<{
        balance?: `0x${string}` | bigint | undefined;
        display?: string | undefined;
      }>;
      const native = balances?.[0];
      const balance = parseBalance(native?.balance);
      const next = {
        address,
        balanceDisplay: native?.display ?? formatUsd(balance),
        balance,
      };
      setConnected(next);
      return next;
    } catch {
      const next = { address, balanceDisplay: "$0.00", balance: 0n };
      setConnected(next);
      return next;
    }
  };

  const onDisconnect = async () => {
    cancelPendingRequests(providerRef.current);
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
    setSignInStatus("idle");
    setResult(null);
    setLastVariant(null);
  };

  const getProvider = async () => {
    providerRef.current ??= await getDemoProvider();
    return providerRef.current;
  };

  // Hydrate the connector's persisted session. Only the Log In demo gets a
  // "Signed in" result line; other demos stay idle and show account state in
  // the browser chrome.
  useEffect(() => {
    let cancelled = false;
    const currentDemo = demo;
    const hydrate = async () => {
      try {
        const provider = await getProvider();
        // Small delay so zustand persist middleware finishes hydrating.
        await new Promise((r) => setTimeout(r, 150));
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as readonly `0x${string}`[];
        if (cancelled || activeDemoRef.current !== currentDemo) return;
        const addr = accounts?.[0];
        if (addr) {
          await refreshBalance(provider, addr, {
            chainId: balanceChainIdForDemo(currentDemo),
          });
          if (cancelled || activeDemoRef.current !== currentDemo) return;
          setAccountStatus("connected");
          if (currentDemo === "Log In" && statusRef.current !== "running") {
            setResult({ summary: `Signed in · ${shorten(addr)}` });
            setStatus("done");
            setLastVariant(null);
          }
          if (
            currentDemo === "Spend Permissions" &&
            statusRef.current !== "running"
          ) {
            const permissionResult = activeSpendPermissionResult(
              provider,
              addr,
            );
            if (permissionResult) {
              setResult(permissionResult);
              setStatus("done");
              setLastVariant(null);
            }
          }
        } else {
          setConnected(null);
          setAccountStatus("disconnected");
        }
      } catch {
        if (!cancelled) {
          setConnected(null);
          setAccountStatus("disconnected");
        }
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [demo]);

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

  const onSignIn = async () => {
    if (signInStatus === "running") return;
    setSignInStatus("running");
    try {
      const provider = await getProvider();
      const address = await connectWallet(provider);
      if (!address) return;
      await refreshBalance(provider, address, {
        chainId: balanceChainIdForDemo(activeDemoRef.current),
      });
      setAccountStatus("connected");
    } catch {
      cancelPendingRequests(providerRef.current);
      if (!connected) setAccountStatus("disconnected");
    } finally {
      setSignInStatus("idle");
    }
  };

  const onAction = async (variant?: string) => {
    if (status === "running") return;
    const nonBlockingDeposit = demo === "Add Funds";
    setStatus(nonBlockingDeposit ? "idle" : "running");
    setLastVariant(variant ?? null);
    const def = DEMOS[demo];
    const provider = await getProvider();
    if (nonBlockingDeposit) cancelPendingRequests(provider);
    let depositBaseline = connected?.balance ?? 0n;
    let depositBaselineAddress = connected?.address ?? null;

    if (nonBlockingDeposit) {
      try {
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as readonly `0x${string}`[];
        const addr = accounts?.[0];
        if (addr) {
          const current = await refreshBalance(provider, addr, {
            chainId: TEMPO_MAINNET_CHAIN_ID,
          });
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
      previousResult: result,
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
              const next = await refreshBalance(provider, addr, {
                chainId: TEMPO_MAINNET_CHAIN_ID,
              });
              if (activeDemoRef.current !== "Add Funds") return;
              setAccountStatus("connected");
              if (next.balance > depositBaseline) {
                setResult({
                  summary: `Balance updated · ${next.balanceDisplay}`,
                });
                setStatus("done");
                return;
              }
            } catch {
              // Balance may lag the deposit path; keep polling.
            }
          }
        })();
      } catch {
        if (activeDemoRef.current !== demo) return;
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
      const winner = await Promise.race(
        pollPromise
          ? [sdkPromise, pollPromise, timeout(ACTION_TIMEOUT_MS)]
          : [sdkPromise, timeout(ACTION_TIMEOUT_MS)],
      );
      if (pollHandle) clearInterval(pollHandle);
      if (activeDemoRef.current !== demo) return;

      let nextResult: DemoResult;
      if ("__sdk" in winner) {
        nextResult = winner.__sdk;
      } else if ("__polled" in winner) {
        nextResult = { summary: `Signed in · ${shorten(winner.__polled)}` };
      } else {
        if ("__timeout" in winner) cancelPendingRequests(provider);
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
          await refreshBalance(provider, addr, {
            chainId: balanceChainIdForDemo(activeDemoRef.current),
          });
          if (activeDemoRef.current === demo) setAccountStatus("connected");
        } else {
          setAccountStatus("disconnected");
        }
      } catch {
        // ignore
      }
      if (activeDemoRef.current !== demo) return;
      setResult(nextResult);
      setStatus("done");
    } catch {
      if (pollHandle) clearInterval(pollHandle);
      cancelPendingRequests(provider);
      if (activeDemoRef.current !== demo) return;
      setStatus("idle");
      setResult(null);
    }
  };

  const def = DEMOS[demo];

  return (
    <section className="relative px-6 pt-2 pb-12 sm:pt-4 sm:pb-20">
      <div ref={boxRef} className="relative">
        <BrowserMockup
          demo={demo}
          def={def}
          status={status}
          signInStatus={signInStatus}
          result={result}
          adapter={adapter}
          lastVariant={lastVariant}
          connected={connected}
          accountStatus={accountStatus}
          onAction={onAction}
          onSignIn={onSignIn}
          onChangeDemo={handleDemo}
          onDisconnect={onDisconnect}
        />
      </div>
    </section>
  );
}
