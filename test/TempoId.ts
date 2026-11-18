/**
 * The Tempo ID of the end-to-end suite: the `id-dev` image, which holds Tempo ID, its database, and an
 * inbox that returns each sign-in code. `TEMPO_ID_IMAGE` names another image. With `TEMPO_ID_URL`, the
 * suite starts no container, and uses the `id-dev` instance at that URL.
 * @module
 */
import { GenericContainer, Wait } from 'testcontainers'
import * as Chain from './Chain.js'
import * as Images from './Images.js'

/** An app that the container registers at its start, as an entry of its `ID_DEV_APPS`. */
export type App = {
  /** The URL that receives a logout token for each session of the app that ends at Tempo ID. */
  backchannelLogoutUri?: string | undefined
  /** Whether the app's backend signs users in with an emailed code, without Tempo ID's pages. */
  backendSignIn?: boolean | undefined
  /** The client ID, of 8 to 64 characters. */
  clientId: string
  /** A backend's client secret, of at least 32 characters. Without it and `jwks`, the app is public. */
  clientSecret?: string | undefined
  /** Whether each token request of the app must send a DPoP proof. */
  dpop?: boolean | undefined
  /** The first Tempo Account of the app's new users. Absent, Tempo ID's cloud wallet owns it. */
  firstAccount?: 'passkey' | 'server' | undefined
  /** Whether the app holds `tempo-id:iframe`, so its dialog's frame trusts the page that frames it. */
  iframe?: boolean | undefined
  /** The public keys of the app's client assertions, each with a `kid`. Excludes `clientSecret`. */
  jwks?: { keys: readonly JsonWebKey[] } | undefined
  /** The name that the approval page shows. */
  name: string
  /** The redirect URIs, which may use `http` and a loopback host. */
  redirectUris: readonly string[]
  /** The seconds that each refresh token lives. Absent, Tempo ID's default applies. */
  refreshTokenLifetime?: number | undefined
  /**
   * Whether the app holds `tempo-id:sign`, so a sign-in of its own form may carry a challenge, and
   * an access key above the headless ceiling.
   */
  sign?: boolean | undefined
}

/**
 * A registered resource that the container holds from its start, as an entry of its
 * `ID_DEV_RESOURCES`: an API that an app names as `resource`.
 */
export type Resource = {
  /** The identifier that a request names as `resource`, an `https` URI that no request reaches. */
  identifier: string
  /** The name that the approval page shows. */
  name: string
  /** The access key policy. Absent, the resource issues only access tokens. */
  policy?: Policy | undefined
}

/** The access key policy of a {@link Resource}: what each access key of the API may do. */
export type Policy = {
  /**
   * The URL that Tempo ID requests each access key's public key from, at an approval. Tempo ID
   * posts from inside the container. Absent, the API redeems each allowance with its own public key.
   */
  accessKeyEndpoint?: string | undefined
  /** The chain of each access key. */
  chainId: number
  /** The app of the registrations that the API authenticates as. */
  clientId: string
  /** The seconds from an approval until its access key expires. */
  lifetime: number
  /** The spending limits. */
  limits: readonly {
    /** The amount in the token's base units, as hex. */
    limit: `0x${string}`
    /** The token. */
    token: `0x${string}`
  }[]
  /** The calls that each access key may make. */
  scopes: readonly {
    /** The contract. */
    address: `0x${string}`
    /** The function's selector. Absent, each function. */
    selector?: `0x${string}` | undefined
  }[]
}

/** The URL of a running `id-dev` instance that the suite uses in place of its own, from `TEMPO_ID_URL`. */
export const external = process.env.TEMPO_ID_URL || undefined

/** The image: `TEMPO_ID_IMAGE`, or a commit of `tempoxyz/id` that serves the deferred siwe challenge. */
export const image =
  process.env.TEMPO_ID_IMAGE ||
  'ghcr.io/tempoxyz/id-dev:d130cf0d808bce2e3047044231923597b9510bbd'

/** The port that the container serves on, and publishes on the host. */
export const port = 8787

/**
 * Tempo ID's URL: `TEMPO_ID_URL`, or the container's. The browser and the apps reach Tempo ID at this
 * origin, which is also each token's issuer.
 */
export const url = new URL(external ?? `http://localhost:${port}`).origin

/**
 * Starts the container with the suite's node as its `local` chain, and waits until Tempo ID serves
 * requests. With `TEMPO_ID_URL`, starts nothing, and checks the instance at that URL, which must hold
 * the suite's node and apps itself. Returns `stop`. Throws if Tempo ID does not serve requests.
 */
export async function start(
  options: start.Options = {},
): Promise<start.ReturnType> {
  if (external) {
    const response = await fetch(`${url}/__id-dev/health`, {
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined)
    await response?.body?.cancel()
    if (response?.status !== 204)
      throw new Error(
        `Tempo ID at ${url} responded with ${response?.status ?? 'no response'} to its health check. Start an \`id-dev\` instance there, or unset \`TEMPO_ID_URL\`.`,
      )
    return { stop: () => Promise.resolve() }
  }

  const { apps = [], resources = [] } = options
  await Images.pulled({ image })
  const container = await new GenericContainer(image)
    .withEnvironment({
      ID_DEV_APPS: JSON.stringify(apps),
      ID_DEV_RESOURCES: JSON.stringify(resources),
      RPC_URLS: [
        `local:${Chain.chain.id}=${Chain.reachable(Chain.rpcUrl)}`,
        `devnet:${Chain.second.chain.id}=${Chain.reachable(Chain.second.rpcUrl)}`,
      ].join(','),
    })
    .withExposedPorts({ container: port, host: port })
    .withExtraHosts([
      { host: 'host.docker.internal', ipAddress: 'host-gateway' },
    ])
    // A fresh machine pulls the image first, and each start applies the migrations.
    .withStartupTimeout(5 * 60_000)
    .withWaitStrategy(Wait.forHttp('/__id-dev/health', port).forStatusCode(204))
    .start()
  return {
    stop: async () => {
      await container.stop()
    },
  }
}

export declare namespace start {
  type Options = {
    /** The apps that Tempo ID registers. Defaults to none. */
    apps?: readonly App[] | undefined
    /** The resources that Tempo ID registers after the apps. Defaults to none. */
    resources?: readonly Resource[] | undefined
  }

  type ReturnType = {
    /** Stops the container that the suite started. */
    stop: () => Promise<void>
  }
}
