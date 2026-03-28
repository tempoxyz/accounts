import { tempo, tempoModerato } from 'viem/chains'
import * as z from 'zod/mini'

import { webAuthn } from '../../../src/core/adapters/webAuthn.js'
import * as Ceremony from '../../../src/core/Ceremony.js'
import * as Provider from '../../../src/core/Provider.js'
import * as Storage from '../../../src/core/Storage.js'
import * as Rpc from '../../../src/core/zod/rpc.js'

type Pending = {
  access_key_address: `0x${string}`
  account?: `0x${string}` | undefined
  chain_id: `0x${string}`
  code: string
  expiry: number
  key_type: 'secp256k1' | 'p256' | 'webAuthn'
  limits?: readonly { token: `0x${string}`; limit: `0x${string}` }[] | undefined
  pub_key: `0x${string}`
  status: 'pending'
}

type AuthorizationResult = {
  accounts: {
    address?: `0x${string}` | undefined
    capabilities: {
      keyAuthorization?: z.output<typeof Rpc.keyAuthorization> | undefined
    }
  }[]
}

const ceremony = Ceremony.server({ url: '/webauthn' })
const storage = Storage.idb({ key: 'tempo-server' })
const channel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tempo-cli-auth') : null
const provider = Provider.create({
  adapter: webAuthn({ ceremony }),
  chains: [tempo, tempoModerato],
  storage,
})
const tabId = crypto.randomUUID()

const codeInput = element<HTMLInputElement>('code')
const pendingPanel = element<HTMLElement>('pending')
const statusPanel = element<HTMLElement>('status')
const accountPanel = element<HTMLElement>('account')
const approvalPanel = element<HTMLElement>('approval')
const registerButton = element<HTMLButtonElement>('register')
const loginButton = element<HTMLButtonElement>('login')
const approveButton = element<HTMLButtonElement>('approve')
const disconnectButton = element<HTMLButtonElement>('disconnect')
const resetButton = element<HTMLButtonElement>('reset')

let account: `0x${string}` | undefined
let busy = false
let pending: Pending | undefined

function element<type extends HTMLElement>(id: string) {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as type
}

function item(term: string, description: string) {
  return `<div><dt>${escape(term)}</dt><dd>${escape(description)}</dd></div>`
}

function matchesRequestedAccount() {
  if (!pending?.account || !account) return true
  return pending.account.toLowerCase() === account.toLowerCase()
}

function accessKeyRequest(value: Pending) {
  return {
    expiry: value.expiry,
    keyType: value.key_type,
    ...(value.limits ? { limits: value.limits } : {}),
    publicKey: value.pub_key,
  }
}

function primaryActionLabel() {
  if (!pending) return 'Authenticate and authorize key'
  if (!account || !matchesRequestedAccount()) return 'Authenticate and authorize key'
  return 'Authorize key'
}

function readyStatus(value: Pending) {
  if (!account)
    return `Ready. ${primaryActionLabel()} to approve access key ${value.access_key_address}.`
  if (!matchesRequestedAccount() && value.account)
    return `Ready. Authenticate as ${value.account} to approve access key ${value.access_key_address}.`
  return `Ready. Authorize access key ${value.access_key_address}.`
}

function syncUi() {
  registerButton.textContent = pending ? 'Create passkey and authorize key' : 'Create passkey'
  loginButton.textContent = pending ? 'Sign in and authorize key' : 'Sign in with passkey'
  registerButton.disabled = busy || !pending
  loginButton.disabled = busy || !pending
  approveButton.disabled = busy || !pending
  approveButton.textContent = primaryActionLabel()
  disconnectButton.disabled = busy || !account
  resetButton.disabled = busy
  approvalPanel.textContent = approvalText()

  if (!account) {
    accountPanel.textContent = 'Not signed in.'
    return
  }

  if (pending?.account && !matchesRequestedAccount()) {
    accountPanel.textContent = `Signed in as ${account}. This request requires ${pending.account}.`
    return
  }

  accountPanel.textContent = `Signed in as ${account}.`
}

function approvalText() {
  if (!pending) return 'Load a pending request to continue.'
  if (!account)
    return `Authenticate and authorize access key ${pending.access_key_address} for device code ${pending.code}.`
  if (!matchesRequestedAccount() && pending.account)
    return `Authenticate as ${pending.account} and authorize access key ${pending.access_key_address} for device code ${pending.code}.`
  return `Authorize access key ${pending.access_key_address} for device code ${pending.code}.`
}

function setBusyState(value: boolean) {
  busy = value
  syncUi()
}

function setStatus(message: string) {
  statusPanel.textContent = message
}

function renderPending(value: Pending) {
  const limits = value.limits?.length
    ? item('Limits', value.limits.map(({ limit, token }) => `${token}: ${limit}`).join(', '))
    : ''

  pendingPanel.innerHTML = `
    <dl>
      ${item('Code', value.code)}
      ${item('Access key', value.access_key_address)}
      ${item('Public key', value.pub_key)}
      ${item('Key type', value.key_type)}
      ${item('Chain', value.chain_id)}
      ${item('Expiry', `${value.expiry}`)}
      ${value.account ? item('Requested account', value.account) : ''}
      ${limits}
    </dl>
  `
}

async function readJson<type>(response: Response): Promise<type> {
  return (await response.json()) as type
}

async function loadPending(code: string) {
  const response = await fetch(`/cli-auth/pending/${encodeURIComponent(code)}`)
  if (!response.ok) {
    const json = await readJson<{ error?: string }>(response)
    throw new Error(json.error ?? 'Failed to load pending request.')
  }
  return await readJson<Pending>(response)
}

async function loadLatestPending() {
  if (busy) return
  const response = await fetch('/cli-auth/latest')
  if (response.status === 204) return
  if (!response.ok) return

  const next = await readJson<Pending>(response)
  if (pending?.code === next.code) return

  pending = next
  codeInput.value = pending.code
  renderPending(pending)

  // Auto-authorize if already signed in
  if (account && matchesRequestedAccount()) {
    setStatus(`New request detected. Authorizing access key ${pending.access_key_address}…`)
    syncUi()
    try {
      if (account) await authorizeOnly()
      else await authenticateAndApprove()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Auto-authorization failed.')
    }
    return
  }

  setStatus('New access-key request loaded automatically.')
  syncUi()
}

async function showPending(code: string, options: showPending.Options = {}) {
  const { broadcast = true } = options

  setBusyState(true)
  setStatus('Loading pending request…')

  try {
    pending = await loadPending(code)
    codeInput.value = pending.code
    renderPending(pending)
    setStatus(readyStatus(pending))

    if (broadcast)
      channel?.postMessage({
        code: pending.code,
        source: tabId,
        type: 'load-code',
      } satisfies Message)
  } catch (error) {
    pending = undefined
    pendingPanel.innerHTML = ''
    setStatus(error instanceof Error ? error.message : 'Failed to load pending request.')
  } finally {
    setBusyState(false)
  }
}

async function connect(mode: 'register' | 'login') {
  setBusyState(true)
  setStatus(
    pending
      ? mode === 'register'
        ? 'Creating Tempo passkey and authorizing key…'
        : 'Signing in and authorizing key…'
      : mode === 'register'
        ? 'Creating Tempo passkey…'
        : 'Waiting for passkey…',
  )

  try {
    const current = pending
    if (current) {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: current.chain_id }],
      })
      const lastCredentialId = await storage.getItem<string>('lastCredentialId')
      const result = (await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities:
              mode === 'register'
                ? {
                    authorizeAccessKey: accessKeyRequest(current),
                    method: 'register',
                    name: 'Tempo CLI',
                  }
                : {
                    ...(lastCredentialId ? { credentialId: lastCredentialId } : {}),
                    authorizeAccessKey: accessKeyRequest(current),
                    selectAccount: true,
                  },
          },
        ],
      })) as AuthorizationResult
      const authorized = authorizationResult(result)
      if (current.account && current.account.toLowerCase() !== authorized.account.toLowerCase())
        throw new Error(`This request requires ${current.account}, not ${authorized.account}.`)
      account = authorized.account
      await postAuthorization(current, authorized)
      setStatus('Approved. Return to the terminal to finish wallet_connect.')
      return
    }

    const result =
      mode === 'register'
        ? await provider.request({
            method: 'wallet_connect',
            params: [{ capabilities: { method: 'register', name: 'Tempo CLI' } }],
          })
        : await provider.request({
            method: 'wallet_connect',
            params: [{ capabilities: { selectAccount: true } }],
          })

    account = result.accounts[0]?.address
    if (!account) throw new Error('No account returned from passkey flow.')

    setStatus('Passkey account ready.')
  } finally {
    setBusyState(false)
  }
}

function authorizationResult(result: AuthorizationResult) {
  const connected = result.accounts[0]
  const keyAuthorization = connected?.capabilities.keyAuthorization
  if (!connected?.address) throw new Error('No account returned for authorization.')
  if (!keyAuthorization) throw new Error('No key authorization returned from wallet_connect.')
  return { account: connected.address, keyAuthorization }
}

async function postAuthorization(
  current: Pending,
  options: {
    account: `0x${string}`
    keyAuthorization: z.output<typeof Rpc.keyAuthorization>
  },
) {
  const response = await fetch('/cli-auth/authorize', {
    body: JSON.stringify({
      account_address: options.account,
      code: current.code,
      key_authorization: options.keyAuthorization,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!response.ok) {
    const json = await readJson<{ error?: string }>(response)
    throw new Error(json.error ?? 'Failed to approve request.')
  }
}

async function authenticateAndApprove() {
  if (!pending) throw new Error('No pending request loaded.')
  const current = pending

  setBusyState(true)
  setStatus('Authenticating and authorizing key…')

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: current.chain_id }],
    })
    const lastCredentialId = await storage.getItem<string>('lastCredentialId')
    const login = Boolean(lastCredentialId || account || current.account)
    const result = (await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: login
            ? {
                ...(lastCredentialId ? { credentialId: lastCredentialId } : {}),
                authorizeAccessKey: accessKeyRequest(current),
                selectAccount: true,
              }
            : {
                authorizeAccessKey: accessKeyRequest(current),
                method: 'register',
                name: 'Tempo CLI',
              },
        },
      ],
    })) as AuthorizationResult
    const authorized = authorizationResult(result)
    if (current.account && current.account.toLowerCase() !== authorized.account.toLowerCase())
      throw new Error(`This request requires ${current.account}, not ${authorized.account}.`)
    account = authorized.account
    await postAuthorization(current, authorized)
    setStatus('Approved. Return to the terminal to finish wallet_connect.')
  } finally {
    setBusyState(false)
  }
}

async function authorizeOnly() {
  if (!pending) throw new Error('No pending request loaded.')
  const current = pending
  if (!account) throw new Error('No authenticated account available.')
  if (current.account && current.account.toLowerCase() !== account.toLowerCase())
    throw new Error(`This request requires ${current.account}, not ${account}.`)

  setBusyState(true)
  setStatus('Authorizing key…')

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: current.chain_id }],
    })
    const result = (await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: {
            authorizeAccessKey: accessKeyRequest(current),
          },
        },
      ],
    })) as AuthorizationResult
    const authorized = authorizationResult(result)
    account = authorized.account
    await postAuthorization(current, authorized)
    setStatus('Approved. Return to the terminal to finish wallet_connect.')
  } finally {
    setBusyState(false)
  }
}

registerButton.addEventListener('click', async () => {
  try {
    await connect('register')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to create passkey.')
  }
})

loginButton.addEventListener('click', async () => {
  try {
    await connect('login')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to sign in with passkey.')
  }
})

approveButton.addEventListener('click', async () => {
  try {
    if (!account || !matchesRequestedAccount()) await authenticateAndApprove()
    else await authorizeOnly()
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to approve request.')
  }
})

disconnectButton.addEventListener('click', async () => {
  setBusyState(true)
  try {
    await provider.request({ method: 'wallet_disconnect' })
    account = undefined
    setStatus('Signed out.')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to sign out.')
  } finally {
    setBusyState(false)
  }
})

resetButton.addEventListener('click', async () => {
  setBusyState(true)
  try {
    await provider.request({ method: 'wallet_disconnect' }).catch(() => undefined)
    await Promise.all([storage.removeItem('lastCredentialId'), storage.removeItem('store')])
    account = undefined
    setStatus(
      'Browser storage cleared. Remove the localhost passkey and restart the dev server to fully reset.',
    )
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Failed to reset browser storage.')
  } finally {
    setBusyState(false)
  }
})

channel?.addEventListener('message', ({ data }) => {
  if (!isMessage(data)) return
  if (data.type !== 'load-code') return
  if (data.source === tabId) return
  if (pending?.code === data.code) return
  void showPending(data.code, { broadcast: false })
})

async function main() {
  const code = new URL(window.location.href).searchParams.get('code') ?? codeInput.value
  if (!code) {
    setStatus('Enter the device code from the terminal to load a pending request.')
    syncUi()
    return
  }

  await showPending(code)
}

void main()
setInterval(() => void loadLatestPending(), 2_000)

function escape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function isMessage(value: unknown): value is Message {
  return Boolean(
    value && typeof value === 'object' && 'code' in value && 'source' in value && 'type' in value,
  )
}

declare namespace showPending {
  type Options = {
    broadcast?: boolean | undefined
  }
}

type Message = {
  code: string
  source: string
  type: 'load-code'
}
