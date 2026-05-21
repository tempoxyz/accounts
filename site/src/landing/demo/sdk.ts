import { Dialog, Provider, Storage, tempoWallet, webAuthn } from "accounts";
import { tempo } from "viem/chains";
import type { Adapter, AccountsProvider } from "./types";

/** Chain the landing demos run against. Swap to `tempoModerato` for testnet. */
export const CHAIN = tempo;
/** Network label shown in the demo's URL bar — derived from `CHAIN.testnet`. */
export const NETWORK: "mainnet" | "testnet" = CHAIN.testnet
  ? "testnet"
  : "mainnet";

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
  // tempoAuth + privy share the dialog adapter under the hood.
  // Dev: use popup — iframe mode trips React 19's logComponentRender
  // cross-origin SecurityError that disrupts the dev overlay.
  // Production: keep iframe (SDK default) for the embedded look.
  const isDev = import.meta.env.DEV;
  return tempoWallet({
    name: "Accounts SDK",
    theme: { radius: "large", scheme },
    ...(isDev ? { dialog: Dialog.popup() } : {}),
  });
}

export function createProvider(
  adapter: Adapter,
  scheme: DialogScheme = "dark",
): AccountsProvider {
  // Storage pattern lifted from wallet-next/src/lib/config.ts:
  // cookie + localStorage is synchronous (no async hydration delay) and
  // is what the wallet itself uses. `key` namespaces everything to this
  // demo so multiple Tempo apps on the same domain don't collide.
  const storage = Storage.combine(
    Storage.cookie({ key: STORAGE_KEY }),
    Storage.localStorage({ key: STORAGE_KEY }),
  );
  return Provider.create({
    adapter: buildAdapter(adapter, scheme),
    persistCredentials: true,
    storage,
  });
}

export function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
