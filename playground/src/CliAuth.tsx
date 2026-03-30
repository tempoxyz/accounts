import * as React from 'react'

type Pending = {
  accessKeyAddress: string
  account?: string | undefined
  chain_id: string
  code: string
  expiry: number
  flow: string
  key_type: string
  limits?: readonly { limit: string; token: string }[] | undefined
  pub_key: string
  root_address: string
  status: 'pending'
}

type Details = Pending | { accountAddress: string; status: string } | { error: string }
type State = {
  details?: Details | undefined
  status: string
}

export function CliAuth() {
  const [code, setCode] = React.useState(
    () => new URL(window.location.href).searchParams.get('code') ?? '',
  )
  const [{ details, status }, setState] = React.useState<State>({
    details: undefined,
    status: 'Paste a device code or open the CLI auth link.',
  })
  const [loading, startTransition] = React.useTransition()
  const serviceUrl = `${window.location.origin}/cli-auth`

  const loadCode = React.useEffectEvent(async (code: string) => {
    setState(await loadPending({ code, serviceUrl }))
  })

  const approveCode = React.useEffectEvent(async (code: string) => {
    setState(await approvePending({ code, serviceUrl }))
  })

  React.useEffect(() => {
    const initialCode = new URL(window.location.href).searchParams.get('code')
    const onCode = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code
      if (!code) return
      setCode(code)
      startTransition(() => {
        void loadCode(code)
      })
    }

    if (initialCode)
      startTransition(() => {
        void loadCode(initialCode)
      })

    window.addEventListener('cli-auth:code', onCode as EventListener)
    return () => window.removeEventListener('cli-auth:code', onCode as EventListener)
  }, [serviceUrl])

  async function inspect() {
    startTransition(() => {
      void loadCode(code)
    })
  }

  async function approve() {
    const current = code.trim()
    if (!current) {
      setState((x) => ({
        ...x,
        status: 'Enter a device code before approving.',
      }))
      return
    }

    startTransition(() => {
      void approveCode(current)
    })
  }

  return (
    <div>
      <p>
        Dev-only CLI auth demo. Open the browser URL from the CLI script, inspect the pending
        request, then approve it here.
      </p>
      <p>
        API host: <code>{serviceUrl}</code>
      </p>
      <div>
        <label htmlFor="cli-auth-code">Device code</label>
      </div>
      <input
        id="cli-auth-code"
        spellCheck={false}
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
      />
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button type="button" onClick={inspect} disabled={loading}>
          Inspect Request
        </button>
        <button type="button" onClick={approve} disabled={loading}>
          {loading ? 'Working…' : 'Approve'}
        </button>
      </div>
      <p>{status}</p>
      <pre>
        {JSON.stringify(
          details ?? {
            note: 'No request loaded yet.',
          },
          null,
          2,
        )}
      </pre>
    </div>
  )
}

async function loadPending(options: { code: string; serviceUrl: string }): Promise<State> {
  const { code, serviceUrl } = options
  const current = code.trim()
  if (!current)
    return {
      details: undefined,
      status: 'Enter a device code to inspect the pending request.',
    }

  const response = await fetch(`${serviceUrl}/pending/${encodeURIComponent(current)}`)
  const body = (await response.json().catch(() => ({}))) as Pending & { error?: unknown }

  if (!response.ok) {
    const error =
      typeof body.error === 'string'
        ? body.error
        : `Unable to load the pending request (${response.status}).`
    return {
      details: { error },
      status: error,
    }
  }

  return {
    details: body,
    status: 'Pending request loaded.',
  }
}

async function approvePending(options: { code: string; serviceUrl: string }): Promise<State> {
  const { code, serviceUrl } = options
  const response = await fetch(`${serviceUrl}/approve`, {
    body: JSON.stringify({ code }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const body = (await response.json().catch(() => ({}))) as {
    accountAddress?: unknown
    error?: unknown
    status?: unknown
  }

  if (!response.ok) {
    const error =
      typeof body.error === 'string' ? body.error : `Approval failed with ${response.status}.`
    return {
      details: { error },
      status: error,
    }
  }

  const details =
    typeof body.accountAddress === 'string' && typeof body.status === 'string'
      ? {
          accountAddress: body.accountAddress,
          status: body.status,
        }
      : undefined

  return {
    details,
    status:
      typeof body.accountAddress === 'string'
        ? `Approved for ${body.accountAddress}.`
        : 'Approved.',
  }
}
