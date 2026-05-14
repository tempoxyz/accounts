import { LogInBody } from "./bodies/LogIn";
import { OnRampBody } from "./bodies/OnRamp";
import { PayOnceBody } from "./bodies/PayOnce";
import { PayPerUseBody } from "./bodies/PayPerUse";
import { SubscribeBody } from "./bodies/Subscribe";
import { TradeBody } from "./bodies/Trade";
import {
  defaultAuthorizeAccessKey,
  DEMO_AMOUNT_USD,
  isTrustedHost,
  shorten,
} from "./sdk";
import type { DemoDef, DemoKind } from "./types";

/**
 * Mainnet demos. All on-chain actions sign for $0.01 — display copy
 * (Pro Plan / $240, $24.99/mo, 100 USDC swap, etc.) is just storytelling.
 */
export const DEMOS: Record<DemoKind, DemoDef> = {
  "Log In": {
    url: "wisselbank.xyz",
    prelude: [
      "Looks like you're new here",
      "We'll set up an account with a passkey on your device",
      "No password, no seed phrase",
    ],
    Body: LogInBody,
    async run(provider, ctx) {
      // Privy adapter routes through Privy's own login modal in V1.
      if (ctx.adapter === "privy" && ctx.privy) {
        if (!ctx.privy.authenticated) await ctx.privy.login();
        const addr = ctx.privy.user?.wallet?.address;
        return { summary: addr ? `Signed in · ${shorten(addr)}` : "Signed in" };
      }
      // Lazy access-key co-signing — only when we're on a *.tempo.xyz
      // host. The wallet's validator bypasses the "must include scopes"
      // check for same-registrable-domain callers, so just `limits` is
      // accepted there. From localhost / other origins the same payload
      // would either be rejected (missing scopes) or silently break
      // subsequent transactions, so we skip it and fall back to per-tx
      // confirmation prompts.
      const capabilities: Record<string, unknown> = {
        method: "register",
        name: "Accounts SDK",
      };
      if (isTrustedHost()) {
        capabilities.authorizeAccessKey = defaultAuthorizeAccessKey();
      }
      const result = (await provider.request({
        method: "wallet_connect",
        params: [{ capabilities } as Record<string, unknown>],
      })) as { accounts?: ReadonlyArray<{ address: `0x${string}` }> };
      const account = result?.accounts?.[0];
      return {
        summary: account
          ? `Signed in · ${shorten(account.address)}`
          : "Signed in",
      };
    },
  },

  Onramp: {
    url: "wisselbank.xyz",
    prelude: ["Top up your account"],
    Body: OnRampBody,
    async run(provider) {
      // wallet_deposit opens the wallet's native Deposit dialog
      // ($20/$50/$100/Other, Apple Pay, Deposit crypto, etc.).
      // Pre-fill with $0.01 so the demo amount stays consistent.
      await provider.request({
        method: "wallet_deposit",
        params: [{ value: DEMO_AMOUNT_USD }],
      } as Parameters<typeof provider.request>[0]);
      return { summary: "Deposit dialog opened" };
    },
  },

  "Pay Once": {
    url: "wisselbank.xyz",
    prelude: [
      "We are processing your request to upgrade your dev account",
      "Fetching plans....",
      "Plan found",
    ],
    Body: PayOnceBody,
    async run(provider) {
      // `wallet_send` is the Tempo-native helper (Revm rejects native
      // value transfers via `wallet_sendCalls`). Self-transfer: pay the
      // user's own address with $0.01 so the demo signs a real on-chain
      // tx without burning anyone's money.
      const accounts = (await provider.request({
        method: "eth_accounts",
      })) as readonly `0x${string}`[];
      const self = accounts?.[0];
      if (!self) throw new Error("No account connected.");
      const result = (await provider.request({
        method: "wallet_send",
        params: [{ to: self, value: DEMO_AMOUNT_USD }],
      } as Parameters<typeof provider.request>[0])) as
        | { receipt?: { transactionHash?: `0x${string}` } }
        | undefined;
      const tx = result?.receipt?.transactionHash;
      return { summary: tx ? `tx ${shorten(tx)}` : "Sent" };
    },
  },

  "Pay Per Use": {
    url: "wisselbank.xyz",
    prelude: ["Authorizing per-call payment for this session"],
    Body: PayPerUseBody,
    async run(provider) {
      // TODO: wire MPP capability when the SDK exposes per-call / streaming
      // options. For now: self-transfer like Pay Once.
      const accounts = (await provider.request({
        method: "eth_accounts",
      })) as readonly `0x${string}`[];
      const self = accounts?.[0];
      if (!self) throw new Error("No account connected.");
      await provider.request({
        method: "wallet_send",
        params: [{ to: self, value: DEMO_AMOUNT_USD }],
      } as Parameters<typeof provider.request>[0]);
      return { summary: "Authorized · settles per call" };
    },
  },

  Subscribe: {
    url: "wisselbank.xyz",
    prelude: ["Setting up monthly billing"],
    Body: SubscribeBody,
    async run(provider) {
      // V1: first charge via `wallet_send` self-transfer. The access key
      // authorized at sign-in (when on *.tempo.xyz) lets subsequent
      // renewals charge silently within its limits.
      // TODO: swap to MPP-session capability when exposed.
      const accounts = (await provider.request({
        method: "eth_accounts",
      })) as readonly `0x${string}`[];
      const self = accounts?.[0];
      if (!self) throw new Error("No account connected.");
      await provider.request({
        method: "wallet_send",
        params: [{ to: self, value: DEMO_AMOUNT_USD }],
      } as Parameters<typeof provider.request>[0]);
      return { summary: "Subscribed · auto-renews monthly" };
    },
  },

  "FX Trade": {
    url: "wisselbank.xyz",
    prelude: ["Fetching best route"],
    Body: TradeBody,
    async run(provider) {
      // Open the wallet's swap UI — user picks tokens. Pre-fill $0.01.
      await provider.request({
        method: "wallet_swap",
        params: [
          {
            amount: DEMO_AMOUNT_USD,
            type: "exactIn",
            slippage: 0.005,
          },
        ],
      } as Parameters<typeof provider.request>[0]);
      return { summary: "Swap submitted" };
    },
  },
};
