"use client";

import { waapi, type WAAPIAnimation } from "animejs";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { springs } from "./animation";
import AsciiBackground from "./ascii-bg";
import { AgentCopyIcon, CopyIcon, DocsIcon, GithubIcon, TempoLogo } from "./icons";
import { ThemeSwitch } from "./theme-switch";

type PackageManager = "npm" | "pnpm" | "bun";

const PM_ROTATE_MS = 1800;

const installCommand: Record<PackageManager, { prefix: string; pkg: string }> = {
  npm: { prefix: "npm i", pkg: "accounts" },
  pnpm: { prefix: "pnpm add", pkg: "accounts" },
  bun: { prefix: "bun add", pkg: "accounts" },
};

const PACKAGE_MANAGERS: PackageManager[] = ["npm", "pnpm", "bun"];

const agentInstructions = `Install the Tempo Accounts SDK:

  npm i accounts

Then create a wagmi config with the tempoWallet connector:

  import { createConfig, http } from 'wagmi'
  import { tempo } from 'wagmi/chains'
  import { tempoWallet } from 'wagmi/connectors'

  export const config = createConfig({
    chains: [tempo],
    connectors: [tempoWallet()],
    transports: { [tempo.id]: http() },
  })

Docs: https://tempo.xyz/docs/accounts-sdk
`;

function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };
  return { copied, copy };
}

function TopNav() {
  return (
    <nav className="flex items-center justify-between px-6 py-6">
      <a
        href="/"
        aria-label="Tempo"
        className="grid size-12 place-items-center bg-background text-foreground outline-none active:translate-y-px focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
      >
        <TempoLogo width={20} height={21} />
      </a>
      <div className="flex items-center gap-7 px-3">
        <span className="inline-flex">
          <a
            href="/docs"
            className="flex items-center gap-2 text-[12px] text-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[opacity,transform] hover:opacity-75 active:translate-y-px active:opacity-90"
          >
            <DocsIcon />
            DOCS
          </a>
        </span>
        <span className="inline-flex">
          <a
            href="https://github.com/tempoxyz/accounts"
            className="flex items-center gap-2 text-[12px] text-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[opacity,transform] hover:opacity-75 active:translate-y-px active:opacity-90"
          >
            <GithubIcon />
            GITHUB
          </a>
        </span>
        <span className="inline-flex">
          <ThemeSwitch />
        </span>
      </div>
    </nav>
  );
}

function HeroIntro() {
  const [pmIndex, setPmIndex] = useState(0);
  const [pmItems, setPmItems] = useState(() => [{ key: 0, index: 0 }]);
  const [pmPaused, setPmPaused] = useState(false);
  const [pmManual, setPmManual] = useState(false);
  const pmTimer = useRef<number | null>(null);
  const pmPausedRef = useRef(false);
  const pmManualRef = useRef(false);
  const pmIndexRef = useRef(0);
  const pmKey = useRef(1);
  const activePmKey = useRef(0);
  const animatedPmKey = useRef(0);
  const prefixRef = useRef<HTMLButtonElement | null>(null);
  const prefixItemRefs = useRef(new Map<number, HTMLSpanElement>());
  const prefixAnimations = useRef(new Map<number, WAAPIAnimation>());
  const prefixWidthAnimation = useRef<WAAPIAnimation | null>(null);
  const exitingPmKeys = useRef(new Set<number>());
  const previousPmIndex = useRef(0);
  const { copied: copiedInstall, copy: copyInstall } = useCopy();
  const { copied: copiedAgent, copy: copyAgent } = useCopy();
  const pm = PACKAGE_MANAGERS[pmIndex] ?? "npm";
  const cmd = installCommand[pm];
  const fullCommand = `${cmd.prefix} ${cmd.pkg}`;

  const clearPmTimer = useCallback(() => {
    if (pmTimer.current === null) return;
    window.clearTimeout(pmTimer.current);
    pmTimer.current = null;
  }, []);

  const advancePm = useCallback(() => {
    const index = (pmIndexRef.current + 1) % PACKAGE_MANAGERS.length;
    const key = pmKey.current++;
    pmIndexRef.current = index;
    activePmKey.current = key;
    setPmIndex(index);
    setPmItems((items) => [...items, { key, index }]);
  }, []);

  const schedulePmRotation = useCallback(() => {
    clearPmTimer();
    if (pmManualRef.current || pmPausedRef.current || document.hidden) return;
    pmTimer.current = window.setTimeout(() => {
      pmTimer.current = null;
      if (pmManualRef.current || pmPausedRef.current || document.hidden) return;
      advancePm();
      schedulePmRotation();
    }, PM_ROTATE_MS);
  }, [advancePm, clearPmTimer]);

  const setPmPausedValue = (paused: boolean) => {
    pmPausedRef.current = paused;
    setPmPaused(paused);
    if (paused) clearPmTimer();
  };

  const nextPm = () => {
    pmManualRef.current = true;
    setPmManual(true);
    clearPmTimer();
    advancePm();
  };

  useEffect(() => {
    pmManualRef.current = pmManual;
    pmPausedRef.current = pmPaused;
    schedulePmRotation();
  }, [pmManual, pmPaused, schedulePmRotation]);

  useEffect(() => {
    const onVisibilityChange = () => {
      schedulePmRotation();
    };
    const onBlur = () => {
      clearPmTimer();
    };
    const onFocus = () => {
      schedulePmRotation();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    schedulePmRotation();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      clearPmTimer();
    };
  }, [clearPmTimer, schedulePmRotation]);

  useLayoutEffect(() => {
    const prefix = prefixRef.current;
    if (!prefix) return;

    const previous = previousPmIndex.current;
    if (previous !== pmIndex) {
      const prevPm = PACKAGE_MANAGERS[previous] ?? "npm";
      const prevCmd = installCommand[prevPm];
      prefixWidthAnimation.current?.cancel();
      prefixWidthAnimation.current = waapi.animate(prefix, {
        width: [`${prevCmd.prefix.length}ch`, `${cmd.prefix.length}ch`],
        ease: springs.snappy,
      });
      previousPmIndex.current = pmIndex;
    }

    const active = activePmKey.current;
    for (const item of pmItems) {
      const el = prefixItemRefs.current.get(item.key);
      if (!el) continue;

      if (item.key === active) {
        if (animatedPmKey.current === active) continue;
        animatedPmKey.current = active;
        prefixAnimations.current.get(item.key)?.cancel();
        exitingPmKeys.current.delete(item.key);
        prefixAnimations.current.set(
          item.key,
          waapi.animate(el, {
            opacity: [0, 1],
            translateX: [-14, 0],
            ease: springs.snappy,
          }),
        );
        continue;
      }

      if (exitingPmKeys.current.has(item.key)) continue;

      prefixAnimations.current.get(item.key)?.cancel();
      const animation = waapi.animate(el, {
        opacity: [1, 0],
        translateX: [0, 14],
        ease: springs.snappy,
      });
      exitingPmKeys.current.add(item.key);
      prefixAnimations.current.set(item.key, animation);
      void animation.then(() => {
        exitingPmKeys.current.delete(item.key);
        prefixAnimations.current.delete(item.key);
        setPmItems((items) => items.filter((i) => i.key !== item.key));
      });
    }
  }, [cmd.prefix.length, pmIndex, pmItems]);

  useEffect(
    () => () => {
      prefixWidthAnimation.current?.cancel();
      for (const animation of prefixAnimations.current.values()) {
        animation.cancel();
      }
      prefixAnimations.current.clear();
    },
    [],
  );

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-9 px-6 pt-24 pb-44 sm:pt-[160px]">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1
          className="text-[32px] leading-[1.1] tracking-[-0.02em] text-foreground sm:text-5xl sm:whitespace-nowrap"
        >
          Tempo Accounts SDK
        </h1>
        <p
          className="max-w-lg text-[16px] text-foreground-muted sm:text-xl"
        >
          The fastest way to build stablecoin-powered apps, wallets, and agentic workflows.
        </p>
      </div>

      <div
        className="flex w-full max-w-[560px]"
      >
        <div
          className="flex w-full items-center justify-between bg-panel-1 px-4 py-3"
          onPointerEnter={() => setPmPausedValue(true)}
          onPointerLeave={() => setPmPausedValue(false)}
          onFocus={() => setPmPausedValue(true)}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && event.currentTarget.contains(next)) {
              return;
            }
            setPmPausedValue(false);
          }}
        >
          <div className="flex items-baseline font-mono text-[16px]">
            <button
              ref={prefixRef}
              type="button"
              onClick={nextPm}
              aria-label={`Switch package manager from ${cmd.prefix}`}
              className="relative inline-block overflow-hidden whitespace-nowrap border-0 bg-transparent p-0 text-left align-bottom outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-opacity hover:opacity-75"
              style={{
                textAlign: "left",
                width: `${cmd.prefix.length}ch`,
              }}
            >
              <span aria-hidden className="invisible block">
                {cmd.prefix}
              </span>
              {pmItems.map((item) => {
                const itemPm = PACKAGE_MANAGERS[item.index] ?? "npm";
                const itemCmd = installCommand[itemPm];
                return (
                  <span
                    key={item.key}
                    ref={(el) => {
                      if (el) prefixItemRefs.current.set(item.key, el);
                      else prefixItemRefs.current.delete(item.key);
                    }}
                    aria-hidden={item.key === activePmKey.current ? undefined : true}
                    className="absolute top-0 left-0 text-left text-foreground-subtle"
                    style={{
                      willChange: "transform, opacity",
                    }}
                  >
                    {itemCmd.prefix}
                  </span>
                );
              })}
            </button>
            <span className="pl-[1ch] text-foreground">{cmd.pkg}</span>
          </div>
          <button
            type="button"
            onClick={() => copyInstall(fullCommand)}
            aria-label={copiedInstall ? "Copied" : `Copy ${fullCommand}`}
            className="grid size-[18px] place-items-center text-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[opacity,transform] hover:opacity-75 active:translate-y-px active:opacity-90"
          >
            {copiedInstall
              ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  aria-hidden
                  className="text-foreground"
                >
                  <path
                    d="M3.75 9.5L7.25 13L14.25 5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )
              : <CopyIcon className="text-foreground" />}
          </button>
        </div>
      </div>

      <div className="mt-[-14px] flex items-center gap-5">
        <a
          href="/docs"
          className="flex items-center gap-1.5 text-[12px] text-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[opacity,transform] hover:opacity-75 active:translate-y-px active:opacity-90"
        >
          View docs
          <svg
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden
          >
            <path
              d="M3 9L9 3M9 3H4.5M9 3V7.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
        <span aria-hidden className="text-[12px] text-foreground-subtle">
          |
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => copyAgent(agentInstructions)}
            className="flex items-center gap-1 text-[12px] text-foreground-muted outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[color,transform] hover:text-foreground active:translate-y-px active:text-foreground"
          >
            <AgentCopyIcon />
            Copy agent instructions
          </button>
          <span
            aria-live="polite"
            className={`text-[12px] text-foreground-subtle transition-opacity duration-150 ${
              copiedAgent ? "opacity-100" : "opacity-0"
            }`}
          >
            copied
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Hero({ children }: { children?: ReactNode }) {
  return (
    <div>
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
        >
          <AsciiBackground />
        </div>
        <div className="relative">
          <TopNav />
          <HeroIntro />
        </div>
      </div>
      {children ? <div>{children}</div> : null}
    </div>
  );
}
