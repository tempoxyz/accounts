import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Input } from '#/ui/Input.js'
import Fingerprint from '~icons/lucide/fingerprint'
import LogIn from '~icons/lucide/log-in'

/** Sign-in / sign-up screen — create account with email or sign in with passkey. */
export function SignIn(props: SignIn.Props) {
  const { error, host, onPasskey, onSubmit, passkeyLoading, registerLoading } = props

  return (
    <form
      className="flex flex-1 flex-col"
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
                Create an account or sign in with a passkey to{' '}
                <span className="text-foreground">{host}</span>.
              </>
            ) : (
              'Create an account or sign in with a passkey.'
            )
          }
          title="Sign in with Tempo"
        />
        <Frame.Footer>
          <div className="flex flex-col gap-4">
            <Input name="email" placeholder="Email address…" type="email" />
            {error && <p className="text-label-13 text-red-9">{error}</p>}
            <Button loading={registerLoading} type="submit" variant="primary">
              Create account
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
              Sign in with passkey
            </Button>

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
          </div>
        </Frame.Footer>
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
    /** Called when the user clicks "Sign in with passkey". */
    onPasskey?: (() => void) | undefined
    /** Called when the user submits an email to register. */
    onSubmit?: ((email: string) => void) | undefined
    /** Whether the passkey action is in progress. */
    passkeyLoading?: boolean | undefined
    /** Whether the registration submission is in progress. */
    registerLoading?: boolean | undefined
  }
}
