"use client";

import { stagger, waapi, type WAAPIAnimation } from "animejs";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "vocs";
import { springs } from "./animation";
import AsciiBackground from "./ascii-bg";
import { connectWallet } from "./demo/sdk";
import { AgentCopyIcon, CopyIcon, DocsIcon, GithubIcon, TempoLogo } from "./icons";
import { useTempoSession } from "./sections/useTempoSession";
import { ThemeSwitch } from "./theme-switch";

type PackageManager = "npm" | "pnpm" | "bun";
type Adapter = "tempoAuth" | "webAuth" | "privy" | "turnkey";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";
const PM_ROTATE_MS = 1800;
const HERO_ENTRANCE_STAGGER_MS = 28;
const HERO_NAV_DELAY_MS = 120;
const heroEntranceInitialStyle = {
  opacity: 0,
  translate: "0 10px",
  willChange: "opacity, translate",
} satisfies CSSProperties;
const heroNavInitialStyle = {
  opacity: 0,
  translate: "0 -46px",
  willChange: "opacity, translate",
} satisfies CSSProperties;

type HeroNavFall = {
  translate: string;
  delay: number;
};

const HERO_NAV_DEFAULT_FALL: HeroNavFall = {
  translate: "0 -46px",
  delay: 0,
};

const HERO_NAV_FALLS: readonly HeroNavFall[] = [
  { translate: "0 -12px", delay: 60 },
  { translate: "0 -12px", delay: 0 },
  { translate: "0 -12px", delay: 120 },
  { translate: "0 -12px", delay: 180 },
];

function heroNavStyle(fall: HeroNavFall | undefined) {
  if (!fall) fall = HERO_NAV_DEFAULT_FALL;
  return {
    ...heroNavInitialStyle,
    translate: fall.translate,
  } satisfies CSSProperties;
}

const installCommand: Record<PackageManager, { prefix: string; pkg: string }> = {
  npm: { prefix: "npm i", pkg: "accounts" },
  pnpm: { prefix: "pnpm add", pkg: "accounts" },
  bun: { prefix: "bun add", pkg: "accounts" },
};

const PACKAGE_MANAGERS: PackageManager[] = ["npm", "pnpm", "bun"];

const adapterInfo: Record<Adapter, { title: string; description: string }> = {
  tempoAuth: {
    title: "Tempo Wallet Adapter",
    description:
      "Enables universal wallet experiences by delegating signing to an external origin dialog. Also exported as tempoWallet.",
  },
  webAuth: {
    title: "WebAuthn Adapter",
    description:
      "Authenticates users with on-device passkeys via the WebAuthn ceremony — no popup, no third-party host. Best for first-party flows where you control the relying party.",
  },
  privy: {
    title: "Privy Adapter",
    description:
      "Bring your own auth: route sign-in through Privy's embedded wallets while keeping the Accounts SDK's wagmi-compatible surface. Falls back to the Tempo dialog when Privy is unavailable.",
  },
  turnkey: {
    title: "Turnkey Adapter",
    description:
      "Bring your own signing infrastructure: delegate key management and approvals to Turnkey while the Accounts SDK exposes the same wagmi-compatible surface to your app.",
  },
};

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

function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

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

function TopNav({
  navStaggerStyles,
}: {
  navStaggerStyles: readonly (CSSProperties | undefined)[];
}) {
  return (
    <nav className="flex items-center justify-between px-6 py-6">
      <a
        data-hero-nav-stagger
        style={navStaggerStyles[0]}
        href="/"
        aria-label="Tempo"
        className="grid size-12 place-items-center bg-background text-foreground outline-none active:translate-y-px focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
      >
        <TempoLogo width={20} height={21} />
      </a>
      <div className="flex items-center gap-7 px-3">
        <span
          data-hero-nav-stagger
          style={navStaggerStyles[1]}
          className="inline-flex"
        >
          <Link
            to="/docs"
            className="flex items-center gap-2 text-[12px] text-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[opacity,transform] hover:opacity-75 active:translate-y-px active:opacity-90"
          >
            <DocsIcon />
            DOCS
          </Link>
        </span>
        <span
          data-hero-nav-stagger
          style={navStaggerStyles[2]}
          className="inline-flex"
        >
          <a
            href="https://github.com/tempoxyz/accounts"
            className="flex items-center gap-2 text-[12px] text-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[opacity,transform] hover:opacity-75 active:translate-y-px active:opacity-90"
          >
            <GithubIcon />
            GITHUB
          </a>
        </span>
        <span data-hero-nav-stagger style={navStaggerStyles[3]} className="inline-flex">
          <ThemeSwitch />
        </span>
      </div>
    </nav>
  );
}

function HeroIntro({
  staggerStyle,
}: {
  staggerStyle: CSSProperties | undefined;
}) {
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
          data-hero-stagger
          style={staggerStyle}
          className="text-[32px] leading-[1.1] tracking-[-0.02em] text-foreground sm:text-5xl sm:whitespace-nowrap"
        >
          The Accounts SDK
        </h1>
        <p
          data-hero-stagger
          style={staggerStyle}
          className="max-w-lg text-[16px] text-foreground-muted sm:text-xl"
        >
          The fastest way to build stablecoin-powered apps, wallets, and agentic workflows.
        </p>
      </div>

      <div
        data-hero-stagger
        style={staggerStyle}
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

      <div
        data-hero-stagger
        style={staggerStyle}
        className="mt-[-14px] flex items-center gap-5"
      >
        <Link
          to="/docs"
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
        </Link>
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

const Keyword = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "var(--syn-red)" }}>{children}</span>
);
const Str = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "var(--syn-blue)" }}>{children}</span>
);
const Fn = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "var(--syn-purple)" }}>{children}</span>
);
const Var = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "var(--syn-cyan)" }}>{children}</span>
);
const Hl = ({ children }: { children: React.ReactNode }) => (
  <span
    className="hl-token rounded-[4px] px-[5px]"
    style={{ animation: `highlightFlash 900ms ${easeOut} both` }}
  >
    {children}
  </span>
);

const codeFor: Record<Adapter, { connector: string; importPath: string }> = {
  tempoAuth: { connector: "tempoWallet", importPath: "wagmi/connectors" },
  webAuth: { connector: "webAuthConnector", importPath: "@tempo/web-auth" },
  privy: { connector: "privyConnector", importPath: "@privy-io/wagmi" },
  turnkey: { connector: "turnkeyConnector", importPath: "@turnkey/wagmi" },
};

function CodeBlock({ adapter }: { adapter: Adapter }) {
  const { connector, importPath } = codeFor[adapter];

  return (
    <pre
      className="code-pre scrollbar-hide max-h-[320px] overflow-auto font-mono text-[15px] leading-[1.5] text-code"
      style={{ tabSize: 2 }}
    >
      <code>
        <div>
          <Keyword>import</Keyword> {"{ createConfig, http } "}
          <Keyword>from</Keyword> <Str>{`'wagmi'`}</Str>
        </div>
        <div>
          <Keyword>import</Keyword> {"{ tempo } "}
          <Keyword>from</Keyword> <Str>{`'wagmi/chains'`}</Str>
        </div>
        <div>
          <Keyword>import</Keyword> {"{ "}
          <Hl key={`import-${adapter}`}>{connector}</Hl>
          {" } "}
          <Keyword>from</Keyword> <Str>{`'${importPath}'`}</Str>
        </div>
        <div>{" "}</div>
        <div>
          <Keyword>export const</Keyword> <Var>config</Var> <Keyword>=</Keyword>{" "}
          <Fn>createConfig</Fn>
          {"({"}
        </div>
        <div>{"  chains: [tempo],"}</div>
        <div>
          {"  connectors: ["}
          <Hl key={`use-${adapter}`}>
            <Fn>{connector}</Fn>
          </Hl>
          {"()],"}
        </div>
        <div>{"  transports: {"}</div>
        <div>
          {"    [tempo.id]: "}
          <Fn>http</Fn>
          {"(),"}
        </div>
        <div>{"  },"}</div>
        <div>{"})"}</div>
      </code>
    </pre>
  );
}

function AdapterTabs({
  adapter,
  setAdapter,
}: {
  adapter: Adapter;
  setAdapter: (a: Adapter) => void;
}) {
  const tabs: { id: Adapter; label: string }[] = [
    { id: "tempoAuth", label: "tempoAuth" },
    { id: "webAuth", label: "webAuth" },
    { id: "privy", label: "privy" },
    { id: "turnkey", label: "turnkey" },
  ];
  const tabsRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState({
    left: 0,
    width: 0,
    ready: false,
  });

  useEffect(() => {
    const container = tabsRef.current;
    if (!container) return;
    const button = container.querySelector<HTMLButtonElement>(
      `button[data-adapter="${adapter}"]`,
    );
    if (!button) return;
    setHighlight({
      left: button.offsetLeft,
      width: button.offsetWidth,
      ready: true,
    });
  }, [adapter]);

  return (
    <div className="flex items-stretch gap-3">
      <span className="flex items-center pr-1 font-mono text-[10px] tracking-[0.18em] text-foreground-subtle uppercase">
        Adapter
      </span>
      {
        /*
        Inactive pills get the dimmer bg from the row container itself
        (`bg-panel-0`). The active pill's brighter bg + border come
        from a single floating <span> that slides between positions —
        buttons are transparent so the slide reads through them.
      */
      }
      <div ref={tabsRef} className="relative flex items-center bg-panel-0">
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 border border-panel-edge bg-panel-1"
          style={{
            transform: `translateX(${highlight.left}px)`,
            width: highlight.width,
            opacity: highlight.ready ? 1 : 0,
            transition: highlight.ready
              ? `transform 280ms ${easeOut}, width 280ms ${easeOut}, opacity 200ms ease-out`
              : "opacity 200ms ease-out",
          }}
        />
        {tabs.map((t) => {
          const active = adapter === t.id;
          return (
            <button
              key={t.id}
              type="button"
              data-adapter={t.id}
              onClick={() => setAdapter(t.id)}
              className={`relative z-10 flex items-center justify-center px-2.5 py-1.5 font-mono text-[14px] outline-none focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-[color] duration-150 ${
                active ? "text-foreground" : "text-foreground-muted"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BalancesCard({
  status,
  address,
  balanceDisplay,
  onSignIn,
}: {
  status: "idle" | "running" | "done";
  address: string | null;
  balanceDisplay: string | null;
  onSignIn: () => void;
}) {
  const connected = !!address;
  const balances = [
    { sym: "USDC", value: "1,234.56" },
    { sym: "USDT", value: "567.89" },
    { sym: "ETH", value: "0.42" },
  ];
  const ringColors: Record<string, string> = {
    USDC: "var(--brand-usdc)",
    USDT: "var(--brand-usdt)",
    ETH: "var(--brand-eth)",
  };

  const cta = status === "running"
    ? "Opening Tempo…"
    : connected && address
    ? shorten(address)
    : "Sign in";

  return (
    <div className="flex w-full max-w-[420px] flex-col gap-5 bg-panel-2 p-6">
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-foreground-muted">Available balance</p>
        <p className="font-mono text-[28px] tabular-nums text-foreground">
          {connected ? (balanceDisplay ?? "$0.00") : "$0.00"}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-foreground-muted">Balances</p>
          <p className="text-[11px] text-foreground-subtle">View all</p>
        </div>
        <div className="flex flex-col gap-2">
          {balances.map((b, i) => (
            <div
              key={b.sym}
              className="flex items-center justify-between py-1"
            >
              <div className="flex items-center gap-2">
                {connected
                  ? (
                    <span
                      aria-hidden
                      className="grid size-[20px] shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white"
                      style={{ background: ringColors[b.sym] }}
                    >
                      {b.sym.slice(0, 1)}
                    </span>
                  )
                  : (
                    <span
                      aria-hidden
                      className="block size-[20px] shrink-0 rounded-full bg-panel-5"
                      style={{
                        animation: `pulseDot 1600ms ease-in-out ${i * 120}ms infinite`,
                      }}
                    />
                  )}
                {connected ? <span className="text-[13px] text-foreground">{b.sym}</span> : (
                  <span
                    aria-hidden
                    className="block h-3 w-14 bg-panel-5"
                    style={{
                      animation: `pulseDot 1600ms ease-in-out ${i * 120 + 80}ms infinite`,
                    }}
                  />
                )}
              </div>
              {connected
                ? (
                  <span className="font-mono text-[13px] tabular-nums text-foreground">
                    {b.value}
                  </span>
                )
                : (
                  <span
                    aria-hidden
                    className="block h-3 w-[46px] bg-panel-5"
                    style={{
                      animation: `pulseDot 1600ms ease-in-out ${i * 120 + 160}ms infinite`,
                    }}
                  />
                )}
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onSignIn}
        disabled={status === "running"}
        className="flex h-11 w-full items-center justify-center gap-2 bg-cta px-4 text-[14px] text-cta-fg outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 transition-opacity hover:opacity-90 disabled:cursor-progress disabled:opacity-80"
      >
        {status === "running"
          ? (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-cta-fg"
              style={{ animation: "pulseDot 900ms ease-in-out infinite" }}
            />
          )
          : null}
        <span>{cta}</span>
      </button>
    </div>
  );
}

// The hero's BalancesCard now leans on the shared `useTempoSession`, so
// signing in here carries across every section on the page (and vice
// versa). The adapter tab is illustrative for the code panel only —
// the shared landing demo Wagmi config handles the actual sign-in flow.

function DemoSplit() {
  const [adapter, setAdapter] = useState<Adapter>("tempoAuth");
  const { status, address, balanceDisplay, run } = useTempoSession();

  const handleAdapterChange = (next: Adapter) => {
    if (next === adapter) return;
    setAdapter(next);
  };

  const signIn = () => {
    void run(async (provider) => {
      const address = await connectWallet(provider);
      return {
        summary: address ? `Signed in · ${shorten(address)}` : "Signed in",
      };
    });
  };

  return (
    <section className="relative px-6 pt-20 pb-0 sm:pt-[80px]">
      <div className="flex flex-col items-center gap-3 text-center">
        <h2
          className="text-[32px] leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[48px] sm:whitespace-nowrap"
          style={{ animation: `fadeUp 600ms ${easeOut} 0ms both` }}
        >
          Bring your own wallet provider
        </h2>
        <p
          className="max-w-[520px] text-[16px] text-foreground-muted sm:text-[20px]"
          style={{ animation: `fadeUp 600ms ${easeOut} 80ms both` }}
        >
          Accounts SDK is provider-agnostic. Bring your own wallet. Keep the same SDK.
        </p>
      </div>
      <div
        className="-mx-6 mt-8 grid grid-cols-1 sm:mt-12 lg:grid-cols-[1fr_626px]"
        style={{ animation: `fadeUp 700ms ${easeOut} 120ms both` }}
      >
        <div className="flex flex-col gap-10 bg-panel-0 px-9 py-[26px] lg:min-h-[540px]">
          <AdapterTabs adapter={adapter} setAdapter={handleAdapterChange} />
          <CodeBlock adapter={adapter} />
          <div className="-mx-9 -mb-[26px] mt-auto">
            <div className="bg-panel-1 px-5 py-5">
              <div key={adapter} className="flex flex-col gap-2">
                <p
                  className="text-[14px] text-foreground"
                  style={{ animation: `fadeUp 360ms ${easeOut} 0ms both` }}
                >
                  {adapterInfo[adapter].title}
                </p>
                <p
                  className="text-[12px] text-foreground-muted"
                  style={{ animation: `fadeUp 360ms ${easeOut} 80ms both` }}
                >
                  {adapterInfo[adapter].description}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="dash-l relative flex items-center justify-center overflow-hidden bg-background px-6 py-12 lg:min-h-[540px]">
          <AsciiBackground />
          <div className="relative z-10 w-full max-w-[420px]">
            <BalancesCard
              status={status}
              address={address}
              balanceDisplay={balanceDisplay}
              onSignIn={signIn}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Hero({ children }: { children?: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [staggerReady, setStaggerReady] = useState(false);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const items = root.querySelectorAll<HTMLElement>("[data-hero-stagger]");
    const navItems = root.querySelectorAll<HTMLElement>(
      "[data-hero-nav-stagger]",
    );
    if (items.length === 0 && navItems.length === 0) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) {
      setStaggerReady(true);
      return;
    }

    const animations: WAAPIAnimation[] = [];
    if (items.length > 0) {
      animations.push(
        waapi.animate(items, {
          opacity: [0, 1],
          translate: ["0 10px", "0 0"],
          delay: stagger(HERO_ENTRANCE_STAGGER_MS),
          ease: springs.entrance,
        }),
      );
    }
    if (navItems.length > 0) {
      const start = items.length * HERO_ENTRANCE_STAGGER_MS + HERO_NAV_DELAY_MS;
      navItems.forEach((item, i) => {
        const fall = HERO_NAV_FALLS[i] ?? HERO_NAV_DEFAULT_FALL;
        animations.push(
          waapi.animate(item, {
            opacity: [0, 1],
            translate: [fall.translate, "0 0"],
            delay: start + fall.delay,
            ease: springs.navEntrance,
          }),
        );
      });
    }

    let disposed = false;
    void Promise.all(
      animations.map((animation) => animation.then(() => undefined)),
    ).then(() => {
      if (disposed) return;
      setStaggerReady(true);
    });

    return () => {
      disposed = true;
      for (const animation of animations) animation.cancel();
    };
  }, []);

  const staggerStyle = staggerReady ? undefined : heroEntranceInitialStyle;
  const navStaggerStyles = staggerReady
    ? []
    : HERO_NAV_FALLS.map((fall) => heroNavStyle(fall));

  return (
    <div ref={rootRef}>
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
        >
          <AsciiBackground />
        </div>
        <div className="relative">
          <TopNav navStaggerStyles={navStaggerStyles} />
          <HeroIntro staggerStyle={staggerStyle} />
        </div>
      </div>
      {children
        ? (
          <div data-hero-stagger style={staggerStyle}>
            {children}
          </div>
        )
        : null}
    </div>
  );
}

// Re-exported so page.tsx can position the adapter / code / balances panel
// below the main browser-mockup demo section.
export { DemoSplit };
