import type { Provider } from "accounts";
import type { ReactNode } from "react";

export type Adapter = "tempoAuth" | "webAuth" | "privy" | "turnkey";

export type DemoKind =
  | "Log In"
  | "Add Funds"
  | "Pay Once"
  | "Pay Per Use"
  | "Subscribe"
  | "Fee Sponsorship"
  | "Swap Currencies";

export type Status = "idle" | "running" | "done";

/** Status for the testnet setup controls. Kept separate from demo action state. */
export type SetupStatus = "idle" | "connecting" | "funding";

export type AccountsProvider = ReturnType<typeof Provider.create>;

/** Network used by a landing demo step. */
export type DemoNetwork = "mainnet" | "testnet";

export type DemoResult = {
  /** Short human-readable result line shown in the body's `done` state. */
  summary?: string;
};

/** Guide metadata attached to one landing demo step. */
export type DemoGuide = {
  /** Guide keyword shown in the demo stepper. */
  label: string;
  /** Local docs route for the guide. */
  href: string;
  /** Prompt copied for agent-assisted implementation. */
  prompt: string;
};

export type DemoBodyProps = {
  status: Status;
  result: DemoResult | null;
  /** Triggers the demo's `run`. Optional `variant` lets bodies with multiple buttons (Read vs Write) signal which one was pressed. */
  onAction: (variant?: string) => void;
  /** Moves to the next landing demo step. */
  onNextDemo: () => void;
  /** Status for setup actions that are separate from the demo action. */
  setupStatus: SetupStatus;
  /** Setup error shown in the funding overlay. */
  setupError: string | null;
  /** Whether this demo should block on account funding before its main action. */
  needsFunding: boolean;
  /** Connects the account used by the current demo network. */
  onSetupConnect: () => void;
  /** Adds funds for the current demo network. */
  onSetupFund: () => void;
  /** The variant string passed to the most recent `onAction` call, or null. */
  lastVariant: string | null;
  /** Entrance delay (ms) — set so the body fades up after the prelude. */
  delay: number;
  /** Active adapter — bodies may render adapter-specific affordances (Privy). */
  adapter: Adapter;
  /** USD-denominated balance string from the SDK (e.g., "$4.27"), or null if not connected. */
  connectedBalance: string | null;
};

export type DemoDef = {
  url: string;
  /** Network used by this demo step. */
  network: DemoNetwork;
  /** Whether the demo should move to the next step after a successful action. */
  autoAdvance?: boolean | undefined;
  /** Guide metadata shown around the active demo step. */
  guide: DemoGuide;
  prelude?: string[];
  Body: React.ComponentType<DemoBodyProps>;
  /**
   * Performs the SDK call. Receives a callable provider; resolves with an
   * optional summary line for the done state. Throw to fall back to idle.
   */
  run: (provider: AccountsProvider, ctx: RunContext) => Promise<DemoResult>;
};

export type RunContext = {
  adapter: Adapter;
  /** Variant string passed by the body's `onAction(...)` call. Used by demos with multiple CTAs (e.g., Read vs Write). */
  variant?: string;
  /** Privy hooks routed through (only relevant when adapter === "privy"). */
  privy?: {
    login: () => Promise<void>;
    logout: () => Promise<void>;
    user: { wallet?: { address?: string } | null } | null;
    authenticated: boolean;
  };
};

export type AdapterInfo = {
  label: string;
};

export type ChildrenProps = { children?: ReactNode };
