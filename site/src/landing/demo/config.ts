import { Hex } from "ox";
import { formatUnits, parseUnits } from "viem";
import { Actions } from "viem/tempo";
import { tempoModerato } from "viem/tempo/chains";
import { FeeSponsorshipBody } from "./bodies/FeeSponsorship";
import { LogInBody } from "./bodies/LogIn";
import { OnRampBody } from "./bodies/OnRamp";
import { PayOnceBody } from "./bodies/PayOnce";
import { SpendPermissionsBody } from "./bodies/SpendPermissions";
import { SubscribeBody } from "./bodies/Subscribe";
import { TradeBody } from "./bodies/Trade";
import {
  connectWallet,
  connectWalletResult,
  DEMO_AMOUNT_USD,
  PATH_USD,
  shorten,
  SPEND_PERMISSION_LIMIT_USD,
  SPEND_PERMISSION_PAYMENT_COUNT,
  SPEND_PERMISSION_RECIPIENT,
  SPEND_PERMISSION_VALID_SECONDS,
} from "./sdk";
import type { AccountsProvider, DemoDef, DemoKind, DemoResult } from "./types";

const PURCHASE_AMOUNT_USD = "240";
const TRANSFER_SELECTOR = "0xa9059cbb";
const PATH_USD_DECIMALS = 6;
const DEMO_AMOUNT_UNITS = parseUnits(DEMO_AMOUNT_USD, PATH_USD_DECIMALS);
const SPEND_PERMISSION_LIMIT_UNITS = parseUnits(SPEND_PERMISSION_LIMIT_USD, 6);

function currentChainId(provider: AccountsProvider) {
  const state = provider.store.getState() as unknown as {
    chainId?: number | undefined;
  };
  return state.chainId ?? tempoModerato.id;
}

async function connectedAddress(provider: Parameters<DemoDef["run"]>[0]) {
  const accounts = (await provider.request({
    method: "eth_accounts",
  })) as readonly `0x${string}`[];
  return (
    accounts?.[0] ??
    (await connectWallet(provider, { authorizeDefaultAccessKey: false }))
  );
}

type SpendPermissionRecord = {
  address: `0x${string}`;
  access: `0x${string}`;
  chainId: number;
  expiry?: number | undefined;
  limits?:
    | readonly {
        limit: bigint | number | string;
        token: `0x${string}`;
      }[]
    | undefined;
  scopes?: readonly {
    address: `0x${string}`;
    recipients?: readonly `0x${string}`[] | undefined;
    selector?: string | undefined;
  }[] | undefined;
};

type TransactionReceipt = {
  effectiveGasPrice?: bigint | number | string | undefined;
  gasUsed?: bigint | number | string | undefined;
  transactionHash?: `0x${string}` | undefined;
};

function readPermissionExpiry(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.startsWith("0x"))
    return Hex.toNumber(value as `0x${string}`);
  return Math.floor(Date.now() / 1000) + SPEND_PERMISSION_VALID_SECONDS;
}

function readTokenLimit(value: bigint | number | string) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function readUnits(value: string | undefined) {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function toBigInt(value: bigint | number | string | undefined) {
  if (typeof value === "undefined") return undefined;
  if (typeof value === "bigint") return value;
  return BigInt(value);
}

function receiptFeeUnits(receipt: TransactionReceipt) {
  const effectiveGasPrice = toBigInt(receipt.effectiveGasPrice);
  const gasUsed = toBigInt(receipt.gasUsed);
  if (effectiveGasPrice === undefined || gasUsed === undefined) return 0n;
  return (
    (effectiveGasPrice * gasUsed) /
    10n ** BigInt(18 - PATH_USD_DECIMALS)
  );
}

function formatUsdUnits(units: bigint) {
  return `$${Number(formatUnits(units, PATH_USD_DECIMALS)).toFixed(2)}`;
}

function spendPermissionBudget(spentUnits = 0n) {
  const remaining =
    spentUnits >= SPEND_PERMISSION_LIMIT_UNITS
      ? 0n
      : SPEND_PERMISSION_LIMIT_UNITS - spentUnits;
  return {
    permissionRemaining: formatUsdUnits(remaining),
    permissionSpent: formatUsdUnits(spentUnits),
    permissionSpentUnits: spentUnits.toString(),
  };
}

function spendPermissionResult(options: {
  expiresAt?: number | undefined;
  permissionAddress?: `0x${string}` | undefined;
} = {}): DemoResult {
  return {
    summary: `Permission approved · $${SPEND_PERMISSION_LIMIT_USD} cap`,
    complete: false,
    permissionAddress: options.permissionAddress,
    permissionExpiresAt:
      options.expiresAt ??
      Math.floor(Date.now() / 1000) + SPEND_PERMISSION_VALID_SECONDS,
    permissionLimit: `$${SPEND_PERMISSION_LIMIT_USD}`,
    ...spendPermissionBudget(),
    permissionState: "active",
    progressMax: SPEND_PERMISSION_PAYMENT_COUNT,
    progressValue: 0,
  };
}

export async function connectSpendPermission(provider: AccountsProvider) {
  const result = await connectWalletResult(provider, {
    authorizeDefaultAccessKey: false,
  });
  const account = result.accounts?.[0];
  const key = account?.capabilities?.keyAuthorization;
  const permission = account
    ? findSpendPermission(provider, account.address)
    : undefined;
  return {
    address: account?.address ?? null,
    result: spendPermissionResult({
      expiresAt: permission?.expiry ?? readPermissionExpiry(key?.expiry),
      permissionAddress: permission?.address ?? key?.address ?? key?.keyId,
    }),
  };
}

function findSpendPermission(
  provider: AccountsProvider,
  account: `0x${string}`,
) {
  const chainId = currentChainId(provider);
  const state = provider.store.getState() as unknown as {
    accessKeys?: readonly SpendPermissionRecord[] | undefined;
  };
  return state.accessKeys?.find((key) => {
    if (key.access.toLowerCase() !== account.toLowerCase()) return false;
    if (key.chainId !== chainId) return false;
    if (
      !key.limits?.some(
        (limit) =>
          limit.token.toLowerCase() === PATH_USD.toLowerCase() &&
          readTokenLimit(limit.limit) >= SPEND_PERMISSION_LIMIT_UNITS,
      )
    )
      return false;
    return key.scopes?.some((scope) => {
      if (scope.address.toLowerCase() !== PATH_USD.toLowerCase()) return false;
      if (
        scope.selector !== "transfer(address,uint256)" &&
        scope.selector?.toLowerCase() !== TRANSFER_SELECTOR
      )
        return false;
      if (!scope.recipients || scope.recipients.length === 0) return true;
      return scope.recipients.some(
        (recipient) =>
          recipient.toLowerCase() === SPEND_PERMISSION_RECIPIENT.toLowerCase(),
      );
    });
  });
}

async function sendApprovedPayment(
  provider: AccountsProvider,
  account: `0x${string}`,
) {
  const call = Actions.token.transfer.call({
    amount: DEMO_AMOUNT_UNITS,
    to: SPEND_PERMISSION_RECIPIENT,
    token: PATH_USD,
  });
  return (await provider.request({
    method: "eth_sendTransactionSync",
    params: [
      {
        calls: [call],
        chainId: currentChainId(provider),
        feeToken: PATH_USD,
        from: account,
      },
    ],
  } as Parameters<typeof provider.request>[0])) as TransactionReceipt;
}

function readSpendPaymentCount(variant: string | undefined) {
  if (variant === "again") return 2;
  if (!variant?.startsWith("spend")) return 1;
  const value = Number(variant.slice("spend:".length));
  if (!Number.isInteger(value)) return 1;
  return Math.min(Math.max(value, 1), SPEND_PERMISSION_PAYMENT_COUNT);
}

/** Ordered list of landing demo steps. */
export const DEMO_STEPS = [
  "Log In",
  "Add Funds",
  "Pay Once",
  "Spend Permissions",
  "Subscribe",
  "Fee Sponsorship",
  "Swap Currencies",
] as const satisfies readonly DemoKind[];

/**
 * Most on-chain actions sign for $0.01 — larger display copy is storytelling.
 * Pay Once intentionally prefills $240 so the wallet matches the checkout.
 */
export const DEMOS: Record<DemoKind, DemoDef> = {
  "Log In": {
    url: "wisselbank.xyz",
    network: "mainnet",
    providerProfile: "standard",
    guide: {
      label: "Authentication",
      href: "/docs/guides/connect-accounts",
      prompt:
        "Referencing accounts.tempo.xyz/docs/guides/connect-accounts, add account sign-in to my app with the Accounts SDK.",
    },
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
      const address = await connectWallet(provider);
      return {
        summary: address ? `Signed in · ${shorten(address)}` : "Signed in",
      };
    },
  },

  "Add Funds": {
    url: "wisselbank.xyz",
    network: "mainnet",
    providerProfile: "standard",
    guide: {
      label: "Deposits",
      href: "/docs/guides/deposits",
      prompt:
        "Referencing accounts.tempo.xyz/docs/guides/deposits, add deposits to my app with the Accounts SDK.",
    },
    prelude: ["Top up your account"],
    Body: OnRampBody,
    async run(provider) {
      // wallet_deposit opens the wallet's native Deposit dialog
      // ($20/$50/$100/Other, Apple Pay, Deposit crypto, etc.).
      // Pre-fill with $0.01 so the demo amount stays consistent.
      void provider.request({
        method: "wallet_deposit",
        params: [{ amount: DEMO_AMOUNT_USD }],
      } as Parameters<typeof provider.request>[0]).catch((error) => {
        console.warn("[demo] deposit flow closed", error);
      });
      return {};
    },
  },

  "Pay Once": {
    url: "wisselbank.xyz",
    network: "testnet",
    providerProfile: "standard",
    guide: {
      label: "Transfers",
      href: "/docs/guides/transfers",
      prompt:
        "Referencing accounts.tempo.xyz/docs/guides/transfers, add one-time transfers to my app with the Accounts SDK.",
    },
    prelude: [
      "We are processing your request to upgrade your dev account",
      "Fetching plans....",
      "Plan found",
    ],
    Body: PayOnceBody,
    async run(provider) {
      // `wallet_transfer` opens the wallet UI so the user can confirm
      // the transfer (editable: true). Self-transfer: pay the user's
      // own address so the demo signs a real on-chain tx without
      // sending funds to a third party.
      const accounts = (await provider.request({
        method: "eth_accounts",
      })) as readonly `0x${string}`[];
      const self = accounts?.[0];
      if (!self) throw new Error("No account connected.");
      const result = (await provider.request({
        method: "wallet_transfer",
        params: [
          {
            editable: true,
            to: self,
            amount: PURCHASE_AMOUNT_USD,
            token: "pathUsd",
          },
        ],
      } as Parameters<typeof provider.request>[0])) as
        | { receipt?: { transactionHash?: `0x${string}` } }
        | undefined;
      const tx = result?.receipt?.transactionHash;
      return {
        summary: tx ? "Payment sent ·" : "Payment sent",
        href: tx
          ? `${tempoModerato.blockExplorers.default.url}/tx/${tx}`
          : undefined,
        hrefLabel: tx ? `tx ${shorten(tx)}` : undefined,
      };
    },
  },

  "Spend Permissions": {
    url: "wisselbank.xyz",
    network: "testnet",
    providerProfile: "spendPermission",
    guide: {
      label: "Spend Permissions",
      href: "/docs/guides/spend-permissions",
      prompt:
        "Referencing accounts.tempo.xyz/docs/guides/spend-permissions, add spend permissions for per-use payments to my app with the Accounts SDK.",
    },
    prelude: [
      "Approve a bounded spend permission once",
      "Matching payments can run without another prompt",
    ],
    Body: SpendPermissionsBody,
    async run(provider, ctx) {
      if (
        !ctx.variant?.startsWith("spend") &&
        ctx.variant !== "again" &&
        ctx.variant !== "revoke"
      ) {
        const { address, result } = await connectSpendPermission(provider);
        if (!address) throw new Error("No account connected.");
        return result;
      }

      let account = await connectedAddress(provider);
      if (!account) throw new Error("No account connected.");

      if (ctx.variant === "revoke") {
        const permission = findSpendPermission(provider, account);
        if (permission)
          await provider.request({
            method: "wallet_revokeAccessKey",
            params: [
              {
                accessKeyAddress: permission.address,
                address: account,
              },
            ],
          } as Parameters<typeof provider.request>[0]);
        return {
          summary: "Permission removed",
          complete: false,
          permissionState: "removed",
          progressMax: SPEND_PERMISSION_PAYMENT_COUNT,
          progressValue: 0,
        };
      }

      let permission = findSpendPermission(provider, account);
      if (!permission) {
        const connected = await connectSpendPermission(provider);
        if (!connected.address) throw new Error("No account connected.");
        account = connected.address;
        permission = findSpendPermission(provider, account);
      }

      const receipt = await sendApprovedPayment(provider, account);
      const payments = readSpendPaymentCount(ctx.variant);
      const transactionHash = receipt.transactionHash;
      const transactions = [
        ...(ctx.previousResult?.transactions ?? []),
        ...(transactionHash
          ? [
              {
                hash: transactionHash,
                href: `${tempoModerato.blockExplorers.default.url}/tx/${transactionHash}`,
                label: `Payment ${payments} · tx ${shorten(transactionHash)}`,
              },
            ]
          : []),
      ];
      const spentUnits =
        readUnits(ctx.previousResult?.permissionSpentUnits) +
        DEMO_AMOUNT_UNITS +
        receiptFeeUnits(receipt);
      return {
        summary:
          payments === 1
            ? `Payment sent · $${DEMO_AMOUNT_USD} used`
            : `${payments} payments sent · $${(Number(DEMO_AMOUNT_USD) * payments).toFixed(2)} used`,
        complete:
          payments >= SPEND_PERMISSION_PAYMENT_COUNT ? undefined : false,
        permissionAddress: permission?.address,
        permissionExpiresAt:
          permission?.expiry ??
          Math.floor(Date.now() / 1000) + SPEND_PERMISSION_VALID_SECONDS,
        permissionLimit: `$${SPEND_PERMISSION_LIMIT_USD}`,
        ...spendPermissionBudget(spentUnits),
        permissionState: "active",
        progressMax: SPEND_PERMISSION_PAYMENT_COUNT,
        progressValue: payments,
        transactions,
      };
    },
  },

  Subscribe: {
    url: "wisselbank.xyz",
    network: "testnet",
    providerProfile: "standard",
    guide: {
      label: "Subscriptions",
      href: "/docs/guides/subscriptions",
      prompt:
        "Referencing accounts.tempo.xyz/docs/guides/subscriptions, add subscriptions to my app with the Accounts SDK.",
    },
    prelude: ["Setting up monthly billing"],
    Body: SubscribeBody,
    async run(provider) {
      // V1: first charge via `wallet_transfer` self-transfer. The access
      // key authorized at sign-in (when on *.tempo.xyz) lets subsequent
      // renewals charge silently within its limits.
      // TODO: swap to the MPP subscription flow when the landing demo has a
      // server-backed variant.
      const accounts = (await provider.request({
        method: "eth_accounts",
      })) as readonly `0x${string}`[];
      const self = accounts?.[0];
      if (!self) throw new Error("No account connected.");
      await provider.request({
        method: "wallet_transfer",
        params: [
          {
            editable: true,
            to: self,
            amount: DEMO_AMOUNT_USD,
            token: "pathUsd",
          },
        ],
      } as Parameters<typeof provider.request>[0]);
      return { summary: "Subscribed · auto-renews monthly" };
    },
  },

  "Fee Sponsorship": {
    url: "wisselbank.xyz",
    network: "testnet",
    providerProfile: "standard",
    guide: {
      label: "Fee Sponsorship",
      href: "/docs/guides/fee-sponsorship",
      prompt:
        "Referencing accounts.tempo.xyz/docs/guides/fee-sponsorship, add fee sponsorship to my app with the Accounts SDK.",
    },
    prelude: [
      "Checking sponsorship policy",
      "Approved actions can use your app's fee payer",
    ],
    Body: FeeSponsorshipBody,
    async run() {
      return { summary: "Sponsorship policy ready" };
    },
  },

  "Swap Currencies": {
    url: "wisselbank.xyz",
    network: "testnet",
    providerProfile: "standard",
    guide: {
      label: "Exchange Currencies",
      href: "/docs/guides/swaps",
      prompt:
        "Referencing accounts.tempo.xyz/docs/guides/swaps, add currency exchange to my app with the Accounts SDK.",
    },
    prelude: ["Fetching best route"],
    Body: TradeBody,
    async run(provider) {
      // Open the wallet's swap UI — user picks tokens. Pre-fill $0.01
      // as the exact sell amount.
      await provider.request({
        method: "wallet_swap",
        params: [
          {
            amount: DEMO_AMOUNT_USD,
            type: "sell",
            slippage: 0.005,
          },
        ],
      } as Parameters<typeof provider.request>[0]);
      return { summary: "Swap submitted" };
    },
  },
};
