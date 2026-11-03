/** A native Expo app, which signs in only on Tempo ID's pages in the system browser. @module */
import { type AccessKey, Actions, Id, type Session } from 'accounts'
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import * as WebBrowser from 'expo-web-browser'
import { Json } from 'ox'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { custom } from 'viem'
import { createClient } from 'viem/tempo'
import { tempo, tempoTestnet } from 'viem/tempo/chains'
import { ousd, redirectUri, tempoId } from './TempoId.ts'

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:5176'

/** The message that the app signs. */
const message = 'Sign in to the mobile playground'

/** Returns the typed data that the app signs, on the chain of the access key. */
function typedData(options: { chainId: number }) {
  return {
    domain: {
      chainId: options.chainId,
      name: 'Mobile playground',
      version: '1',
    },
    message: { contents: message, nonce: 1n },
    primaryType: 'Greeting',
    types: {
      Greeting: [
        { name: 'contents', type: 'string' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
  } as const
}

/** The session's query key. */
const sessionKey = ['session'] as const

function Main() {
  const queryClient = useQueryClient()

  // The saved session from the secure store, or `null`.
  const session = useQuery({
    queryFn: async () => (await tempoId.session.get()) ?? null,
    queryKey: sessionKey,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
  // Signs in on Tempo ID's pages in the system browser, which returns to the app's scheme. With a
  // key, the approval page shows the key and signs it on approval. A closed browser keeps the
  // current session.
  const browser = useMutation({
    mutationFn: (options: signIn.Options) => signIn(options),
    onSuccess: (result) => {
      if (result) queryClient.setQueryData(sessionKey, result)
    },
  })
  // The instance empties the session even when Tempo ID cannot end it, since the user asked to
  // leave, and the error still shows.
  const signOut = useMutation({
    mutationFn: () => tempoId.signOut(),
    onSettled: () => {
      queryClient.setQueryData(sessionKey, null)
    },
  })

  const signedInAs = session.data
  const error = [session, browser, signOut].find((state) => state.error)?.error

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={styles.title}>Mobile playground</Text>
      {session.isPending ? <Text>Checking your Tempo session…</Text> : null}

      {session.isSuccess && !signedInAs ? (
        <>
          <Text>Sign in to continue.</Text>
          <Button
            onPress={() => browser.mutate({ fallback: true, key: true })}
            title="Sign in via authentication sheet"
          />
        </>
      ) : null}

      {signedInAs ? (
        <SignedIn
          session={signedInAs}
          onAuthorizeKey={() => browser.mutate({ fallback: false, key: true })}
          onSignOut={() => signOut.mutate()}
        />
      ) : null}

      <Text accessibilityLiveRegion="polite" role="status">
        {error?.message}
      </Text>
    </ScrollView>
  )
}

/** Signs in on Tempo ID's pages. Returns `undefined` if the user closes the browser. */
async function signIn(
  options: signIn.Options,
): Promise<Session.Session | undefined> {
  try {
    // The instance's `accessKey` requests the key.
    return await tempoId.redirect.signIn(
      options.key ? {} : { accessKey: false },
    )
  } catch (error) {
    // Once the state matches, Tempo ID's refusal of the key, such as a denial or a key for an
    // account that a passkey owns, throws on `code`. On iOS, the second sign-in asks again, since
    // the session was ephemeral.
    if (
      !options.fallback ||
      !options.key ||
      !(error instanceof Id.RequestError) ||
      error.field !== 'code'
    )
      throw error
    return await signIn({ fallback: false, key: false })
  }
}

declare namespace signIn {
  type Options = {
    /** Whether a refused key leads to a sign-in without one. */
    fallback: boolean
    /** Whether the sign-in authorizes an access key. */
    key: boolean
  }
}

/**
 * Shows the signed-in user, the Tempo Account, and the session's details, and the sections that fund
 * the account and pay, sign, and call MPP endpoints with its access key.
 */
function SignedIn(props: SignedIn.Props) {
  const { key, user } = props.session
  const queryClient = useQueryClient()
  // The session's details stay folded until a press.
  const [details, setDetails] = useState(false)
  const api = useMutation({
    mutationFn: async () => {
      // An access token lasts 5 minutes, so an app left open refreshes it first. The refresh token
      // rotates, so the instance saves the new one.
      const session = await (async () => {
        if (props.session.expiresAt - 30_000 > Date.now()) return props.session
        const refreshed = await tempoId.session.refresh()
        queryClient.setQueryData(sessionKey, refreshed ?? null)
        return refreshed ?? props.session
      })()
      const response = await fetch(new URL('/me', apiUrl), {
        headers: { authorization: `Bearer ${session.accessToken}` },
      })
      return JSON.stringify(await response.json())
    },
  })

  return (
    <>
      <Section title="Account">
        <Text>Email {user.email}</Text>
        {key ? <Text>Tempo Account {key.account}</Text> : null}
        {key ? null : <Text>Signed in without an access key.</Text>}
        <View style={styles.row}>
          {key ? null : (
            <Button
              onPress={props.onAuthorizeKey}
              title="Authorize an access key"
            />
          )}
          <Button onPress={() => api.mutate()} title="Call the API" />
          <Button onPress={props.onSignOut} title="Sign out" />
        </View>
        <Text style={styles.output}>{api.data ?? api.error?.message}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: details }}
          onPress={() => setDetails((value) => !value)}
        >
          <Text style={styles.summary}>
            {details ? '▾' : '▸'} Session details
          </Text>
        </Pressable>
        {details ? (
          <Text style={styles.output}>
            {Json.stringify(
              {
                // The tokens stay out of the screen.
                accessKey: key
                  ? {
                      account: key.account,
                      chainId: key.chainId,
                      keyAuthorization: key.keyAuthorization,
                    }
                  : null,
                expiresAt: new Date(props.session.expiresAt).toISOString(),
                user,
              },
              null,
              2,
            )}
          </Text>
        ) : null}
      </Section>
      {key ? (
        <>
          <Funding account={key.account} />
          <Transfers />
          <Signatures account={key.account} />
          <Payments sessionKey={key} />
        </>
      ) : null}
    </>
  )
}

declare namespace SignedIn {
  type Props = {
    /** The session, with its access key if the sign-in authorized one. */
    session: Session.Session
    /** Authorizes an access key through a second redirect. */
    onAuthorizeKey: () => void
    /** Signs out of Tempo ID and forgets the saved session. */
    onSignOut: () => void
  }
}

/** A titled card of the screen. */
function Section(props: Section.Props) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {props.title}
      </Text>
      {props.children}
    </View>
  )
}

declare namespace Section {
  type Props = {
    /** The section's content. */
    children: ReactNode
    /** The heading. */
    title: string
  }
}

/**
 * Opens Tempo ID's deposit page for the Tempo Account in the system browser, which returns to the
 * app's scheme with the result. On a test chain, the page's faucet funds the account.
 */
function Funding(props: Funding.Props) {
  const deposit = useMutation({
    mutationFn: async () => {
      const { chainId, clientId, url } = tempoId.config
      const target = new URL('/deposit', url)
      target.search = new URLSearchParams({
        address: props.account,
        // The page reads `mainnet` and `testnet` by name, and another chain by its ID.
        chain: (() => {
          if (chainId === tempo.id) return 'mainnet'
          if (chainId === tempoTestnet.id) return 'testnet'
          return String(chainId)
        })(),
        client_id: clientId,
        redirect_uri: redirectUri,
      }).toString()
      const result = await WebBrowser.openAuthSessionAsync(
        target.href,
        redirectUri,
      )
      if (result.type !== 'success') return 'Closed the deposit page.'
      const returned = Actions.funding.complete(tempoId.config, {
        redirectUri,
        url: result.url,
      })
      if (returned?.status === 'received')
        return returned.amount === undefined
          ? 'Deposit received.'
          : `Deposit received: ${returned.amount} USD.`
      return 'Returned without a deposit.'
    },
  })
  // On iOS, the sign-in's browser session is ephemeral, so the deposit page has no Tempo ID session
  // and cannot return to the app. On a test chain, the app funds the account from the chain's faucet.
  const faucet = useMutation({
    mutationFn: async () => {
      await tempoId.faucet.fundSync({ account: props.account })
      return 'Funded with testnet tokens.'
    },
  })
  const funding = deposit.isPending || faucet.isPending

  return (
    <Section title="Fund account">
      <View style={styles.row}>
        <Button
          disabled={funding}
          onPress={() => {
            faucet.reset()
            deposit.mutate()
          }}
          title="Deposit"
        />
        {tempoId.config.chainId === tempo.id ? null : (
          <Button
            disabled={funding}
            onPress={() => {
              deposit.reset()
              faucet.mutate()
            }}
            title="Faucet"
          />
        )}
      </View>
      <Text style={styles.output}>
        {(() => {
          if (deposit.isPending) return 'Waiting for the deposit page…'
          if (faucet.isPending) return 'Funding…'
          return (
            deposit.data ??
            faucet.data ??
            (deposit.error ?? faucet.error)?.message
          )
        })()}
      </Text>
    </Section>
  )
}

declare namespace Funding {
  type Props = {
    /** The address of the user's Tempo Account, which the deposit page funds. */
    account: `0x${string}`
  }
}

/** Sends OUSD with the access key. */
function Transfers() {
  // Viem attaches the key's authorization to its first transaction.
  const send = useMutation({
    mutationFn: async () => {
      // The client's account follows the session's access key, so the transfer names none.
      const { receipt } = await tempoId.token.transferSync({
        amount: 10_000n,
        to: '0x000000000000000000000000000000000000dEaD',
        token: ousd,
      })
      return `${receipt.status} ${receipt.transactionHash}`
    },
  })

  return (
    <Section title="Send payments">
      <Button
        disabled={send.isPending}
        onPress={() => send.mutate()}
        title="Send 0.01 OUSD"
      />
      <Text style={styles.output}>
        {send.isPending ? 'Sending…' : (send.data ?? send.error?.message)}
      </Text>
    </Section>
  )
}

/**
 * Signs a message and typed data with the access key, and verifies each signature on chain, which
 * holds the access key only after its first transaction.
 */
function Signatures(props: Signatures.Props) {
  const sign = useMutation({
    mutationFn: async (kind: 'message' | 'typed-data') => {
      const client = tempoId.viem()
      // Reads go through the same transport without an account, since the node checks a key's
      // scopes on a call from its account.
      const reader = createClient({
        chain: client.chain,
        transport: custom(client),
      })
      const data = typedData({ chainId: client.chain.id })
      const signature = await (kind === 'message'
        ? client.signMessage({ message })
        : client.signTypedData(data))
      const verified = await (kind === 'message'
        ? reader.verifyMessage({
            address: props.account,
            message,
            mode: 'allowAccessKey',
            signature,
          })
        : reader.verifyTypedData({
            ...data,
            address: props.account,
            mode: 'allowAccessKey',
            signature,
          }))
      return `${kind === 'message' ? 'Message' : 'Typed data'}. Verified: ${verified ? 'Yes' : 'No'}.\n${signature}`
    },
  })

  return (
    <Section title="Sign messages">
      <View style={styles.row}>
        <Button
          disabled={sign.isPending}
          onPress={() => sign.mutate('message')}
          title="Sign message"
        />
        <Button
          disabled={sign.isPending}
          onPress={() => sign.mutate('typed-data')}
          title="Sign typed data"
        />
      </View>
      <Text style={styles.output}>
        {sign.isPending ? 'Signing…' : (sign.data ?? sign.error?.message)}
      </Text>
    </Section>
  )
}

declare namespace Signatures {
  type Props = {
    /** The address of the user's Tempo Account, which the access key signs for. */
    account: `0x${string}`
  }
}

/**
 * Pays the API playground's MPP routes with the access key: a charge of 0.01 OUSD, and a session that
 * pays each request with a voucher until the app closes it.
 */
function Payments(props: Payments.Props) {
  // The session's channel stays open across requests, until a close starts the next one. A new
  // access key starts one too.
  const [closes, setCloses] = useState(0)
  const manager = useMemo(
    () => tempoId.mpp.session({ maxDeposit: '0.05' }),
    [props.sessionKey, closes],
  )
  // The manager holds its channel in memory alone. A sign-out, a new access key, or a close replaces
  // or drops it, so the cleanup closes an open channel first, which returns its deposit. A request in
  // progress can still open a channel, so the cleanup waits for it to settle first.
  const pending = useRef<Promise<unknown>>(Promise.resolve())
  useEffect(
    () => () => {
      // The app discards the manager either way, so a failed close leaves only the channel open.
      void pending.current
        .catch(() => undefined)
        .then(() => (manager.opened ? manager.close() : undefined))
        .catch(() => undefined)
    },
    [manager],
  )
  const charge = useMutation({
    mutationFn: async () => {
      const response = await tempoId.fetch(new URL('/mpp/charge', apiUrl))
      return `${response.status} ${await response.text()}`
    },
  })
  const pay = useMutation({
    mutationFn: async () => {
      const request = manager.fetch(new URL('/mpp/session', apiUrl))
      pending.current = request
      const response = await request
      return `${response.status}: spent ${response.receipt?.spent ?? 0} of ${response.receipt?.acceptedCumulative ?? 0}`
    },
  })
  const close = useMutation({
    mutationFn: async () => {
      const receipt = await manager.close()
      setCloses((count) => count + 1)
      return receipt ? `Closed: ${receipt.status}` : 'No session to close.'
    },
  })

  // The manager holds one channel's state, so one session operation runs at a time.
  const sessionPending = pay.isPending || close.isPending

  return (
    <Section title="MPP">
      <Text style={styles.subheading}>Charge</Text>
      <Text style={styles.muted}>0.01 OUSD for one request.</Text>
      <Button
        disabled={charge.isPending}
        onPress={() => charge.mutate()}
        title="Pay an MPP charge"
      />
      <Text style={styles.output}>
        {charge.isPending ? 'Paying…' : (charge.data ?? charge.error?.message)}
      </Text>
      <Text style={styles.subheading}>Session</Text>
      <Text style={styles.muted}>0.01 OUSD for each request, in vouchers.</Text>
      <View style={styles.row}>
        <Button
          disabled={sessionPending}
          onPress={() => {
            // One output shows the last operation, so each clears the other's result.
            close.reset()
            pay.mutate()
          }}
          title="Pay with an MPP session"
        />
        <Button
          disabled={sessionPending}
          onPress={() => {
            pay.reset()
            close.mutate()
          }}
          title="Close the MPP session"
        />
      </View>
      <Text style={styles.output}>
        {(() => {
          if (pay.isPending) return 'Paying…'
          if (close.isPending) return 'Closing…'
          return close.data ?? pay.data ?? (close.error ?? pay.error)?.message
        })()}
      </Text>
    </Section>
  )
}

declare namespace Payments {
  type Props = {
    /** The session's access key, whose change starts a new session manager. */
    sessionKey: AccessKey.AccessKey
  }
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '600' },
  muted: { color: '#737373', fontSize: 14 },
  output: { fontFamily: 'Menlo', fontSize: 12 },
  page: { gap: 16, padding: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  section: {
    borderColor: '#e5e5e5',
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  subheading: { fontSize: 14, fontWeight: '600' },
  summary: { fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '600' },
})

const queryClient = new QueryClient()

/** The root component, with the query client. */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Main />
    </QueryClientProvider>
  )
}
