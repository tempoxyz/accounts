import { Provider, Storage, tempoWallet, webAuthn } from "accounts";
import { Hex } from "ox";
import { tempo, tempoModerato } from "viem/tempo/chains";
import type { Adapter, AccountsProvider, DemoNetwork } from "./types";

/** All on-chain demo CTAs sign for $0.01 — the merchant display copy is just storytelling. */
export const DEMO_AMOUNT_USD = "0.01";
/** Storage namespace so all demos register as one app in wallet.tempo.xyz. */
export const STORAGE_KEY = "tempo-accounts-demo";
/** Tempo path-USD aggregate token (TokenId 0). */
export const PATH_USD =
  "0x20c0000000000000000000000000000000000000" as const;

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
  const ONE_DAY = 24 * 60 * 60;
  const FIVE_USD = BigInt(5_000_000); // 6 decimals = $5
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

/** Resolved colour-scheme to apply to the Tempo wallet dialog. Mirrors
 * the landing page's `data-theme` so the popup opens light/dark to match
 * the surrounding page. */
export type DialogScheme = "light" | "dark";

export function buildAdapter(adapter: Adapter, scheme: DialogScheme = "dark") {
  if (adapter === "webAuth") return webAuthn();
  return tempoWallet({
    name: "Accounts SDK",
    theme: { radius: "large", scheme },
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

/** Opens the wallet sign-in flow and returns the connected account address. */
export async function connectWallet(provider: AccountsProvider) {
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
  return result?.accounts?.[0]?.address ?? null;
}

export function createProvider(
  adapter: Adapter,
  scheme: DialogScheme = "dark",
  network: DemoNetwork = "mainnet",
): AccountsProvider {
  // Storage pattern lifted from wallet-next/src/lib/config.ts:
  // cookie + localStorage is synchronous (no async hydration delay) and
  // is what the wallet itself uses. `key` namespaces everything to this
  // demo so multiple Tempo apps on the same domain don't collide.
  const key = storageKeyForNetwork(network);
  const chain = chainForNetwork(network);
  const storage = Storage.combine(
    Storage.cookie({ key }),
    Storage.localStorage({ key }),
  );
  return Provider.create({
    adapter: buildAdapter(adapter, scheme),
    chains: [chain],
    persistCredentials: true,
    storage,
    testnet: network === "testnet",
  });
}

export function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
