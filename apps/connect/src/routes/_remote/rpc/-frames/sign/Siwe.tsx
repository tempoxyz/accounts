import { Frame } from '#/ui/Frame.js'

/**
 * SIWE (Sign-In with Ethereum) authentication screen.
 * Shows a simplified prompt with the requesting host — the message body is intentionally hidden.
 */
export function Siwe(props: Siwe.Props) {
  const { confirming, host, onApprove, onReject } = props

  return (
    <Frame>
      <Frame.Header
        subtitle={
          <>
            Authenticate {host ? <span className="text-foreground">{host}</span> : 'this website'}{' '}
            with your passkey to continue.
          </>
        }
        title="Authenticate"
      />
      <Frame.Footer>
        <Frame.ActionButtons
          onPrimary={onApprove}
          onSecondary={onReject}
          passkey
          primaryLabel="Approve"
          primaryLoading={confirming}
          secondaryLabel="No thanks"
        />
      </Frame.Footer>
    </Frame>
  )
}

/** Props for {@link Siwe}. */
export declare namespace Siwe {
  type Props = {
    /** Whether approval is in progress. */
    confirming?: boolean | undefined
    /** Host/app name requesting authentication. */
    host?: string | undefined
    /** Called when the user clicks "Approve". */
    onApprove?: (() => void) | undefined
    /** Called when the user clicks "No thanks". */
    onReject?: (() => void) | undefined
  }
}
