import { Receipt } from "mppx";
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
  spendPermissionAuthorizeAccessKey,
  TEMPO_MAINNET_CHAIN_ID,
} from "./sdk";
import type { AccountsProvider, DemoDef, DemoKind, DemoResult } from "./types";

const PURCHASE_AMOUNT_USD = "240";
const TRANSFER_SELECTOR = "0xa9059cbb";
const PATH_USD_DECIMALS = 6;
const DEMO_AMOUNT_UNITS = parseUnits(DEMO_AMOUNT_USD, PATH_USD_DECIMALS);
const SPEND_PERMISSION_LIMIT_UNITS = parseUnits(SPEND_PERMISSION_LIMIT_USD, 6);
const SUBSCRIPTION_PERIOD_SECONDS = 10;
const SUBSCRIPTION_PERIOD_MS = SUBSCRIPTION_PERIOD_SECONDS * 1000;
const FEE_SPONSORSHIP_AMOUNT_USD = "1.00";
const FEE_SPONSORSHIP_RECIPIENT =
  "0x0000000000000000000000000000000000000001" as const;
const SWAP_AMOUNT_USD = "1";
const ALPHA_USD = "0x20c0000000000000000000000000000000000001" as const;

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
  return accounts?.[0] ?? (await connectWallet(provider));
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
  feePayer?: `0x${string}` | string | undefined;
  gasUsed?: bigint | number | string | undefined;
  transactionHash?: `0x${string}` | undefined;
};

type SponsoredTransactionReceipt = TransactionReceipt & {
  sponsoredFee?: string | undefined;
};

type WalletTransferResult = {
  receipt: TransactionReceipt;
};

type WalletSwapResult = {
  receipt: TransactionReceipt;
};

type SubscriptionCollectResponse = {
  receipt: Receipt.Receipt | null;
  renewed: boolean;
  subscriptionId: string;
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

function receiptFeeDisplay(receipt: TransactionReceipt) {
  const units = receiptFeeUnits(receipt);
  if (units <= 0n) return undefined;
  return formatFeeUnits(units);
}

function formatUsdUnits(units: bigint) {
  return `$${Number(formatUnits(units, PATH_USD_DECIMALS)).toFixed(2)}`;
}

function formatFeeUnits(units: bigint) {
  const value = Number(formatUnits(units, PATH_USD_DECIMALS));
  return `$${value.toFixed(units < 10_000n ? 6 : 2)}`;
}

function spendPermissionBudget(options: {
  limitUnits?: bigint | undefined;
  spentUnits?: bigint | undefined;
} = {}) {
  const limitUnits = options.limitUnits ?? SPEND_PERMISSION_LIMIT_UNITS;
  const spentUnits = options.spentUnits ?? 0n;
  const remaining =
    spentUnits >= limitUnits
      ? 0n
      : limitUnits - spentUnits;
  return {
    permissionRemaining: formatUsdUnits(remaining),
    permissionSpent: formatUsdUnits(spentUnits),
    permissionSpentUnits: spentUnits.toString(),
  };
}

function spendPermissionResult(options: {
  expiresAt?: number | undefined;
  permissionAddress?: `0x${string}` | undefined;
  permissionLimitUnits?: bigint | undefined;
} = {}): DemoResult {
  const limitUnits = options.permissionLimitUnits ?? SPEND_PERMISSION_LIMIT_UNITS;
  const permissionLimit = formatUsdUnits(limitUnits);
  return {
    summary: `Access key authorized · ${permissionLimit} cap`,
    complete: false,
    permissionAddress: options.permissionAddress,
    permissionExpiresAt:
      options.expiresAt ??
      Math.floor(Date.now() / 1000) + SPEND_PERMISSION_VALID_SECONDS,
    permissionLimit,
    ...spendPermissionBudget({ limitUnits }),
    permissionState: "active",
    progressMax: SPEND_PERMISSION_PAYMENT_COUNT,
    progressValue: 0,
  };
}

export async function connectSpendPermission(provider: AccountsProvider) {
  const result = await connectWalletResult(provider, {
    authorizeAccessKey: spendPermissionAuthorizeAccessKey(),
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

/** Returns active access-key payment state for a connected account. */
export function activeSpendPermissionResult(
  provider: AccountsProvider,
  account: `0x${string}`,
) {
  const permission = findSpendPermission(provider, account);
  if (!permission) return null;
  return spendPermissionResult({
    expiresAt: permission.expiry,
    permissionAddress: permission.address,
    permissionLimitUnits: spendPermissionLimitUnits(permission),
  });
}

function spendPermissionLimitUnits(permission: SpendPermissionRecord) {
  const limit = permission.limits?.find(
    (limit) => limit.token.toLowerCase() === PATH_USD.toLowerCase(),
  );
  return limit ? readTokenLimit(limit.limit) : SPEND_PERMISSION_LIMIT_UNITS;
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

async function requireConnectedAccount(provider: AccountsProvider) {
  const accounts = (await provider.request({
    method: "eth_accounts",
  })) as readonly `0x${string}`[];
  const account = accounts?.[0];
  if (!account) throw new Error("No account connected.");
  return account;
}

function responseBodyText(body: unknown) {
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function subscriptionNextCollectAt(receipt: Receipt.Receipt) {
  const timestamp = Date.parse(receipt.timestamp);
  if (!Number.isFinite(timestamp)) return Date.now() + SUBSCRIPTION_PERIOD_MS;
  return timestamp + SUBSCRIPTION_PERIOD_MS;
}

function subscriptionReceipt(label: string, receipt: Receipt.Receipt) {
  const reference = receipt.reference;
  return {
    reference,
    label: `${label} · ${shorten(reference)}`,
    ...(reference.startsWith("0x")
      ? { href: `${tempoModerato.blockExplorers.default.url}/tx/${reference}` }
      : {}),
  };
}

function readCollectResponse(body: unknown): SubscriptionCollectResponse {
  if (!body || typeof body !== "object")
    throw new Error("Invalid subscription collection response.");
  const data = body as {
    receipt?: unknown;
    renewed?: unknown;
    subscriptionId?: unknown;
  };
  if (typeof data.subscriptionId !== "string")
    throw new Error("Missing subscription id.");
  if (typeof data.renewed !== "boolean")
    throw new Error("Missing renewal status.");
  const receipt =
    data.receipt === null || data.receipt === undefined
      ? null
      : Receipt.Schema.parse(data.receipt);
  if (data.renewed && !receipt?.subscriptionId)
    throw new Error("Missing renewal receipt.");
  return {
    receipt,
    renewed: data.renewed,
    subscriptionId: data.subscriptionId,
  };
}

async function sendSponsoredTransfer(
  provider: AccountsProvider,
): Promise<SponsoredTransactionReceipt> {
  await connectedAddress(provider);
  const result = (await provider.request({
    method: "wallet_transfer",
    params: [
      {
        amount: FEE_SPONSORSHIP_AMOUNT_USD,
        to: FEE_SPONSORSHIP_RECIPIENT,
        token: PATH_USD,
      },
    ],
  } as Parameters<typeof provider.request>[0])) as WalletTransferResult;
  const receipt = result.receipt;
  if (!receipt.feePayer) throw new Error("Fee sponsorship was not applied.");
  const sponsoredFee = receiptFeeDisplay(receipt);
  return {
    ...receipt,
    ...(sponsoredFee ? { sponsoredFee } : {}),
  };
}

/** Ordered list of landing demo steps. */
export const DEMO_STEPS = [
  "Log In",
  "Pay Once",
  "Spend Permissions",
  "Subscribe",
  "Fee Sponsorship",
  "Swap Currencies",
  "Add Funds",
] as const satisfies readonly DemoKind[];

/**
 * Most on-chain actions sign for $0.01 — larger display copy is storytelling.
 * Pay Once intentionally prefills $240 so the wallet matches the checkout.
 */
export const DEMOS: Record<DemoKind, DemoDef> = {
  "Log In": {
    url: "wisselbank.xyz",
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
        params: [
          {
            amount: DEMO_AMOUNT_USD,
            chainId: TEMPO_MAINNET_CHAIN_ID,
          },
        ],
      } as Parameters<typeof provider.request>[0]).catch(() => undefined);
      return {};
    },
  },

  "Pay Once": {
    url: "wisselbank.xyz",
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
    guide: {
      label: "Spend Permissions",
      href: "/docs/guides/spend-permissions",
      prompt:
        "Referencing accounts.tempo.xyz/docs/guides/spend-permissions, add spend permissions for per-use payments to my app with the Accounts SDK.",
    },
    prelude: [
      "Authorize a scoped access key once",
      "Matching transfers use that key without another prompt",
    ],
    Body: SpendPermissionsBody,
    async run(provider, ctx) {
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
          summary: "Access key revoked",
          complete: false,
          permissionState: "removed",
          progressMax: SPEND_PERMISSION_PAYMENT_COUNT,
          progressValue: 0,
        };
      }

      let permission = findSpendPermission(provider, account);
      if (
        !permission &&
        !ctx.variant?.startsWith("spend") &&
        ctx.variant !== "again"
      ) {
        const connected = await connectSpendPermission(provider);
        if (!connected.address) throw new Error("No account connected.");
        return connected.result;
      }
      if (!permission) {
        const connected = await connectSpendPermission(provider);
        if (!connected.address) throw new Error("No account connected.");
        account = connected.address;
        permission = findSpendPermission(provider, account);
      }
      if (!permission) throw new Error("No access key authorized.");

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
      const permissionLimitUnits = spendPermissionLimitUnits(permission);
      return {
        complete:
          payments >= SPEND_PERMISSION_PAYMENT_COUNT ? undefined : false,
        permissionAddress: permission?.address,
        permissionExpiresAt:
          permission?.expiry ??
          Math.floor(Date.now() / 1000) + SPEND_PERMISSION_VALID_SECONDS,
        permissionLimit: formatUsdUnits(permissionLimitUnits),
        ...spendPermissionBudget({
          limitUnits: permissionLimitUnits,
          spentUnits,
        }),
        permissionState: "active",
        progressMax: SPEND_PERMISSION_PAYMENT_COUNT,
        progressValue: payments,
        transactions,
      };
    },
  },

  Subscribe: {
    url: "wisselbank.xyz",
    guide: {
      label: "Subscriptions",
      href: "/docs/guides/subscriptions",
      prompt:
        "Referencing accounts.tempo.xyz/docs/guides/subscriptions, add subscriptions to my app with the Accounts SDK.",
    },
    prelude: [
      "Checking subscription status",
      {
        before: "Your server will request a recurring payment authorization via ",
        label: "MPP",
        href: "https://mpp.dev",
      },
    ],
    Body: SubscribeBody,
    async run(provider, ctx) {
      const account = await requireConnectedAccount(provider);

      if (ctx.variant === "cancel") {
        const subscriptionId = ctx.previousResult?.subscriptionId;
        if (!subscriptionId) throw new Error("Subscribe before cancelling.");
        return {
          summary: "Subscription cancelled",
          complete: false,
          subscriptionId,
          subscriptionReceipts: ctx.previousResult?.subscriptionReceipts,
          subscriptionState: "cancelled",
        };
      }

      if (ctx.variant === "collect") {
        const subscriptionId = ctx.previousResult?.subscriptionId;
        if (!subscriptionId) throw new Error("Subscribe before collecting.");
        const res = await fetch("/__subscriptions/collect", {
          body: JSON.stringify({ subscriptionId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const body = (await res.json().catch(() => null)) as unknown;
        if (!res.ok)
          throw new Error(`${res.status}: ${responseBodyText(body)}`);
        const collection = readCollectResponse(body);
        if (!collection.renewed)
          return {
            summary: "Subscription already current",
            complete: false,
            subscriptionId: collection.subscriptionId,
            subscriptionNextCollectAt: Date.now() + SUBSCRIPTION_PERIOD_MS,
            subscriptionReceipts: ctx.previousResult?.subscriptionReceipts,
            subscriptionState: "current",
          };

        const receipt = collection.receipt;
        if (!receipt) throw new Error("Missing renewal receipt.");
        return {
          summary: "Renewal collected",
          subscriptionId: collection.subscriptionId,
          subscriptionNextCollectAt: subscriptionNextCollectAt(receipt),
          subscriptionReceipts: [
            ...(ctx.previousResult?.subscriptionReceipts ?? []),
            subscriptionReceipt("Renewal", receipt),
          ],
          subscriptionState: "active",
        };
      }

      const res = await fetch("/api/articles", {
        headers: { "X-Subscriber": account },
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) throw new Error(`${res.status}: ${responseBodyText(body)}`);
      const header = res.headers.get("Payment-Receipt");
      const receipt = header ? Receipt.deserialize(header) : undefined;
      if (!receipt?.subscriptionId)
        throw new Error("Missing subscription receipt.");
      return {
        summary: "Subscription active",
        complete: false,
        subscriptionId: receipt.subscriptionId,
        subscriptionNextCollectAt: subscriptionNextCollectAt(receipt),
        subscriptionReceipts: [subscriptionReceipt("Activation", receipt)],
        subscriptionState: "active",
      };
    },
  },

  "Fee Sponsorship": {
    url: "wisselbank.xyz",
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
    async run(provider) {
      const receipt = await sendSponsoredTransfer(provider);
      const tx = receipt.transactionHash;
      return {
        summary: "Sponsored transfer sent",
        feePayer: receipt.feePayer,
        sponsoredFee: receipt.sponsoredFee,
        href: tx
          ? `${tempoModerato.blockExplorers.default.url}/tx/${tx}`
          : undefined,
        hrefLabel: tx ? `tx ${shorten(tx)}` : undefined,
      };
    },
  },

  "Swap Currencies": {
    url: "wisselbank.xyz",
    guide: {
      label: "Exchange Currencies",
      href: "/docs/guides/swaps",
      prompt:
        "Referencing accounts.tempo.xyz/docs/guides/swaps, add currency exchange to my app with the Accounts SDK.",
    },
    prelude: ["Fetching best route", "Preparing a pathUSD to alphaUSD quote"],
    Body: TradeBody,
    async run(provider) {
      await requireConnectedAccount(provider);
      const result = (await provider.request({
        method: "wallet_swap",
        params: [
          {
            amount: SWAP_AMOUNT_USD,
            pairToken: ALPHA_USD,
            slippage: 0.005,
            token: PATH_USD,
            type: "sell",
          },
        ],
      } as Parameters<typeof provider.request>[0])) as WalletSwapResult;
      const tx = result.receipt.transactionHash;
      return {
        summary: tx ? "Exchange submitted ·" : "Exchange submitted",
        href: tx
          ? `${tempoModerato.blockExplorers.default.url}/tx/${tx}`
          : undefined,
        hrefLabel: tx ? `tx ${shorten(tx)}` : undefined,
      };
    },
  },
};
