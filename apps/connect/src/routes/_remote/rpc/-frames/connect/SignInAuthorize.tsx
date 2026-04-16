import {
  AccessKeyScopes,
  type AuthorizeAccessKey,
} from '#/routes/_remote/rpc/-components/AccessKeyScopes.js'
import { Frame } from '#/ui/Frame.js'
import Shield from '~icons/lucide/shield-check'

/** Authorize screen shown after sign-in or account creation. */
export function SignInAuthorize(props: SignInAuthorize.Props) {
  const { authorizeAccessKey, confirming, error, host, onApprove, onReject } = props

  return (
    <Frame>
      <Frame.Header
        icon={<Shield className="size-5" />}
        subtitle={
          host ? (
            <>
              <span className="text-foreground">{host}</span> will be authorized to spend from your
              account.
            </>
          ) : (
            'This app will be authorized to spend from your account.'
          )
        }
        title="Authorize Spend"
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

export declare namespace SignInAuthorize {
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
