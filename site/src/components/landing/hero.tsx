"use client";
import { useEffect, useRef, useState } from "react";
import { Provider } from "accounts";
import AsciiBackground from "./ascii-bg";
import {
  createProvider,
  defaultAuthorizeAccessKey,
  isTrustedHost,
} from "./demo/sdk";

type AccountsProvider = ReturnType<typeof Provider.create>;

type PackageManager = "npm" | "pnpm" | "bun";
type Adapter = "tempoAuth" | "webAuth" | "privy";
type SignInStatus = "idle" | "opening" | "connected";

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
        className="grid size-12 place-items-center bg-black"
      >
        <img
          src="/icons/tempo-logo.svg"
          alt=""
          width={20}
          height={21}
         
        />
      </a>
      <div className="flex items-center gap-7 px-3">
        <a
          href="https://tempo.xyz/docs"
          className="flex items-center gap-2 text-[12px] text-white outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75"
        >
          <img src="/icons/docs.svg" alt="" width={16} height={16} />
          DOCS
        </a>
        <a
          href="https://github.com/tempoxyz"
          className="flex items-center gap-2 text-[12px] text-white outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75"
        >
          <img src="/icons/github.svg" alt="" width={16} height={16} />
          GITHUB
        </a>
      </div>
    </nav>
  );
}

function HeroIntro() {
  const [pmIndex, setPmIndex] = useState(0);
  const [prefixOpacity, setPrefixOpacity] = useState(1);
  const [paused, setPaused] = useState(false);
  const { copied: copiedInstall, copy: copyInstall } = useCopy();
  const { copied: copiedAgent, copy: copyAgent } = useCopy();
  const pm = PACKAGE_MANAGERS[pmIndex];
  const cmd = installCommand[pm];
  const fullCommand = `${cmd.prefix} ${cmd.pkg}`;

  useEffect(() => {
    if (paused) return;
    let swap: ReturnType<typeof setTimeout> | null = null;
    const cycle = setInterval(() => {
      setPrefixOpacity(0);
      swap = setTimeout(() => {
        setPmIndex((i) => (i + 1) % PACKAGE_MANAGERS.length);
        setPrefixOpacity(1);
      }, 240);
    }, 2400);
    return () => {
      clearInterval(cycle);
      if (swap) clearTimeout(swap);
    };
  }, [paused]);

  return (
    <div
      className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-9 px-6 pt-12 pb-20 sm:pt-[60px]"
      style={{ animation: `fadeUp 600ms ${easeOut} 80ms both` }}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-[32px] leading-[1.1] tracking-[-0.02em] text-white sm:text-5xl sm:whitespace-nowrap">
          Stablecoin Accounts SDK
        </h1>
        <p className="max-w-xl text-[16px] text-white/50 sm:text-xl">
          The fastest way to add stablecoins to your application
        </p>
      </div>

      <div className="flex w-full max-w-[560px]">
        <div
          className="flex w-full items-center justify-between bg-[#141414] px-4 py-3"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <p className="flex items-baseline font-mono text-[16px]">
            <span
              className="block overflow-hidden whitespace-nowrap text-white/25"
              style={{
                opacity: prefixOpacity,
                width: `${cmd.prefix.length}ch`,
                transition: `opacity 240ms ${easeOut}, width 240ms ${easeOut}`,
              }}
            >
              {cmd.prefix}
            </span>
            <span className="pl-[1ch] text-white">{cmd.pkg}</span>
          </p>
          <button
            type="button"
            onClick={() => copyInstall(fullCommand)}
            aria-label={copiedInstall ? "Copied" : `Copy ${fullCommand}`}
            className="grid size-[18px] place-items-center outline-none transition-opacity hover:opacity-75 focus-visible:opacity-75"
          >
            {copiedInstall ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                aria-hidden
              >
                <path
                  d="M3.75 9.5L7.25 13L14.25 5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-white"
                />
              </svg>
            ) : (
              <img src="/icons/copy.svg" alt="" width={18} height={18} />
            )}
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => copyAgent(agentInstructions)}
        className="mt-[-14px] flex items-center gap-1 text-[12px] text-white/50 outline-none transition-colors hover:text-white focus-visible:text-white"
      >
        <img src="/icons/agent-copy.svg" alt="" width={16} height={16} />
        {copiedAgent ? "Copied" : "Copy instructions for my agent"}
      </button>
    </div>
  );
}

const Keyword = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "#f47066" }}>{children}</span>
);
const Str = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "#96d0ff" }}>{children}</span>
);
const Fn = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "#dcbdfb" }}>{children}</span>
);
const Var = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "#6db6ff" }}>{children}</span>
);
const Hl = ({ children }: { children: React.ReactNode }) => (
  <span
    className="hl-token rounded-[3px] px-[3px]"
    style={{
      background: "rgba(255, 255, 255, 0.05)",
      boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
      animation: `highlightFlash 900ms ${easeOut} both`,
    }}
  >
    {children}
  </span>
);

function CodeBlock({ adapter }: { adapter: Adapter }) {
  const connector =
    adapter === "tempoAuth"
      ? "tempoWallet"
      : adapter === "webAuth"
        ? "webAuthConnector"
        : "privyConnector";
  const importPath =
    adapter === "tempoAuth"
      ? "wagmi/connectors"
      : adapter === "webAuth"
        ? "@tempo/web-auth"
        : "@privy-io/wagmi";

  return (
    <pre
      className="code-pre overflow-x-auto font-mono text-[15px] leading-[1.5] text-[#adbac7]"
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
    <div className="flex items-center gap-3">
      <span className="font-mono text-[14px] text-white/50">Adapter</span>
      <span aria-hidden className="font-mono text-[14px] text-white/20">
        |
      </span>
      {/*
        Inactive pills get the dimmer bg from the row container itself
        (`bg-[#0c0c0c]`). The active pill's brighter bg + border come
        from a single floating <span> that slides between positions —
        buttons are transparent so the slide reads through them.
      */}
      <div ref={tabsRef} className="relative flex items-center bg-[#0c0c0c]">
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 border bg-[#141414]"
          style={{
            transform: `translateX(${highlight.left}px)`,
            width: highlight.width,
            borderColor: "#2e2e2e",
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
              className="relative z-10 flex items-center justify-center px-2.5 py-1.5 font-mono text-[14px] outline-none transition-colors duration-150"
              style={{
                color: active ? "#ffffff" : "rgba(255,255,255,0.5)",
              }}
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
  onSignIn,
}: {
  status: SignInStatus;
  address: string | null;
  onSignIn: () => void;
}) {
  const connected = status === "connected" && !!address;
  const balances = [
    { sym: "USDC", value: "1,234.56" },
    { sym: "USDT", value: "567.89" },
    { sym: "ETH", value: "0.42" },
  ];
  const ringColors: Record<string, string> = {
    USDC: "#2775ca",
    USDT: "#26a17b",
    ETH: "#627eea",
  };

  return (
    <div className="flex h-[384px] w-full max-w-[358px] flex-col justify-between border-[0.7px] border-solid border-[#2e2e2e] bg-[#141414] p-[12.7px]">
      <div className="flex flex-col">
        <div className="flex items-center justify-between pb-3">
          <p className="text-[11.336px] tracking-[0.1134px] text-[#ededed]">
            Balances
          </p>
          <p className="text-[9.919px] tracking-[0.0992px] text-[#a1a1a1]">
            View all
          </p>
        </div>
        <div className="flex flex-col gap-3 pb-2">
          {balances.map((b, i) => (
            <div
              key={b.sym}
              className="flex items-center justify-between py-[3px]"
            >
              <div className="flex items-center gap-2">
                {connected ? (
                  <span
                    aria-hidden
                    className="grid size-[18px] shrink-0 place-items-center rounded-full text-[8px] font-semibold text-white"
                    style={{ background: ringColors[b.sym] }}
                  >
                    {b.sym.slice(0, 1)}
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className="block size-[18px] shrink-0 rounded-full bg-[#292929]"
                    style={{
                      animation: `pulseDot 1600ms ease-in-out ${i * 120}ms infinite`,
                    }}
                  />
                )}
                {connected ? (
                  <span className="text-[11px] text-[#ededed]">{b.sym}</span>
                ) : (
                  <span
                    aria-hidden
                    className="block h-3 w-14 bg-[#292929]"
                    style={{
                      animation: `pulseDot 1600ms ease-in-out ${i * 120 + 80}ms infinite`,
                    }}
                  />
                )}
              </div>
              {connected ? (
                <span className="font-mono text-[11px] tabular-nums text-[#ededed]">
                  {b.value}
                </span>
              ) : (
                <span
                  aria-hidden
                  className="block h-3 w-[46px] bg-[#292929]"
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
        disabled={status === "opening"}
        className="flex h-9 w-full items-center justify-center gap-2 bg-white text-[11.336px] tracking-[0.1134px] text-[#181818] outline-none transition-opacity duration-200 hover:opacity-90 focus-visible:opacity-90 disabled:cursor-progress"
      >
        {status === "opening" ? (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-[#181818]"
            style={{ animation: "pulseDot 900ms ease-in-out infinite" }}
          />
        ) : null}
        <span>
          {status === "opening"
            ? "Opening Tempo…"
            : connected && address
              ? shorten(address)
              : "Sign in"}
        </span>
      </button>
    </div>
  );
}

// Provider construction lives in `./demo/sdk` so the hero's BalancesCard
// shares the same persistent session (`Storage.combine(cookie, localStorage)`)
// with the demo section below — sign in once, see it everywhere.

function DemoSplit() {
  const [adapter, setAdapter] = useState<Adapter>("tempoAuth");
  const [status, setStatus] = useState<SignInStatus>("idle");
  const [address, setAddress] = useState<string | null>(null);
  const providerRef = useRef<AccountsProvider | null>(null);
  const providerAdapterRef = useRef<Adapter | null>(null);

  // Hydrate from persisted storage on mount / adapter switch so a refresh
  // restores the connected state instead of resetting to "Sign in".
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        if (providerAdapterRef.current !== adapter) {
          providerRef.current = createProvider(adapter);
          providerAdapterRef.current = adapter;
        }
        const accounts = (await providerRef.current!.request({
          method: "eth_accounts",
        })) as readonly `0x${string}`[];
        if (cancelled) return;
        if (accounts && accounts.length > 0) {
          setAddress(accounts[0]);
          setStatus("connected");
        }
      } catch {
        // No persisted session — leave UI at idle.
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  const handleAdapterChange = (next: Adapter) => {
    if (next === adapter) return;
    setAdapter(next);
    providerRef.current = null;
    providerAdapterRef.current = null;
    setStatus("idle");
    setAddress(null);
  };

  const signIn = async () => {
    if (status === "opening") return;
    setStatus("opening");

    if (providerAdapterRef.current !== adapter) {
      providerRef.current = createProvider(adapter);
      providerAdapterRef.current = adapter;
    }

    try {
      // Same lazy access-key gating as the demo section: include only
      // when we're on a *.tempo.xyz host, where the wallet validator
      // bypasses the "must include scopes" check.
      const capabilities: Record<string, unknown> = {
        method: "register",
        name: "Accounts SDK",
      };
      if (isTrustedHost()) {
        capabilities.authorizeAccessKey = defaultAuthorizeAccessKey();
      }
      const result = (await providerRef.current!.request({
        method: "wallet_connect",
        params: [{ capabilities } as Record<string, unknown>],
      } as Parameters<
        NonNullable<typeof providerRef.current>["request"]
      >[0])) as { accounts?: ReadonlyArray<{ address: `0x${string}` }> };
      const account = result?.accounts?.[0];
      if (!account) throw new Error("No account returned.");
      setAddress(account.address);
      setStatus("connected");
    } catch {
      setStatus(address ? "connected" : "idle");
    }
  };

  return (
    <section className="relative px-6 pt-20 pb-0 sm:pt-[80px]">
      <div className="flex flex-col items-center gap-3 text-center">
        <h2
          className="text-[32px] leading-[1.1] tracking-[-0.02em] text-white sm:text-[48px] sm:whitespace-nowrap"
          style={{ animation: `fadeUp 600ms ${easeOut} 0ms both` }}
        >
          Bring your own adapter
        </h2>
        <p
          className="max-w-[560px] text-[16px] text-white/70 sm:text-[20px]"
          style={{ animation: `fadeUp 600ms ${easeOut} 80ms both` }}
        >
          Tempo dialog, WebAuthn, or your own. Same SDK surface.
        </p>
      </div>
      <div
        className="-mx-6 mt-8 grid grid-cols-1 sm:mt-12 lg:grid-cols-[1fr_626px]"
        style={{ animation: `fadeUp 700ms ${easeOut} 120ms both` }}
      >
        <div className="flex flex-col gap-10 bg-[#0c0c0c] px-9 py-[26px] lg:min-h-[540px]">
          <AdapterTabs adapter={adapter} setAdapter={handleAdapterChange} />
          <CodeBlock adapter={adapter} />
          <div className="-mx-9 -mb-[26px] mt-auto">
            <div className="bg-[#141414] px-9 py-5">
              <div key={adapter} className="flex flex-col gap-2">
                <p
                  className="text-[14px] text-white"
                  style={{ animation: `fadeUp 360ms ${easeOut} 0ms both` }}
                >
                  {adapterInfo[adapter].title}
                </p>
                <p
                  className="text-[12px] text-white/50"
                  style={{ animation: `fadeUp 360ms ${easeOut} 80ms both` }}
                >
                  {adapterInfo[adapter].description}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="dash-l relative flex items-center justify-center overflow-hidden bg-[#0a0a0a] px-6 py-12 lg:min-h-[540px]">
          <AsciiBackground />
          <div className="relative z-10 w-full max-w-[358px]">
            <BalancesCard status={status} address={address} onSignIn={signIn} />
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
