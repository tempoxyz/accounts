import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Identicon } from '#/ui/Identicon.js'
import Fingerprint from '~icons/lucide/fingerprint'
import LogIn from '~icons/lucide/log-in'
import UserPlus from '~icons/lucide/user-plus'

/** Returning user with a connected wallet — sign in with existing passkey or switch account. */
export function WelcomeBack(props: WelcomeBack.Props) {
  const { address, error, host, label, loading, onContinue, onCreateNew, onSignIn } = props

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onContinue?.()
      }}
    >
      <Frame>
        <Frame.Header
          icon={<LogIn className="size-5" />}
          subtitle={
            host ? (
              <>
                You're signing in to <span className="text-foreground">{host}</span>
              </>
            ) : (
              'Sign in to continue.'
            )
          }
          title="Welcome Back"
        />
        <Frame.Footer>
          <div className="flex flex-col gap-4">
            <div className="flex h-[38px] w-full items-center gap-3 rounded-lg bg-mute px-3">
              {address && (
                <Identicon address={address} className="size-6 shrink-0 rounded-full" size={24} />
              )}
              <p className="min-w-0 flex-1 truncate text-left text-label-13">{label}</p>
            </div>
            <Button
              loading={loading}
              prefix={<Fingerprint className="size-4" />}
              type="submit"
              variant="primary"
            >
              Continue with passkey
            </Button>
            {error && <p className="text-label-13 text-red-9">{error}</p>}

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <p className="text-label-12 text-foreground-secondary">or</p>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Button
              onClick={onSignIn}
              prefix={<Fingerprint className="size-4" />}
              type="button"
              variant="muted"
            >
              Sign in with another account
            </Button>
            <button
              className="cursor-pointer text-label-13 text-foreground-secondary transition-colors hover:text-foreground"
              onClick={onCreateNew}
              type="button"
            >
              <span className="inline-flex items-center gap-1.5">
                <UserPlus className="size-3.5" />
                Create a new account
              </span>
            </button>
          </div>
        </Frame.Footer>
      </Frame>
    </form>
  )
}

export declare namespace WelcomeBack {
  type Props = {
    /** Connected wallet address for identicon. */
    address?: `0x${string}` | undefined
    /** Error message to display. */
    error?: string | undefined
    /** Host domain requesting sign-in. */
    host?: string | undefined
    /** Display label for the account row (email or truncated address). */
    label?: string | undefined
    /** Whether the passkey action is in progress. */
    loading?: boolean | undefined
    /** Called when the user clicks "Continue with passkey" for the displayed account. */
    onContinue?: (() => void) | undefined
    /** Called when the user clicks "Create a new account". */
    onCreateNew?: (() => void) | undefined
    /** Called when the user clicks "Sign in with another account" — prompts all passkeys. */
    onSignIn?: (() => void) | undefined
  }
}
