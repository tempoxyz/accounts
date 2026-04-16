import {
  AccessKeyScopes,
  type AuthorizeAccessKey,
} from '#/routes/_remote/rpc/-components/AccessKeyScopes.js'
import { Frame } from '#/ui/Frame.js'

/** Authorize access key — displays spend scopes and approve/reject actions. */
export function AuthorizeSpend(props: AuthorizeSpend.Props) {
  const { authorizeAccessKey, confirming, error, host, onApprove, onReject } = props

  return (
    <Frame>
      <Frame.Header
        subtitle={
          host ? (
            <>
              <span className="text-foreground">{host}</span> is requesting to access your account.
            </>
          ) : (
            'An app is requesting to access your account.'
          )
        }
        title="Authorize App"
      />
      <Frame.Body>
        <AccessKeyScopes authorizeAccessKey={authorizeAccessKey} />
      </Frame.Body>
      <Frame.Footer>
        {error && <p className="text-label-13 text-red-9">{error}</p>}
        <Frame.ActionButtons
          onPrimary={onApprove}
          onSecondary={onReject}
          passkey
          primaryLabel="Approve"
          primaryLoading={confirming}
          secondaryLabel="Reject"
        />
      </Frame.Footer>
    </Frame>
  )
}

export declare namespace AuthorizeSpend {
  type Props = {
    /** Access key authorization params. */
    authorizeAccessKey: AuthorizeAccessKey
    /** Whether approval is in progress. */
    confirming?: boolean | undefined
    /** Error message to display. */
    error?: string | undefined
    /** Host domain requesting access. */
    host?: string | undefined
    /** Called when the user clicks "Approve". */
    onApprove?: (() => void) | undefined
    /** Called when the user clicks "Reject". */
    onReject?: (() => void) | undefined
  }
}
