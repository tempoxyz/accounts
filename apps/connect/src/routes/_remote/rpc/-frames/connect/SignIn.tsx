import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Input } from '#/ui/Input.js'
import Fingerprint from '~icons/lucide/fingerprint'
import LogIn from '~icons/lucide/log-in'

/** Sign-in / sign-up screen — enter email or use passkey. */
export function SignIn(props: SignIn.Props) {
  const { error, host, loading, onPasskey, onSubmit, passkeyLoading } = props

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const email = new FormData(e.currentTarget).get('email') as string
        if (email) onSubmit?.(email)
        else onPasskey?.()
      }}
    >
      <Frame>
        <Frame.Header
          icon={<LogIn className="size-5" />}
          subtitle={
            host ? (
              <>
                Sign into <span className="text-foreground">{host}</span> using your email address
                or passkey.
              </>
            ) : (
              'Sign in using your email address or passkey.'
            )
          }
          title="Sign in with Tempo"
        />
        <Frame.Body>
          <Input name="email" placeholder="Email address…" required type="email" />
          <Button loading={loading} type="submit" variant="primary">
            Continue
          </Button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <p className="text-label-12 text-foreground-secondary">or</p>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            loading={passkeyLoading}
            onClick={() => onPasskey?.()}
            prefix={<Fingerprint className="size-4" />}
            type="button"
            variant="muted"
          >
            Continue with passkey
          </Button>

          {error && <p className="text-label-13 text-red-9">{error}</p>}

          <p className="text-center text-label-12 text-foreground-secondary">
            By continuing, you agree to the{' '}
            <a
              className="text-foreground"
              href="https://tempo.xyz/terms"
              rel="noopener noreferrer"
              target="_blank"
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              className="text-foreground"
              href="https://tempo.xyz/privacy"
              rel="noopener noreferrer"
              target="_blank"
            >
              Privacy Policy
            </a>
            .
          </p>
        </Frame.Body>
      </Frame>
    </form>
  )
}

export declare namespace SignIn {
  type Props = {
    /** Error message to display. */
    error?: string | undefined
    /** Host domain requesting sign-in (e.g. "example.com"). */
    host?: string | undefined
    /** Whether the email submission is in progress. */
    loading?: boolean | undefined
    /** Called when the user clicks "Continue with passkey". */
    onPasskey?: (() => void) | undefined
    /** Called when the user submits an email. */
    onSubmit?: ((email: string) => void) | undefined
    /** Whether the passkey action is in progress. */
    passkeyLoading?: boolean | undefined
  }
}
