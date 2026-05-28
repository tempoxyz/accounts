"use client";

import { stagger, waapi, type WAAPIAnimation } from "animejs";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { springs } from "../../animation";
import { LockIcon, TempoLogo } from "../../icons";
import { PrimaryButton, useBodyAnimation } from "../bodies/shared";
import { DEMOS, DEMO_STEPS } from "../config";
import type {
  AccountStatus,
  Adapter,
  DemoDef,
  DemoGuide,
  DemoKind,
  DemoResult,
  Status,
} from "../types";
import { shorten } from "../sdk";
import { ChatBubble } from "./ChatBubble";

const MESSAGE_STAGGER_MS = 70;
const MESSAGE_BODY_GAP_MS = 180;
const INITIAL_LOG_IN_DELAY_MS = 260;
const messageInitialStyle: CSSProperties = {
  opacity: 0,
  translate: "0 12px",
  willChange: "opacity, translate",
};

function ChevronRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M5 3L9 7L5 11"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DemoGuideCallout({
  guide,
  delay,
}: {
  guide: DemoGuide;
  delay: number;
}) {
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCopied(false);
    if (!copyTimer.current) return;
    clearTimeout(copyTimer.current);
    copyTimer.current = null;
  }, [guide.prompt]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(guide.prompt);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => {
        setCopied(false);
        copyTimer.current = null;
      }, 1400);
    } catch {
      setCopied(false);
    }
  };

  // Entrance animation runs once on mount — switching demos shouldn't
  // re-fade the callout, so we intentionally omit `delay`/`guide.prompt`
  // from the dep list. `delay` is captured by closure from the first
  // render, which is fine for a one-shot fade-in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReady(true);
      return;
    }

    let disposed = false;
    const animation: WAAPIAnimation = waapi.animate(root, {
      opacity: [0, 1],
      translate: ["0 12px", "0 0"],
      delay,
      ease: springs.entrance,
    });

    void animation.then(() => {
      if (disposed) return;
      setReady(true);
    });

    return () => {
      disposed = true;
      animation.cancel();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="-mx-4 mt-auto flex items-center justify-between gap-4 px-4 py-4 sm:-mx-[27px] sm:px-[27px]"
      style={ready ? undefined : messageInitialStyle}
    >
      <a
        href={guide.href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[14px] text-foreground-muted outline-none hover:text-foreground active:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
      >
        Add {guide.label.toLowerCase()} to your app
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
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={copy}
          aria-live="polite"
          className={`bg-secondary px-3 py-1.5 text-[12px] text-foreground outline-none hover:bg-secondary-hover active:bg-secondary-active focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 ${copied ? "text-accent-live" : ""}`}
        >
          {copied ? "Copied" : "Copy prompt"}
        </button>
      </div>
    </div>
  );
}

function NextDemoMessage({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  const body = useBodyAnimation(0);

  return (
    <div
      ref={body.ref}
      className="flex max-w-full flex-col items-start gap-2 bg-panel-2 px-3 py-2"
      style={body.style}
    >
      <p className="text-[14px] break-words text-foreground sm:whitespace-nowrap">
        Ready for the next example?
      </p>
      <button
        type="button"
        onClick={onClick}
        className="bg-accent px-3 py-1.5 text-[14px] text-on-accent outline-none hover:bg-accent-hover active:bg-accent-active focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
      >
        {label}
      </button>
    </div>
  );
}

function SignInGate({
  accountStatus,
  delay,
  onSignIn,
  signInStatus,
}: {
  accountStatus: AccountStatus;
  delay: number;
  onSignIn: () => void;
  signInStatus: Status;
}) {
  const body = useBodyAnimation(delay);
  const checking = accountStatus === "checking";
  const status = checking ? "running" : signInStatus;
  const label =
    accountStatus === "checking"
      ? "Checking..."
      : signInStatus === "running"
        ? "Signing in..."
        : "Sign in";

  return (
    <div
      ref={body.ref}
      className="flex w-full max-w-[366px] flex-col gap-4 bg-panel-2 p-6"
      style={body.style}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[18px] text-foreground">Sign in to continue</p>
        <p className="text-[14px] text-foreground-muted">
          Connect your Tempo account to try this example.
        </p>
      </div>
      <PrimaryButton
        label={label}
        status={status}
        disabled={checking}
        onClick={onSignIn}
        className="h-11 w-full"
      />
    </div>
  );
}

export type ConnectedSession = {
  address: `0x${string}`;
  balanceDisplay: string;
  balance: bigint;
};

export function BrowserMockup({
  demo,
  def,
  status,
  signInStatus,
  result,
  adapter,
  lastVariant,
  connected,
  accountStatus,
  onAction,
  onSignIn,
  onChangeDemo,
  onDisconnect,
}: {
  demo: DemoKind;
  def: DemoDef;
  status: Status;
  signInStatus: Status;
  result: DemoResult | null;
  adapter: Adapter;
  lastVariant: string | null;
  connected: ConnectedSession | null;
  accountStatus: AccountStatus;
  onAction: (variant?: string) => void;
  onSignIn: () => void;
  onChangeDemo: (d: DemoKind) => void;
  onDisconnect: () => void;
}) {
  const Body = def.Body;
  const preludeCount = def.prelude?.length ?? 0;
  const demoDelayRef = useRef({
    demo,
    delay: demo === "Log In" ? INITIAL_LOG_IN_DELAY_MS : 0,
  });
  if (demoDelayRef.current.demo !== demo) {
    demoDelayRef.current = { demo, delay: 0 };
  }
  const initialDelay = demoDelayRef.current.delay;
  const bodyDelay = useMemo(
    () =>
      preludeCount === 0
        ? initialDelay + 120
        : initialDelay +
          (preludeCount - 1) * MESSAGE_STAGGER_MS +
          MESSAGE_BODY_GAP_MS,
    [initialDelay, preludeCount],
  );
  const guideDelay = bodyDelay + MESSAGE_BODY_GAP_MS;
  const rootRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const pressedDemoRef = useRef<DemoKind | null>(null);
  const [animatedMessagesDemo, setAnimatedMessagesDemo] =
    useState<DemoKind | null>(null);
  const activeIndex = DEMO_STEPS.indexOf(demo);
  const previousDemo =
    DEMO_STEPS[(activeIndex - 1 + DEMO_STEPS.length) % DEMO_STEPS.length];
  const nextDemo = DEMO_STEPS[(activeIndex + 1) % DEMO_STEPS.length];
  const previousIndex = previousDemo ? DEMO_STEPS.indexOf(previousDemo) : -1;
  const nextIndex = nextDemo ? DEMO_STEPS.indexOf(nextDemo) : -1;
  const previousStep =
    previousIndex >= 0 ? String(previousIndex + 1).padStart(2, "0") : "";
  const nextStep = nextIndex >= 0 ? String(nextIndex + 1).padStart(2, "0") : "";
  const previousLabel = previousDemo ? DEMOS[previousDemo].guide.label : "";
  const nextLabel = nextDemo ? DEMOS[nextDemo].guide.label : "";
  const nextCtaLabel =
    activeIndex === DEMO_STEPS.length - 1
      ? "Restart examples"
      : nextLabel
        ? `Go to ${nextLabel}`
        : "Next example";
  const messageStyle =
    animatedMessagesDemo === demo ? undefined : messageInitialStyle;
  const needsSignIn = demo !== "Log In" && !connected;
  const changeDemo = (d: DemoKind) => {
    onChangeDemo(d);
    if (!window.matchMedia("(min-width: 640px)").matches)
      rootRef.current?.scrollIntoView({ block: "start", inline: "nearest" });
  };
  const goNextDemo = () => {
    if (nextDemo) changeDemo(nextDemo);
  };
  const pressDemo = (d: DemoKind) => {
    if (pressedDemoRef.current === d) return;
    pressedDemoRef.current = d;
    changeDemo(d);
  };
  const clickDemo = (d: DemoKind) => {
    if (pressedDemoRef.current === d) {
      pressedDemoRef.current = null;
      return;
    }
    changeDemo(d);
  };

  useLayoutEffect(() => {
    const root = messagesRef.current;
    if (!root) {
      setAnimatedMessagesDemo(demo);
      return;
    }

    const items = root.querySelectorAll<HTMLElement>("[data-demo-message]");
    if (items.length === 0) {
      setAnimatedMessagesDemo(demo);
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAnimatedMessagesDemo(demo);
      return;
    }

    let disposed = false;
    const animation: WAAPIAnimation = waapi.animate(items, {
      opacity: [0, 1],
      translate: ["0 12px", "0 0"],
      delay: stagger(MESSAGE_STAGGER_MS, { start: initialDelay }),
      ease: springs.entrance,
    });

    void animation.then(() => {
      if (disposed) return;
      setAnimatedMessagesDemo(demo);
    });

    return () => {
      disposed = true;
      animation.cancel();
    };
  }, [demo, initialDelay, preludeCount]);

  return (
    <div
      ref={rootRef}
      className="relative z-10 mx-auto w-full max-w-[1089px] border border-panel-3 bg-background/75 backdrop-blur-sm"
    >
      {/* URL bar — wraps to two rows on small screens so the wallet info stays visible. */}
      <div className="m-3 mb-0 flex flex-wrap items-center justify-between gap-2 bg-panel-deep p-3 sm:m-[27px] sm:gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <LockIcon width={12} height={15} className="shrink-0 text-accent-live" />
          <p className="truncate font-mono text-[12px] whitespace-nowrap text-foreground">
            {def.url}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="flex min-w-[148px] items-center justify-end gap-2 font-mono text-[12px] sm:min-w-[260px]">
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${connected ? "bg-accent-live" : "bg-foreground-subtle"}`}
            />
            {connected ? (
              <>
                <span className="text-foreground">
                  {shorten(connected.address)}
                </span>
                {connected.balanceDisplay ? (
                  <>
                    <span className="hidden text-foreground-subtle sm:inline">·</span>
                    <span className="hidden text-foreground sm:inline">
                      {connected.balanceDisplay}
                    </span>
                  </>
                ) : null}
                <span className="text-foreground-subtle">·</span>
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="text-foreground-muted outline-none hover:text-foreground active:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <span className="text-foreground-muted">
                {accountStatus === "checking" ? "Checking…" : "Not connected"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Body — split:
          left pane (sm+) = numbered demo nav (acts as a stepper)
          right pane = chat orchestration + bespoke demo body
          Mobile uses a compact previous/current/next stepper below the demo.
      */}
      <div className="grid min-h-[420px] grid-cols-1 sm:min-h-[510px] sm:grid-cols-[260px_1fr]">
        <div className="order-2 grid grid-cols-2 border-t border-panel-border bg-background sm:hidden">
          <button
            type="button"
            aria-label={`Previous demo: ${previousLabel}`}
            onClick={() => {
              if (previousDemo) changeDemo(previousDemo);
            }}
            className="flex min-h-14 items-center justify-start gap-3 px-4 text-left text-foreground outline-none hover:bg-surface-hover active:bg-surface-active active:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
          >
            <span aria-hidden className="rotate-180">
              <ChevronRight />
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-[12px] tracking-[0.08em] text-foreground-subtle">
                {previousStep}
              </span>
              <span className="block truncate text-[14px] text-foreground-muted">
                {previousLabel}
              </span>
            </span>
          </button>

          <button
            type="button"
            aria-label={`Next demo: ${nextLabel}`}
            onClick={() => {
              if (nextDemo) changeDemo(nextDemo);
            }}
            className="flex min-h-14 items-center justify-end gap-3 border-l border-panel-border px-4 text-right text-foreground outline-none hover:bg-surface-hover active:bg-surface-active active:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2"
          >
            <span className="min-w-0">
              <span className="block font-mono text-[12px] tracking-[0.08em] text-foreground-subtle">
                {nextStep}
              </span>
              <span className="block truncate text-[14px] text-foreground-muted">
                {nextLabel}
              </span>
            </span>
            <ChevronRight />
          </button>
        </div>

        {/* Desktop: always-visible numbered stepper nav on the left */}
        <nav className="hidden flex-col border-r border-panel-border sm:flex">
          {DEMO_STEPS.map((d, i) => {
            const active = d === demo;
            const step = String(i + 1).padStart(2, "0");
            const label = DEMOS[d].guide.label;
            return (
              <button
                key={d}
                type="button"
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse" && event.button !== 0) return;
                  pressDemo(d);
                }}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  pressDemo(d);
                }}
                onClick={() => clickDemo(d)}
                className={`group relative flex items-center justify-between gap-3 border-b border-panel-border px-5 py-6 text-left outline-none hover:bg-surface-hover active:bg-surface-active active:text-foreground focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-info focus-visible:outline-offset-2 last:border-b-0 ${active ? "bg-background text-foreground" : "text-foreground-muted"}`}
              >
                <div className="flex min-w-0 items-baseline gap-3">
                  <span
                    aria-hidden
                    className={`font-mono text-[12px] tracking-[0.05em] ${active ? "text-foreground-muted" : "text-foreground-subtle"}`}
                  >
                    {step}
                  </span>
                  <span className="truncate text-[14px]">{label}</span>
                </div>
                <span
                  aria-hidden
                  className="opacity-60 group-hover:opacity-100"
                >
                  <ChevronRight />
                </span>
              </button>
            );
          })}
        </nav>

        <div className="flex min-h-[420px] flex-col px-4 pt-3 pb-0 sm:min-h-[510px] sm:px-[27px] sm:pt-[15px]">
          <div className="flex w-full min-w-0 items-start gap-3">
            <div
              aria-hidden
              className="grid aspect-square h-9 shrink-0 place-items-center bg-background text-foreground"
            >
              <TempoLogo width={14} height={15} />
            </div>
            <div className="flex w-full min-w-0 flex-col items-start gap-4">
              {preludeCount > 0 ? (
                <div ref={messagesRef} className="flex w-full min-w-0 flex-col items-start gap-2">
                  {def.prelude?.map((m, i) => (
                    <ChatBubble
                      key={`${demo}-bubble-${i}`}
                      message={m}
                      style={messageStyle}
                    />
                  ))}
                </div>
              ) : null}
              {needsSignIn ? (
                <SignInGate
                  key={`${demo}-sign-in`}
                  accountStatus={accountStatus}
                  delay={bodyDelay}
                  onSignIn={onSignIn}
                  signInStatus={signInStatus}
                />
              ) : (
                <Body
                  key={`${demo}-body`}
                  status={status}
                  result={result}
                  lastVariant={lastVariant}
                  onAction={onAction}
                  onNextDemo={goNextDemo}
                  nextCtaLabel={nextCtaLabel}
                  onDisconnect={onDisconnect}
                  delay={bodyDelay}
                  adapter={adapter}
                  connectedBalance={connected?.balanceDisplay ?? null}
                />
              )}
              {status === "done" && result?.complete !== false ? (
                <NextDemoMessage
                  key={`${demo}-next-message`}
                  label={nextCtaLabel}
                  onClick={goNextDemo}
                />
              ) : null}
            </div>
          </div>
          <DemoGuideCallout guide={def.guide} delay={guideDelay} />
        </div>
      </div>
    </div>
  );
}
