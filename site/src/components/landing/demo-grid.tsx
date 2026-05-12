"use client";
import { useRef, useState } from "react";
import { Provider, Storage, tempoWallet } from "accounts";
import type { Theme } from "./themes";

type AccountsProvider = ReturnType<typeof Provider.create>;
type Status = "idle" | "opening" | "connected";

function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

type CardProps = {
  theme: Theme;
  status: Status;
  ctaLabel: string;
};

function CtaButton({
  label,
  status,
  background,
  color,
  className,
}: {
  label: string;
  status: Status;
  background: string;
  color: string;
  className: string;
}) {
  return (
    <div
      className={`flex items-center justify-center gap-2 transition-opacity duration-200 ease-out ${className}`}
      style={{
        background,
        color,
        opacity: status === "opening" ? 0.9 : 1,
      }}
    >
      {status === "opening" ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{
            background: color,
            animation: "pulseDot 900ms ease-in-out infinite",
          }}
        />
      ) : null}
      <span className="min-w-0 truncate font-mono text-[13px] tracking-tight tabular-nums">
        {label}
      </span>
    </div>
  );
}

function DoorDashCard({ theme, status, ctaLabel }: CardProps) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_0_rgba(0,0,0,0.04),0_10px_30px_-18px_rgba(0,0,0,0.4),inset_0_0_0_1px_rgba(0,0,0,0.06)] transition-shadow duration-200 ease-out group-hover:shadow-[0_1px_0_rgba(0,0,0,0.04),0_24px_56px_-22px_rgba(235,23,0,0.32),inset_0_0_0_1px_rgba(0,0,0,0.06)]">
      <div
        className="flex items-center justify-between px-5 py-2.5"
        style={{ background: theme.swatch }}
      >
        <span className="text-[11px] font-bold tracking-[0.16em] text-white">
          DOORDASH
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/75">
          {theme.scenario.context}
        </span>
      </div>
      <div className="flex flex-col gap-3 p-5">
        <div>
          <p className="text-base font-semibold tracking-[-0.01em] text-[#191919]">
            {theme.scenario.title}
          </p>
          <p className="mt-0.5 text-xs text-[#6f6f6f]">
            {theme.scenario.detail}
          </p>
        </div>
        <div className="flex items-baseline justify-between border-t border-black/5 pt-2.5">
          <span className="text-xs text-[#6f6f6f]">Subtotal</span>
          <span className="text-lg font-bold tabular-nums text-[#191919]">
            {theme.scenario.amount}
          </span>
        </div>
        <CtaButton
          label={ctaLabel}
          status={status}
          background={theme.swatch}
          color="#ffffff"
          className="h-11 rounded-lg"
        />
      </div>
    </div>
  );
}

function ClaudeCard({ theme, status, ctaLabel }: CardProps) {
  const serif = { fontFamily: 'Georgia, "Times New Roman", serif' };
  return (
    <div className="overflow-hidden rounded-3xl bg-[#f6f0e8] shadow-[0_1px_0_rgba(101,77,49,0.06),0_10px_30px_-18px_rgba(101,77,49,0.22),inset_0_0_0_1px_rgba(217,119,87,0.12)] transition-shadow duration-200 ease-out group-hover:shadow-[0_1px_0_rgba(101,77,49,0.08),0_24px_56px_-22px_rgba(217,119,87,0.32),inset_0_0_0_1px_rgba(217,119,87,0.18)]">
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <span
            className="text-[15px] italic tracking-[-0.01em] text-[#2f261f]"
            style={serif}
          >
            Claude
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#7f746b]">
            {theme.scenario.context}
          </span>
        </div>
        <div>
          <p
            className="text-[26px] leading-tight tracking-[-0.02em] text-[#2f261f]"
            style={serif}
          >
            {theme.scenario.title}
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#7f746b]">
            {theme.scenario.detail}
          </p>
        </div>
        <div className="flex items-baseline justify-between border-t border-[#d9cfc1] pt-3">
          <span className="text-xs text-[#7f746b]">Plan</span>
          <span className="text-base font-medium tabular-nums text-[#2f261f]">
            {theme.scenario.amount}
          </span>
        </div>
        <CtaButton
          label={ctaLabel}
          status={status}
          background={theme.swatch}
          color={theme.buttonText}
          className="h-11 rounded-xl font-medium"
        />
      </div>
    </div>
  );
}

function LinearCard({ theme, status, ctaLabel }: CardProps) {
  const teamMembers: { initial: string; bg: string }[] = [
    { initial: "M", bg: "#7f6df2" },
    { initial: "A", bg: "#26b5ce" },
    { initial: "P", bg: "#f2994a" },
    { initial: "K", bg: "#eb5757" },
  ];
  return (
    <div className="overflow-hidden rounded-xl bg-[#1c1c24] shadow-[0_1px_0_rgba(255,255,255,0.04),0_10px_30px_-18px_rgba(0,0,0,0.55),inset_0_0_0_1px_rgba(255,255,255,0.06)] transition-shadow duration-200 ease-out group-hover:shadow-[0_1px_0_rgba(255,255,255,0.06),0_22px_48px_-20px_rgba(94,106,210,0.4),inset_0_0_0_1px_rgba(255,255,255,0.1)]">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-[#5e6ad2]"
            />
            <span className="font-medium text-[#f6f6f8]">Acme</span>
            <span className="text-[#5b5d68]">/</span>
            <span className="text-[#8a8c98]">Settings</span>
            <span className="text-[#5b5d68]">/</span>
            <span className="truncate text-[#8a8c98]">Members</span>
          </div>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[#8a8c98]">
            {theme.scenario.context}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex -space-x-1">
            {teamMembers.map((m) => (
              <div
                key={m.initial}
                className="flex size-5 items-center justify-center rounded-full border border-[#1c1c24] text-[9px] font-semibold text-white"
                style={{ background: m.bg }}
              >
                {m.initial}
              </div>
            ))}
            <div className="flex size-5 items-center justify-center rounded-full border border-[#1c1c24] bg-[#5e6ad2] text-[9px] font-semibold text-white">
              +1
            </div>
          </div>
          <span className="text-[13px] font-medium text-[#f6f6f8]">
            {theme.scenario.title}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-[#8a8c98]">
            {theme.scenario.detail}
          </span>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-[#f6f6f8]">
            +{theme.scenario.amount}
          </span>
        </div>
        <CtaButton
          label={ctaLabel}
          status={status}
          background={theme.swatch}
          color="#ffffff"
          className="h-9 rounded-md"
        />
      </div>
    </div>
  );
}

function CashCard({ theme, status, ctaLabel }: CardProps) {
  const initial = theme.scenario.title.charAt(0);
  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-[0_1px_0_rgba(0,210,79,0.08),0_10px_30px_-18px_rgba(0,86,32,0.28),inset_0_0_0_1px_rgba(0,210,79,0.16)] transition-shadow duration-200 ease-out group-hover:shadow-[0_1px_0_rgba(0,210,79,0.12),0_24px_56px_-22px_rgba(0,210,79,0.4),inset_0_0_0_1px_rgba(0,210,79,0.22)]">
      <div className="flex flex-col items-center gap-3 p-5">
        <div className="flex w-full items-start justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#5d6a64]">
            Cash App
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#5d6a64]">
            {theme.scenario.context}
          </span>
        </div>
        <div
          className="flex size-12 items-center justify-center rounded-full text-lg font-bold text-white"
          style={{ background: theme.swatch }}
          aria-hidden
        >
          {initial}
        </div>
        <div className="text-center">
          <p className="text-[15px] font-semibold text-[#031601]">
            {theme.scenario.title}
          </p>
          <p className="text-xs text-[#5d6a64]">{theme.scenario.detail}</p>
        </div>
        <p className="text-4xl font-bold tracking-[-0.04em] tabular-nums text-[#031601]">
          {theme.scenario.amount}
        </p>
        <CtaButton
          label={ctaLabel}
          status={status}
          background={theme.swatch}
          color="#ffffff"
          className="mt-1 h-11 w-full rounded-full font-semibold"
        />
      </div>
    </div>
  );
}

function NotionCard({ theme, status, ctaLabel }: CardProps) {
  const items = theme.scenario.detail.split(" · ");
  return (
    <div className="overflow-hidden rounded-md bg-[#fbfaf7] shadow-[0_1px_0_rgba(0,0,0,0.03),0_10px_30px_-18px_rgba(0,0,0,0.18),inset_0_0_0_1px_rgba(15,15,15,0.08)] transition-shadow duration-200 ease-out group-hover:shadow-[0_1px_0_rgba(0,0,0,0.03),0_22px_48px_-20px_rgba(0,0,0,0.28),inset_0_0_0_1px_rgba(15,15,15,0.14)]">
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-[0.04em] text-[#787774]">
            acme.notion.so
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#787774]">
            {theme.scenario.context}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-5 shrink-0 place-items-center rounded-[3px] bg-[#191919] text-[10px] font-bold leading-none text-white"
          >
            N
          </span>
          <p className="text-[15px] font-semibold tracking-[-0.01em] text-[#191919]">
            {theme.scenario.title}
          </p>
        </div>
        <ul className="space-y-1 text-[13px] text-[#787774]">
          {items.map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-1 shrink-0 rounded-full bg-current"
              />
              {item}
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between border-t border-black/8 pt-2">
          <span className="text-xs text-[#787774]">Per editor</span>
          <span className="text-[15px] font-semibold tabular-nums text-[#191919]">
            {theme.scenario.amount}
          </span>
        </div>
        <CtaButton
          label={ctaLabel}
          status={status}
          background={theme.swatch}
          color="#ffffff"
          className="h-9 rounded-md font-medium"
        />
      </div>
    </div>
  );
}

function FallbackCard({ theme, status, ctaLabel }: CardProps) {
  return (
    <div
      className="overflow-hidden rounded-2xl shadow-[0_1px_0_rgba(255,255,255,0.04),0_10px_30px_-18px_rgba(0,0,0,0.55),inset_0_0_0_1px_rgba(255,255,255,0.06)] transition-shadow duration-200 ease-out"
      style={{ background: theme.surface, color: theme.foreground }}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="size-5 rounded-full"
              style={{
                background: theme.swatch,
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
              }}
            />
            <span className="text-sm font-medium tracking-[-0.01em]">
              {theme.name}
            </span>
          </div>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{ color: theme.muted }}
          >
            {theme.scenario.context}
          </span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-base font-medium tracking-[-0.015em]">
              {theme.scenario.title}
            </p>
            <p
              className="mt-0.5 truncate text-sm"
              style={{ color: theme.muted }}
            >
              {theme.scenario.detail}
            </p>
          </div>
          <p className="shrink-0 font-mono text-base font-semibold tabular-nums">
            {theme.scenario.amount}
          </p>
        </div>
        <CtaButton
          label={ctaLabel}
          status={status}
          background={theme.swatch}
          color={theme.buttonText}
          className="h-10 rounded-full"
        />
      </div>
    </div>
  );
}

const cardByBrand: Record<string, (props: CardProps) => React.ReactElement> = {
  doordash: DoorDashCard,
  claude: ClaudeCard,
  linear: LinearCard,
  cash: CashCard,
  notion: NotionCard,
};

export function DemoTile({
  theme,
  index = 0,
}: {
  theme: Theme;
  index?: number;
}) {
  const providerRef = useRef<AccountsProvider | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [address, setAddress] = useState<string | null>(null);

  const open = async () => {
    if (status === "opening") return;
    setStatus("opening");

    providerRef.current ??= Provider.create({
      adapter: tempoWallet({
        name: `${theme.name} · Accounts SDK`,
        theme: {
          accent: theme.accent,
          radius: "large",
          font: "Geist",
          scheme: theme.scheme,
        },
      }),
      persistCredentials: false,
      storage: Storage.memory(),
    });

    try {
      const result = await providerRef.current.request({
        method: "wallet_connect",
        params: [
          {
            capabilities: {
              method: "register",
              name: `${theme.name} · Accounts SDK`,
            },
          },
        ],
      });
      const account = result.accounts[0];
      if (!account) throw new Error("No account returned.");
      setAddress(account.address);
      setStatus("connected");
    } catch {
      setStatus(address ? "connected" : "idle");
    }
  };

  const ctaLabel =
    status === "opening"
      ? "Opening Tempo…"
      : status === "connected" && address
        ? shorten(address)
        : theme.scenario.cta;

  const Card = cardByBrand[theme.id] ?? FallbackCard;

  return (
    <button
      type="button"
      onClick={open}
      aria-label={`${theme.scenario.cta} via ${theme.name}`}
      style={{
        animation: `fadeUp 380ms cubic-bezier(0.23, 1, 0.32, 1) ${120 + index * 60}ms both`,
      }}
      className="group block w-full text-left outline-none transition-transform duration-200 ease-out active:scale-[0.97]"
    >
      <Card theme={theme} status={status} ctaLabel={ctaLabel} />
    </button>
  );
}
