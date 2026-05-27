import type { Provider } from "accounts";
import type { ReactNode } from "react";

export type Adapter = "tempoAuth" | "webAuth" | "privy" | "turnkey";

export type DemoKind =
  | "Log In"
  | "Add Funds"
  | "Pay Once"
  | "Spend Permissions"
  | "Subscribe"
  | "Fee Sponsorship"
  | "Swap Currencies";

export type Status = "idle" | "running" | "done";

/** Current account lookup state for the shared demo session. */
export type AccountStatus = "checking" | "disconnected" | "connected";

/** Status for the setup controls. Kept separate from demo action state. */
export type SetupStatus = "idle" | "connecting" | "funding";

export type AccountsProvider = ReturnType<typeof Provider.create>;

export type DemoResult = {
  /** Short human-readable result line shown in the body's `done` state. */
  summary?: string;
  /** Whether the demo is complete and should show the next-step CTA. */
  complete?: boolean | undefined;
  /** Optional destination for the result line, such as an explorer receipt URL. */
  href?: string | undefined;
  /** Optional text for the linked portion of the result line. */
  hrefLabel?: string | undefined;
  /** Optional progress value for multi-step demo bodies. */
  progressValue?: number | undefined;
  /** Optional progress maximum for multi-step demo bodies. */
  progressMax?: number | undefined;
  /** Permission status for demos that authorize a spend permission. */
  permissionState?: "active" | "removed" | undefined;
  /** Unix timestamp when the authorized permission expires. */
  permissionExpiresAt?: number | undefined;
  /** Optional human-readable permission limit. */
  permissionLimit?: string | undefined;
  /** Human-readable amount used from the permission. */
  permissionSpent?: string | undefined;
  /** Raw pathUSD units used from the permission. */
  permissionSpentUnits?: string | undefined;
  /** Human-readable amount remaining in the permission. */
  permissionRemaining?: string | undefined;
  /** Optional authorized access key address. */
  permissionAddress?: `0x${string}` | undefined;
  /** Transaction links produced by the demo. */
  transactions?:
    | readonly {
        hash: `0x${string}`;
        href: string;
        label: string;
      }[]
    | undefined;
  /** Status for demos that activate and renew a subscription. */
  subscriptionState?:
    | "active"
    | "current"
    | "collected"
    | "cancelled"
    | undefined;
  /** Server-issued subscription identifier. */
  subscriptionId?: string | undefined;
  /** Millisecond timestamp when the next renewal can be collected. */
  subscriptionNextCollectAt?: number | undefined;
  /** Payment receipts produced by a subscription demo. */
  subscriptionReceipts?:
    | readonly {
        reference: string;
        href?: string | undefined;
        label: string;
      }[]
    | undefined;
  /** Address that paid fees for a sponsored transaction. */
  feePayer?: `0x${string}` | string | undefined;
  /** Human-readable fee paid by the sponsor. */
  sponsoredFee?: string | undefined;
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

export type DemoPreludeMessage =
  | string
  | {
      before: string;
      label: string;
      href: string;
      after?: string | undefined;
    };

export type DemoBodyProps = {
  status: Status;
  result: DemoResult | null;
  /** Triggers the demo's `run`. Optional `variant` lets bodies with multiple buttons (Read vs Write) signal which one was pressed. */
  onAction: (variant?: string) => void;
  /** Moves to the next landing demo step. */
  onNextDemo: () => void;
  /** Label for the explicit next-step CTA after a demo completes. */
  nextCtaLabel?: string | undefined;
  /** Status for setup actions that are separate from the demo action. */
  setupStatus: SetupStatus;
  /** Setup error shown in the funding overlay. */
  setupError: string | null;
  /** Whether this demo should block on account funding before its main action. */
  needsFunding: boolean;
  /** Connects the account used by the demo. */
  onSetupConnect: () => void;
  /** Adds funds for the demo account. */
  onSetupFund: () => void;
  /** Disconnects the current account. */
  onDisconnect?: (() => void) | undefined;
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
  /** Guide metadata shown around the active demo step. */
  guide: DemoGuide;
  prelude?: readonly DemoPreludeMessage[] | undefined;
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
  /** Previous result for demos that append state across repeated actions. */
  previousResult?: DemoResult | null | undefined;
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
