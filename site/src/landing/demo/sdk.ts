import { Provider, Storage, tempoWallet, webAuthn } from "accounts";
import { Hex } from "ox";
import { parseUnits } from "viem";
import { tempo, tempoModerato } from "viem/tempo/chains";
import type {
  Adapter,
  AccountsProvider,
  DemoNetwork,
  DemoProviderProfile,
} from "./types";

/** All on-chain demo CTAs sign for $0.01 — the merchant display copy is just storytelling. */
export const DEMO_AMOUNT_USD = "0.01";
/** Storage namespace so all demos register as one app in wallet.tempo.xyz. */
export const STORAGE_KEY = "tempo-accounts-demo";
/** Tempo path-USD aggregate token (TokenId 0). */
export const PATH_USD =
  "0x20c0000000000000000000000000000000000000" as const;

const ONE_DAY = 24 * 60 * 60;
const FIVE_USD = 5_000_000n;
const PUBLIC_TESTNET_FEE_PAYER = "https://sponsor.moderato.tempo.xyz";
export const SPEND_PERMISSION_LIMIT_USD = "1.00";
export const SPEND_PERMISSION_PAYMENT_COUNT = 5;
export const SPEND_PERMISSION_RECIPIENT =
  "0x0000000000000000000000000000000000000001" as const;
export const SPEND_PERMISSION_VALID_SECONDS = ONE_DAY;

/**
 * True when our origin shares the wallet's registrable domain (`tempo.xyz`).
 * The wallet's authorizeAccessKey validator bypasses the "must include
 * scopes" check for same-domain callers — so `*.tempo.xyz` can co-sign
 * a session key with just `limits`. Localhost and other origins must
 * either include `scopes` or skip authorizeAccessKey entirely.
 */
export function isTrustedHost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "tempo.xyz" || host.endsWith(".tempo.xyz");
}

/**
 * Default `authorizeAccessKey` payload for `wallet_connect`. Mirrors
 * wallet-next's "lazy access key" pattern: at sign-in we co-sign a
 * scoped session key so subsequent demo transactions (Pay Once, Trade,
 * etc.) don't re-prompt the passkey on every click.
 *
 * - `expiry`: 24h from now.
 * - `limits`: $5 ceiling on path-USD over a 1h window — generous enough
 *   for repeated $0.01 demo clicks, tight enough to be safe.
 *
 * Only valid when called from a same-registrable-domain origin (see
 * `isTrustedHost`). Cross-origin callers must also provide `scopes`.
 */
export function defaultAuthorizeAccessKey() {
  return {
    expiry: Math.floor(Date.now() / 1000) + ONE_DAY,
    limits: [
      {
        token: PATH_USD,
        limit: FIVE_USD,
        period: 3600,
      },
    ],
  } as const;
}

function mppForProfile(profile: DemoProviderProfile) {
  if (profile === "spendPermission") return false;
  return undefined;
}

function feePayerForProfile(profile: DemoProviderProfile) {
  if (profile === "feeSponsorship") return PUBLIC_TESTNET_FEE_PAYER;
  return undefined;
}

export function spendPermissionAuthorizeAccessKey() {
  return {
    expiry: Math.floor(Date.now() / 1000) + SPEND_PERMISSION_VALID_SECONDS,
    limits: [
      {
        token: PATH_USD,
        limit: parseUnits(SPEND_PERMISSION_LIMIT_USD, 6),
      },
    ],
    scopes: [
      {
        address: PATH_USD,
        selector: "transfer(address,uint256)",
      },
    ],
  } as const;
}

/** Resolved colour-scheme to apply to the Tempo wallet dialog. Mirrors
 * the landing page's `data-theme` so the popup opens light/dark to match
 * the surrounding page. */
export type DialogScheme = "light" | "dark";

export function buildAdapter(adapter: Adapter, scheme: DialogScheme = "dark") {
  if (adapter === "webAuth") return webAuthn();
  return tempoWallet({
    name: "Accounts SDK",
    theme: { radius: "none", scheme },
  });
}

/** Returns the Tempo chain used by a landing demo network. */
export function chainForNetwork(network: DemoNetwork) {
  if (network === "testnet") return tempoModerato;
  return tempo;
}

function storageKeyForNetwork(network: DemoNetwork) {
  return `${STORAGE_KEY}-${network}`;
}

/** Switches the provider to the chain backing the requested demo network. */
export async function ensureNetwork(
  provider: AccountsProvider,
  network: DemoNetwork,
) {
  const chain = chainForNetwork(network);
  const current = (await provider.request({
    method: "eth_chainId",
  } as Parameters<typeof provider.request>[0])) as number | `0x${string}`;
  const currentId =
    typeof current === "number" ? current : Hex.toNumber(current);
  if (currentId === chain.id) return;
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: Hex.fromNumber(chain.id) }],
  } as Parameters<typeof provider.request>[0]);
}

type WalletConnectResult = {
  accounts?: ReadonlyArray<{
    address: `0x${string}`;
    capabilities?: {
      keyAuthorization?: {
        address?: `0x${string}` | undefined;
        expiry?: `0x${string}` | number | bigint | null | undefined;
        keyId?: `0x${string}` | undefined;
      } | undefined;
    } | undefined;
  }>;
};

/** Opens the wallet sign-in flow and returns the raw wallet_connect result. */
export async function connectWalletResult(
  provider: AccountsProvider,
  options: { authorizeDefaultAccessKey?: boolean | undefined } = {},
) {
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
  if (options.authorizeDefaultAccessKey !== false && isTrustedHost()) {
    capabilities.authorizeAccessKey = defaultAuthorizeAccessKey();
  }
  return (await provider.request({
    method: "wallet_connect",
    params: [{ capabilities } as Record<string, unknown>],
  })) as WalletConnectResult;
}

/** Opens the wallet sign-in flow and returns the connected account address. */
export async function connectWallet(
  provider: AccountsProvider,
  options: { authorizeDefaultAccessKey?: boolean | undefined } = {},
) {
  const result = await connectWalletResult(provider, options);
  return result?.accounts?.[0]?.address ?? null;
}

export function createProvider(
  adapter: Adapter,
  scheme: DialogScheme = "dark",
  network: DemoNetwork = "mainnet",
  profile: DemoProviderProfile = "standard",
): AccountsProvider {
  // Storage pattern lifted from wallet-next/src/lib/config.ts:
  // cookie + localStorage is synchronous (no async hydration delay) and
  // is what the wallet itself uses. `key` namespaces everything to this
  // demo so multiple Tempo apps on the same domain don't collide.
  const key = storageKeyForNetwork(network);
  const chain = chainForNetwork(network);
  const feePayer = feePayerForProfile(profile);
  const mpp = mppForProfile(profile);
  const authorizeAccessKey =
    profile === "spendPermission"
      ? spendPermissionAuthorizeAccessKey
      : undefined;
  const storage = Storage.combine(
    Storage.cookie({ key }),
    Storage.localStorage({ key }),
  );
  return Provider.create({
    adapter: buildAdapter(adapter, scheme),
    chains: [chain],
    ...(authorizeAccessKey ? { authorizeAccessKey } : {}),
    ...(feePayer ? { feePayer } : {}),
    ...(typeof mpp !== "undefined" ? { mpp } : {}),
    persistCredentials: true,
    storage,
    testnet: network === "testnet",
  });
}

export function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
