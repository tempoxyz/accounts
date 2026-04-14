import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import Fingerprint from '~icons/lucide/fingerprint'

/** Email verified, existing passkey found — prompt user to log in. */
export function PostEmailExisting(props: PostEmailExisting.Props) {
  const { email, error, loading, onContinue } = props

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onContinue?.()
      }}
    >
      <Frame>
        <Frame.Header
          icon={<Fingerprint className="size-5" />}
          subtitle={
            <>
              Log in with your passkey at <span className="text-foreground">{email}</span> to
              continue.
            </>
          }
          title="Log in with Tempo"
        />
        <Frame.Body>
          <Button
            loading={loading}
            prefix={<Fingerprint className="size-4" />}
            type="submit"
            variant="primary"
          >
            Continue with passkey
          </Button>
          {error && <p className="text-label-13 text-red-9">{error}</p>}
        </Frame.Body>
      </Frame>
    </form>
  )
}

export declare namespace PostEmailExisting {
  type Props = {
    /** Email address associated with the existing passkey. */
    email: string
    /** Error message to display. */
    error?: string | undefined
    /** Whether the login action is in progress. */
    loading?: boolean | undefined
    /** Called when the user clicks "Continue with passkey". */
    onContinue?: (() => void) | undefined
  }
}
