"use client";

import { useEffect, useRef, useState } from "react";
import AsciiBackground from "./ascii-bg";
import { defaultAuthorizeAccessKey, isTrustedHost } from "./demo/sdk";
import {
  AgentCopyIcon,
  CopyIcon,
  DocsIcon,
  GithubIcon,
  TempoLogo,
} from "./icons";
import { useTempoSession } from "./sections/useTempoSession";
import { ThemeSwitch } from "./theme-switch";

type PackageManager = "npm" | "pnpm" | "bun";
type Adapter = "tempoAuth" | "webAuth" | "privy" | "turnkey";

const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";

const installCommand: Record<PackageManager, { prefix: string; pkg: string }> =
  {
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

function TopNav() {
  return (
    <nav
      className="flex items-center justify-between px-6 py-6"
      style={{ animation: `fadeUp 480ms ${easeOut} 0ms both` }}
    >
      <a
        href="/"
        aria-label="Tempo"
        className="grid size-12 place-items-center bg-background text-foreground"
      >
        <TempoLogo width={20} height={21} />
      </a>
      <div className="flex items-center gap-7 px-3">
        <a
          href="https://docs.tempo.xyz/accounts"
          className="flex items-center gap-2 text-[12px] text-foreground outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75"
        >
          <DocsIcon />
          DOCS
        </a>
        <a
          href="https://github.com/tempoxyz/accounts"
          className="flex items-center gap-2 text-[12px] text-foreground outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75"
        >
          <GithubIcon />
          GITHUB
        </a>
        <ThemeSwitch />
      </div>
    </nav>
  );
}

const PM_SWAP_MS = 280;

function HeroIntro() {
  const [pmIndex, setPmIndex] = useState(0);
  const [outgoingIndex, setOutgoingIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const { copied: copiedInstall, copy: copyInstall } = useCopy();
  const { copied: copiedAgent, copy: copyAgent } = useCopy();
  const pm = PACKAGE_MANAGERS[pmIndex] ?? "npm";
  const cmd = installCommand[pm];
  const fullCommand = `${cmd.prefix} ${cmd.pkg}`;
  const outgoingPrefix =
    outgoingIndex != null
      ? (installCommand[PACKAGE_MANAGERS[outgoingIndex] ?? "npm"]?.prefix ??
        null)
      : null;

  useEffect(() => {
    if (paused) return;
    const cycle = setInterval(() => {
      setOutgoingIndex((prev) => (prev == null ? pmIndex : prev));
      setPmIndex((i) => (i + 1) % PACKAGE_MANAGERS.length);
    }, 2200);
    return () => clearInterval(cycle);
  }, [paused, pmIndex]);

  useEffect(() => {
    if (outgoingIndex == null) return;
    const t = setTimeout(() => setOutgoingIndex(null), PM_SWAP_MS + 40);
    return () => clearTimeout(t);
  }, [outgoingIndex, pmIndex]);

  return (
    <div
      className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-9 px-6 pt-12 pb-20 sm:pt-[60px]"
      style={{ animation: `fadeUp 600ms ${easeOut} 80ms both` }}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] text-foreground sm:text-5xl sm:whitespace-nowrap">
          Accounts SDK
        </h1>
        <p className="max-w-lg text-[16px] text-foreground-muted sm:text-xl">
          The fastest way to build stablecoin-powered apps, wallets, and agentic
          workflows.
        </p>
      </div>

      <div className="flex w-full max-w-[560px]">
        <div
          className="flex w-full items-center justify-between bg-panel-1 px-4 py-3"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <p className="flex items-baseline font-mono text-[16px]">
            <span
              className="overflow-hidden whitespace-nowrap"
              style={{
                display: "inline-grid",
                width: `${cmd.prefix.length}ch`,
                transition: `width ${PM_SWAP_MS}ms ${easeOut}`,
                verticalAlign: "baseline",
              }}
            >
              <span
                key={`in-${pmIndex}`}
                className="text-foreground-subtle"
                style={{
                  gridArea: "1 / 1",
                  animation: `pmSlideIn ${PM_SWAP_MS}ms ${easeOut} both`,
                  willChange: "transform, opacity, filter",
                }}
              >
                {cmd.prefix}
              </span>
              {outgoingPrefix != null ? (
                <span
                  key={`out-${outgoingIndex}-${pmIndex}`}
                  aria-hidden
                  className="text-foreground-subtle"
                  style={{
                    gridArea: "1 / 1",
                    animation: `pmSlideOut ${PM_SWAP_MS}ms ${easeOut} both`,
                    willChange: "transform, opacity, filter",
                  }}
                >
                  {outgoingPrefix}
                </span>
              ) : null}
            </span>
            <span className="pl-[1ch] text-foreground">{cmd.pkg}</span>
          </p>
          <button
            type="button"
            onClick={() => copyInstall(fullCommand)}
            aria-label={copiedInstall ? "Copied" : `Copy ${fullCommand}`}
            className="grid size-[18px] place-items-center text-foreground outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75"
          >
            {copiedInstall ? (
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
            ) : (
              <CopyIcon className="text-foreground" />
            )}
          </button>
        </div>
      </div>

      <div className="mt-[-14px] flex items-center gap-5">
        <a
          href="https://docs.tempo.xyz/accounts"
          className="flex items-center gap-1.5 text-[12px] text-foreground outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75"
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
        <button
          type="button"
          onClick={() => copyAgent(agentInstructions)}
          className="flex items-center gap-1 text-[12px] text-foreground-muted outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
        >
          <AgentCopyIcon />
          {copiedAgent ? "Copied" : "Copy instructions for my agent"}
        </button>
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
      {/*
        Inactive pills get the dimmer bg from the row container itself
        (`bg-panel-0`). The active pill's brighter bg + border come
        from a single floating <span> that slides between positions —
        buttons are transparent so the slide reads through them.
      */}
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
              className={`relative z-10 flex items-center justify-center px-2.5 py-1.5 font-mono text-[14px] outline-none transition-colors duration-150 ${active ? "text-foreground" : "text-foreground-muted"}`}
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

  const cta =
    status === "running"
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
                {connected ? (
                  <span
                    aria-hidden
                    className="grid size-[20px] shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white"
                    style={{ background: ringColors[b.sym] }}
                  >
                    {b.sym.slice(0, 1)}
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className="block size-[20px] shrink-0 rounded-full bg-panel-5"
                    style={{
                      animation: `pulseDot 1600ms ease-in-out ${i * 120}ms infinite`,
                    }}
                  />
                )}
                {connected ? (
                  <span className="text-[13px] text-foreground">{b.sym}</span>
                ) : (
                  <span
                    aria-hidden
                    className="block h-3 w-14 bg-panel-5"
                    style={{
                      animation: `pulseDot 1600ms ease-in-out ${i * 120 + 80}ms infinite`,
                    }}
                  />
                )}
              </div>
              {connected ? (
                <span className="font-mono text-[13px] tabular-nums text-foreground">
                  {b.value}
                </span>
              ) : (
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
        className="flex h-11 w-full items-center justify-center gap-2 bg-cta px-4 text-[14px] text-cta-fg outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:cursor-progress disabled:opacity-80"
      >
        {status === "running" ? (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-cta-fg"
            style={{ animation: "pulseDot 900ms ease-in-out infinite" }}
          />
        ) : null}
        <span>{cta}</span>
      </button>
    </div>
  );
}

// The hero's BalancesCard now leans on the shared `useTempoSession`, so
// signing in here carries across every section on the page (and vice
// versa). The adapter tab is illustrative for the code panel only —
// `buildAdapter` in `demo/sdk.ts` already routes non-webAuth adapters
// through the Tempo dialog for the actual sign-in flow.

function DemoSplit() {
  const [adapter, setAdapter] = useState<Adapter>("tempoAuth");
  const { status, address, balanceDisplay, run } = useTempoSession();

  const handleAdapterChange = (next: Adapter) => {
    if (next === adapter) return;
    setAdapter(next);
  };

  const signIn = () => {
    void run(async (provider) => {
      const capabilities: Record<string, unknown> = {
        method: "register",
        name: "Accounts SDK",
      };
      if (isTrustedHost())
        capabilities.authorizeAccessKey = defaultAuthorizeAccessKey();
      const result = (await provider.request({
        method: "wallet_connect",
        params: [{ capabilities } as Record<string, unknown>],
      } as Parameters<typeof provider.request>[0])) as {
        accounts?: ReadonlyArray<{ address: `0x${string}` }>;
      };
      const account = result?.accounts?.[0];
      return {
        summary: account
          ? `Signed in · ${shorten(account.address)}`
          : "Signed in",
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
          Accounts SDK is provider-agnostic. Bring your own wallet. Keep the
          same SDK.
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

export default function Hero() {
  return (
    <>
      <TopNav />
      <HeroIntro />
    </>
  );
}

// Re-exported so page.tsx can position the adapter / code / balances panel
// below the main browser-mockup demo section.
export { DemoSplit };
