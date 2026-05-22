"use client";

import { animate, onScroll } from "animejs";
import { useEffect, useRef, useState } from "react";
import { springs } from "../animation";
import { useTheme } from "../useTheme";
import { BrowserMockup } from "./components/BrowserMockup";
import { DEMOS, DEMO_STEPS } from "./config";
import { createProvider, shorten } from "./sdk";
import type {
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
// The privy adapter falls back to the Tempo dialog in sdk.ts; re-enable
// PrivyProvider when we have a proper integration path that doesn't keep
// cross-origin window refs on a React-walkable path.

type Connected = {
  address: `0x${string}`;
  balanceDisplay: string;
};

const AUTO_ADVANCE_DELAY_MS = 1200;

/** Scale when the demo box first enters from the bottom of the viewport. */
const SCROLL_START_SCALE = 0.92;
/** Max translateY (px, upward) applied at full progress. */
const SCROLL_LIFT_PX = 60;

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
  const [result, setResult] = useState<DemoResult | null>(null);
  const [lastVariant, setLastVariant] = useState<string | null>(null);
  const [connected, setConnected] = useState<Connected | null>(null);
  const providerRef = useRef<AccountsProvider | null>(null);
  const providerAdapterRef = useRef<Adapter | null>(null);
  const providerSchemeRef = useRef<"light" | "dark" | null>(null);
  const activeDemoRef = useRef<DemoKind>("Log In");
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { resolved } = useTheme();

  activeDemoRef.current = demo;

  const clearAdvanceTimer = () => {
    if (!advanceTimer.current) return;
    clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
  };

  const selectDemo = (next: DemoKind) => {
    clearAdvanceTimer();
    setDemo(next);
    setStatus("idle");
    setResult(null);
    setLastVariant(null);
  };

  const scheduleNextDemo = (current: DemoKind) => {
    const i = DEMO_STEPS.indexOf(current);
    const next = DEMO_STEPS[i + 1];
    if (!next) return;
    clearAdvanceTimer();
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null;
      selectDemo(next);
    }, AUTO_ADVANCE_DELAY_MS);
  };

  const refreshBalance = async (
    provider: AccountsProvider,
    address: `0x${string}`,
  ) => {
    // Tempo's path-USD aggregate token (TokenId 0). The SDK is expected to
    // return the user's USD-equivalent balance through this canonical token.
    // If the SDK returns 0 here while the wallet UI shows funds, that's an
    // SDK-level issue (separate from this demo).
    const PATH_USD = "0x20c0000000000000000000000000000000000000" as const;
    try {
      const balances = (await provider.request({
        method: "wallet_getBalances",
        params: [{ account: address, tokens: [PATH_USD] }],
      } as Parameters<typeof provider.request>[0])) as ReadonlyArray<{
        display: string;
        symbol: string;
      }>;
      console.info("[demo] wallet_getBalances", { account: address, balances });
      // SDK's `display` is already pre-formatted with `$` via Intl.NumberFormat
      // — don't prepend a second one.
      const native = balances?.[0];
      const display = native?.display ?? "$0.00";
      setConnected({ address, balanceDisplay: display });
    } catch (e) {
      console.warn("[demo] wallet_getBalances failed", e);
      setConnected({ address, balanceDisplay: "$0.00" });
    }
  };

  const onDisconnect = async () => {
    clearAdvanceTimer();
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
    setStatus("idle");
    setResult(null);
    setLastVariant(null);
  };

  // Recreate the provider when EITHER the adapter or the resolved
  // landing theme changes. Tempo's dialog adapter dedupes by host, so
  // re-running `createProvider` just `syncTheme`s the cached iframe —
  // no flicker, no session loss.
  const ensureProvider = (next: Adapter) => {
    if (
      !providerRef.current ||
      providerAdapterRef.current !== next ||
      providerSchemeRef.current !== resolved
    ) {
      providerRef.current = createProvider(next, resolved);
      providerAdapterRef.current = next;
      providerSchemeRef.current = resolved;
    }
    return providerRef.current;
  };

  useEffect(() => {
    if (
      providerRef.current &&
      providerAdapterRef.current &&
      providerSchemeRef.current !== resolved
    ) {
      providerRef.current = createProvider(
        providerAdapterRef.current,
        resolved,
      );
      providerSchemeRef.current = resolved;
    }
  }, [resolved]);

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  // On mount: hydrate from persisted storage. If we already have a
  // connected account from a previous session, reflect "done" state so
  // the user doesn't see "Sign in" after a refresh of an authed app.
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const provider = ensureProvider(adapter);
        // Small delay so zustand persist middleware finishes hydrating.
        await new Promise((r) => setTimeout(r, 150));
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as readonly `0x${string}`[];
        if (cancelled) return;
        const addr = accounts?.[0];
        if (addr) {
          setResult({ summary: `Signed in · ${shorten(addr)}` });
          setStatus("done");
          setLastVariant(null);
          await refreshBalance(provider, addr);
        } else {
          setConnected(null);
        }
      } catch {
        if (!cancelled) setConnected(null);
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
    // Re-run when adapter changes — different adapter means a fresh session.
  }, [adapter]);

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
    clearAdvanceTimer();
    setStatus("running");
    setLastVariant(variant ?? null);
    const provider = ensureProvider(adapter);
    const def = DEMOS[demo];

    // Capture the connected address BEFORE the action so we can detect a
    // change-of-state (newly connected, or balance moved) without false
    // positives from the existing session.
    const beforeAccount = (() => {
      try {
        return connected?.address ?? null;
      } catch {
        return null;
      }
    })();

    const ctx = {
      adapter,
      // privy hooks intentionally omitted — see header comment.
    };
    const runPromise = def.run(
      provider,
      variant === undefined ? ctx : { ...ctx, variant },
    );

    // Active poll: alongside the SDK promise, poll eth_accounts every 1.5s.
    // The SDK's wallet_connect promise occasionally hangs after the iframe
    // completes auth — polling lets us short-circuit as soon as the wallet
    // persists the address. For non-connect actions (payments, swaps)
    // we ignore the poll resolution and let the SDK promise win.
    const POLL_INTERVAL_MS = 1500;
    const POLL_TIMEOUT_MS = 60_000;
    const isConnectLike = variant === undefined; // sign-in / on-ramp / etc.
    let pollHandle: ReturnType<typeof setInterval> | undefined;
    const pollPromise = new Promise<
      { __polled: `0x${string}` } | { __pollTimeout: true }
    >((resolve) => {
      const startedAt = Date.now();
      pollHandle = setInterval(async () => {
        try {
          const accounts = (await provider.request({
            method: "eth_accounts",
          })) as readonly `0x${string}`[];
          const next = accounts?.[0];
          if (next && (!isConnectLike || next !== beforeAccount)) {
            resolve({ __polled: next });
          } else if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            resolve({ __pollTimeout: true });
          }
        } catch {
          // transient — keep polling
        }
      }, POLL_INTERVAL_MS);
    });

    try {
      const winner = await Promise.race([
        runPromise.then((v) => ({ __sdk: v }) as const),
        pollPromise,
      ]);
      if (pollHandle) clearInterval(pollHandle);
      if (activeDemoRef.current !== demo) return;

      if ("__sdk" in winner) {
        setResult(winner.__sdk);
        setStatus("done");
      } else if ("__polled" in winner) {
        setResult({ summary: `Signed in · ${shorten(winner.__polled)}` });
        setStatus("done");
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
          await refreshBalance(provider, addr);
        }
      } catch {
        // ignore
      }
      if (activeDemoRef.current === demo) scheduleNextDemo(demo);
    } catch (e) {
      if (pollHandle) clearInterval(pollHandle);
      if (activeDemoRef.current !== demo) return;
      console.warn("[demo] run failed", e);
      setStatus("idle");
      setResult(null);
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
          result={result}
          adapter={adapter}
          lastVariant={lastVariant}
          connected={connected}
          onAction={onAction}
          onChangeDemo={handleDemo}
          onDisconnect={onDisconnect}
        />
      </div>
    </section>
  );
}
