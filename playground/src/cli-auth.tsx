import { useEffect, useState } from 'react'

type Pending = {
  access_key_address: string
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

type Details = Pending | { account_address: string; status: string } | { error: string }

export function CliAuth() {
  const url = new URL(window.location.href)
  const [code, setCode] = useState(url.searchParams.get('code') ?? '')
  const [details, setDetails] = useState<Details | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Paste a device code or open the CLI auth link.')
  const serviceUrl = `${window.location.origin}/cli-auth`

  useEffect(() => {
    const initialCode = new URL(window.location.href).searchParams.get('code')
    if (!initialCode) return
    void loadPending({ code: initialCode, serviceUrl, setDetails, setLoading, setStatus })
  }, [serviceUrl])

  async function inspect() {
    await loadPending({ code, serviceUrl, setDetails, setLoading, setStatus })
  }

  async function approve() {
    const current = code.trim()
    if (!current) {
      setStatus('Enter a device code before approving.')
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`${serviceUrl}/approve`, {
        body: JSON.stringify({ code: current }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      const body = (await response.json().catch(() => ({}))) as {
        account_address?: unknown
        error?: unknown
        status?: unknown
      }

      if (!response.ok) {
        const error =
          typeof body.error === 'string' ? body.error : `Approval failed with ${response.status}.`
        setDetails({ error })
        setStatus(error)
        return
      }

      setDetails(
        typeof body.account_address === 'string' && typeof body.status === 'string'
          ? {
              account_address: body.account_address,
              status: body.status,
            }
          : undefined,
      )
      setStatus(
        typeof body.account_address === 'string'
          ? `Approved for ${body.account_address}.`
          : 'Approved.',
      )
    } finally {
      setLoading(false)
    }
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

async function loadPending(options: {
  code: string
  serviceUrl: string
  setDetails: (details: Details | undefined) => void
  setLoading: (loading: boolean) => void
  setStatus: (status: string) => void
}) {
  const { code, serviceUrl, setDetails, setLoading, setStatus } = options
  const current = code.trim()
  if (!current) {
    setDetails(undefined)
    setStatus('Enter a device code to inspect the pending request.')
    return
  }

  setLoading(true)
  try {
    const response = await fetch(`${serviceUrl}/pending/${encodeURIComponent(current)}`)
    const body = (await response.json().catch(() => ({}))) as Pending & { error?: unknown }

    if (!response.ok) {
      const error =
        typeof body.error === 'string'
          ? body.error
          : `Unable to load the pending request (${response.status}).`
      setDetails({ error })
      setStatus(error)
      return
    }

    setDetails(body)
    setStatus('Pending request loaded.')
  } finally {
    setLoading(false)
  }
}
