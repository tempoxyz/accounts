import { Frame } from '#/ui/Frame.js'
import AlertTriangle from '~icons/lucide/alert-triangle'

/** Invalid typed data signing screen — warns the user and offers a destructive "Sign anyway" action. */
export function TypedDataInvalid(props: TypedDataInvalid.Props) {
  const { confirming, data, host, onConfirm, onReject } = props

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
        <div className="flex gap-2 rounded-body border border-amber-4 bg-amber-1 px-3 py-2 text-label-12 text-amber-9">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>The message format appears to be invalid.</span>
        </div>
        {data && (
          <div className="rounded-body bg-pane px-4 py-3">
            <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap break-all font-mono text-copy-13 text-foreground-secondary">
              {data}
            </pre>
          </div>
        )}
      </Frame.Body>
      <Frame.Footer>
        <Frame.ActionButtons
          onPrimary={onConfirm}
          onSecondary={onReject}
          passkey
          primaryLabel="Sign anyway"
          primaryLoading={confirming}
          primaryVariant="error"
          secondaryLabel="Reject"
        />
      </Frame.Footer>
    </Frame>
  )
}

/** Props for {@link TypedDataInvalid}. */
export declare namespace TypedDataInvalid {
  type Props = {
    /** Whether the sign action is in progress. */
    confirming?: boolean | undefined
    /** Raw data string to display verbatim. */
    data?: string | undefined
    /** Host/app name requesting the signature. */
    host?: string | undefined
    /** Called when the user clicks "Sign anyway". */
    onConfirm?: (() => void) | undefined
    /** Called when the user clicks "Reject". */
    onReject?: (() => void) | undefined
  }
}
