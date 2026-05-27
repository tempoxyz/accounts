import { parseUnits } from "viem";
import { type Config, createConfig, createStorage, http } from "wagmi";
import { tempo, tempoModerato } from "wagmi/chains";
import { tempoWallet } from "wagmi/tempo";
import { Storage } from "accounts";
import type { AccountsProvider } from "./types";

/** All on-chain demo CTAs sign for $0.01 — the merchant display copy is just storytelling. */
export const DEMO_AMOUNT_USD = "0.01";
/** Storage namespace so all demos register as one app in wallet.tempo.xyz. */
export const STORAGE_KEY = "tempo-accounts-demo";
/** Tempo path-USD aggregate token (TokenId 0). */
export const PATH_USD =
  "0x20c0000000000000000000000000000000000000" as const;
/** Tempo mainnet chain ID, used by demos that intentionally target production funds. */
export const TEMPO_MAINNET_CHAIN_ID = tempo.id;
/** Tempo Moderato chain ID, used by demos that rely on the public testnet sponsor. */
export const TEMPO_MODERATO_CHAIN_ID = tempoModerato.id;

const ONE_DAY = 24 * 60 * 60;
const FIVE_USD = 5_000_000n;
const PUBLIC_TESTNET_FEE_PAYER = "https://sponsor.moderato.tempo.xyz";
export const SPEND_PERMISSION_LIMIT_USD = "1.00";
export const SPEND_PERMISSION_PAYMENT_COUNT = 5;
export const SPEND_PERMISSION_RECIPIENT =
  "0x0000000000000000000000000000000000000001" as const;
export const SPEND_PERMISSION_VALID_SECONDS = ONE_DAY;
const accountsStorage = Storage.combine(
  Storage.cookie({ key: STORAGE_KEY }),
  Storage.localStorage({ key: STORAGE_KEY }),
);
const wagmiStorage = createStorage({
  storage: typeof window === "undefined" ? undefined : window.localStorage,
});

/**
 * Default `authorizeAccessKey` payload for `wallet_connect`. Mirrors
 * wallet-next's "lazy access key" pattern: at sign-in we co-sign a
 * scoped session key so subsequent demo transactions (Pay Once, Trade,
 * etc.) don't re-prompt the passkey on every click.
 *
 * - `expiry`: 24h from now.
 * - `limits`: $5 ceiling on path-USD over a 1h window — generous enough
 *   for repeated $0.01 demo clicks, tight enough to be safe.
 * - `scopes`: path-USD transfers only, required by the wallet from
 *   localhost and other cross-origin callers.
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
    scopes: [
      {
        address: PATH_USD,
        selector: "transfer(address,uint256)",
      },
    ],
  } as const;
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

type AuthorizeAccessKey =
  | ReturnType<typeof defaultAuthorizeAccessKey>
  | ReturnType<typeof spendPermissionAuthorizeAccessKey>;

type ShowDeposit =
  | boolean
  | {
      amount?: string | undefined;
      displayName?: string | undefined;
      on?: "login" | "register" | undefined;
      token?: `0x${string}` | string | undefined;
    };

type ConnectWalletOptions = {
  authorizeAccessKey?: AuthorizeAccessKey | undefined;
  authorizeDefaultAccessKey?: boolean | undefined;
  chainId?: number | undefined;
  showDeposit?: ShowDeposit | undefined;
};

export const landingDemoWagmiConfig: Config = createConfig({
  chains: [tempoModerato, tempo],
  connectors: [
    tempoWallet({
      feePayer: PUBLIC_TESTNET_FEE_PAYER,
      persistCredentials: true,
      storage: accountsStorage,
      testnet: true,
      theme: { radius: "none" },
      name: "Tempo Accounts SDK",
    }),
  ],
  multiInjectedProviderDiscovery: false,
  storage: wagmiStorage,
  transports: {
    [tempoModerato.id]: http(),
    [tempo.id]: http(),
  },
});

export async function getDemoProvider() {
  const connector = landingDemoWagmiConfig.connectors[0];
  if (!connector) throw new Error("Missing Tempo Wallet connector.");
  return (await connector.getProvider()) as AccountsProvider;
}

export function connectCapabilities(options: {
  authorizeAccessKey?: AuthorizeAccessKey | undefined;
  authorizeDefaultAccessKey?: boolean | undefined;
  showDeposit?: ShowDeposit | undefined;
} = {}) {
  const capabilities: Record<string, unknown> = {};
  if (options.authorizeAccessKey) {
    capabilities.authorizeAccessKey = options.authorizeAccessKey;
  } else if (options.authorizeDefaultAccessKey !== false) {
    capabilities.authorizeAccessKey = defaultAuthorizeAccessKey();
  }
  if (options.showDeposit !== undefined) {
    capabilities.showDeposit = options.showDeposit;
  }
  return capabilities;
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
  options: ConnectWalletOptions = {},
) {
  // Lazy access-key co-signing: every normal connect grants a scoped
  // session key unless the caller supplies a specialized permission.
  return (await provider.request({
    method: "wallet_connect",
    params: [
      {
        capabilities: connectCapabilities(options),
        chainId: options.chainId ?? TEMPO_MODERATO_CHAIN_ID,
      } as Record<string, unknown>,
    ],
  })) as WalletConnectResult;
}

/** Opens the wallet sign-in flow and returns the connected account address. */
export async function connectWallet(
  provider: AccountsProvider,
  options: ConnectWalletOptions = {},
) {
  const result = await connectWalletResult(provider, options);
  return result?.accounts?.[0]?.address ?? null;
}

export function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
