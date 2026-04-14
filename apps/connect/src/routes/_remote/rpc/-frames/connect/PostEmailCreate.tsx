import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import Check from '~icons/lucide/check'
import Fingerprint from '~icons/lucide/fingerprint'

/** Email verified, no existing passkey — prompt user to create one. */
export function PostEmailCreate(props: PostEmailCreate.Props) {
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
          icon={<Check className="size-5" />}
          subtitle={
            <>
              Your email <span className="text-foreground">{email}</span> has been verified. Create
              a passkey for your account.
            </>
          }
          title="Email verified"
          variant="success"
        />
        <Frame.Body>
          <Button
            loading={loading}
            prefix={<Fingerprint className="size-4" />}
            type="submit"
            variant="primary"
          >
            Create passkey
          </Button>
          {error && <p className="text-label-13 text-red-9">{error}</p>}
        </Frame.Body>
      </Frame>
    </form>
  )
}

export declare namespace PostEmailCreate {
  type Props = {
    /** Verified email address. */
    email: string
    /** Error message to display. */
    error?: string | undefined
    /** Whether the create passkey action is in progress. */
    loading?: boolean | undefined
    /** Called when the user clicks "Create passkey". */
    onContinue?: (() => void) | undefined
  }
}
