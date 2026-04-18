import { Frame } from '#/ui/Frame.js'
import { useEffect, useMemo, useState } from 'react'
import Check from '~icons/lucide/check'
import Copy from '~icons/lucide/copy'

/** Generic EIP-712 typed data signing screen — shows the domain and flattened message fields. */
export function TypedData(props: TypedData.Props) {
  const { confirming, data, host, onConfirm, onReject } = props

  const entries = useMemo(() => (data ? flattenMessage(data.message) : []), [data])

  return (
    <Frame>
      <Frame.Header
        subtitle={
          host ? (
            <>
              <span className="text-foreground">{host}</span> is requesting your signature.
            </>
          ) : undefined
        }
        title="Sign Message"
      />
      <Frame.Body>
        {data && (
          <div className="max-h-[200px] overflow-auto rounded-body bg-pane">
            <div className="px-4 py-3">
              {data.domain?.name && (
                <p className="pb-2 text-label-13 text-foreground">{data.domain.name}</p>
              )}
              {entries.map(([key, value, depth], i) => (
                <div
                  className="flex justify-between gap-4 py-0.5 text-copy-13"
                  key={i}
                  style={{ paddingLeft: depth * 12 }}
                >
                  <span className="shrink-0 text-foreground-secondary">{key}</span>
                  {value && (
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="truncate text-right font-mono text-foreground" title={value}>
                        {value}
                      </span>
                      <CopyButton value={value} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Frame.Body>
      <Frame.Footer>
        <Frame.ActionButtons
          onPrimary={onConfirm}
          onSecondary={onReject}
          passkey
          primaryLabel="Sign"
          primaryLoading={confirming}
          secondaryLabel="Reject"
        />
      </Frame.Footer>
    </Frame>
  )
}

/** Recursively flattens a typed-data message into `[key, displayValue, depth]` tuples.
 * Only recurses one level deep — nested objects beyond depth 1 are JSON-stringified. */
function flattenMessage(
  obj: Record<string, unknown>,
  depth = 1,
): readonly [string, string, number][] {
  return Object.entries(obj)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, value]) => {
      const isObj = value !== null && typeof value === 'object' && !Array.isArray(value)
      if (isObj && depth === 1)
        return [
          [key, '', depth] as [string, string, number],
          ...flattenMessage(value as Record<string, unknown>, depth + 1),
        ]
      return [[key, isObj ? JSON.stringify(value) : String(value), depth]] as [
        string,
        string,
        number,
      ][]
    })
}

/** Copy button that swaps to a check icon for 1 second after copying. */
function CopyButton(props: { value: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  if (copied) return <Check className="size-2.5 shrink-0 text-foreground-secondary" />

  return (
    <button
      className="shrink-0 cursor-pointer opacity-40 transition-opacity hover:opacity-100"
      onClick={() => {
        navigator.clipboard.writeText(props.value)
        setCopied(true)
      }}
      type="button"
    >
      <Copy className="size-2.5" />
    </button>
  )
}

/** Props for {@link TypedData}. */
export declare namespace TypedData {
  type Props = {
    /** Whether the sign action is in progress. */
    confirming?: boolean | undefined
    /** Parsed EIP-712 typed data object. */
    data?: Data | undefined
    /** Host/app name requesting the signature. */
    host?: string | undefined
    /** Called when the user clicks "Sign". */
    onConfirm?: (() => void) | undefined
    /** Called when the user clicks "Reject". */
    onReject?: (() => void) | undefined
  }

  type Data = {
    domain?: { name?: string | undefined } | undefined
    message: Record<string, unknown>
    primaryType: string
    types: Record<string, readonly { name: string; type: string }[]>
  }
}
