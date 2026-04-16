import {
  AccessKeyScopes,
  type AuthorizeAccessKey,
} from '#/routes/_remote/rpc/-components/AccessKeyScopes.js'
import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Identicon } from '#/ui/Identicon.js'
import ChevronRight from '~icons/lucide/chevron-right'
import Fingerprint from '~icons/lucide/fingerprint'

/** Returning user with a connected wallet — sign in with existing passkey or switch account. */
export function WelcomeBack(props: WelcomeBack.Props) {
  const {
    address,
    authorizeAccessKey,
    error,
    host,
    label,
    loading,
    onContinue,
    onCreateNew,
    onSignIn,
  } = props

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onContinue?.()
      }}
    >
      <Frame>
        <Frame.Header
          subtitle={(() => {
            if (authorizeAccessKey && host)
              return (
                <>
                  Sign in and authorize <span className="text-foreground">{host}</span> to access
                  your account.
                </>
              )
            if (host)
              return (
                <>
                  You're signing in to <span className="text-foreground">{host}</span>
                </>
              )
            return 'Sign in to continue.'
          })()}
          title="Welcome Back"
        />
        <Frame.Footer>
          <div className="flex flex-col gap-4">
            <button
              className="flex h-[42px] w-full cursor-pointer items-center gap-3 rounded-body bg-pane px-3 transition-colors hover:bg-mute-hover"
              onClick={onSignIn}
              type="button"
            >
              {address && (
                <Identicon address={address} className="size-6 shrink-0 rounded-full" size={24} />
              )}
              <p className="min-w-0 flex-1 truncate text-left text-label-13">{label}</p>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-foreground-secondary">
                <span className="text-label-12">Switch</span>
                <ChevronRight className="size-4" />
              </span>
            </button>
            {authorizeAccessKey && <AccessKeyScopes authorizeAccessKey={authorizeAccessKey} />}
            <Button
              loading={loading}
              prefix={<Fingerprint className="size-4" />}
              type="submit"
              variant="primary"
            >
              Continue with passkey
            </Button>
            {error && <p className="text-label-13 text-red-9">{error}</p>}

            <button
              className="cursor-pointer text-label-13 text-foreground-secondary transition-colors hover:text-foreground"
              onClick={onCreateNew}
              type="button"
            >
              Create a new account
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
    /** Access key authorization params — renders scope rows when provided. */
    authorizeAccessKey?: AuthorizeAccessKey | undefined
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
    /** Called when the user clicks the account pane to switch accounts. */
    onSignIn?: (() => void) | undefined
  }
}
