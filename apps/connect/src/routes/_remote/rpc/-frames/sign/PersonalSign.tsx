import { Frame } from '#/ui/Frame.js'
import AlertTriangle from '~icons/lucide/alert-triangle'

/** Personal sign request screen — shows the message and confirm/reject actions. */
export function PersonalSign(props: PersonalSign.Props) {
  const { confirming, host, message, onConfirm, onReject, raw } = props

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
        {raw && (
          <div className="flex gap-2 rounded-body border border-amber-4 bg-amber-1 px-3 py-2 text-label-12 text-amber-9">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>You are signing raw data that cannot be decoded to readable text.</span>
          </div>
        )}
        {message && (
          <div className="rounded-body bg-pane px-4 py-3">
            <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap break-all font-mono text-copy-13 text-foreground-secondary">
              {message}
            </pre>
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

/** Props for {@link PersonalSign}. */
export declare namespace PersonalSign {
  type Props = {
    /** Whether the sign action is in progress. */
    confirming?: boolean | undefined
    /** Host/app name requesting the signature. */
    host?: string | undefined
    /** The message to sign (readable text or raw hex string). */
    message?: string | undefined
    /** Called when the user clicks "Sign". */
    onConfirm?: (() => void) | undefined
    /** Called when the user clicks "Reject". */
    onReject?: (() => void) | undefined
    /** Whether the message is raw hex data that could not be decoded to UTF-8. */
    raw?: boolean | undefined
  }
}
