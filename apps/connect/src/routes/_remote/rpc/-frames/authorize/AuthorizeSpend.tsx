// TODO: prototype frame — requires rewrite before wiring to real data/hooks

import { Frame } from '#/ui/Frame.js'
import { Identicon } from '#/ui/Identicon.js'
import ChevronRight from '~icons/lucide/chevron-right'
import Shield from '~icons/lucide/shield-check'

/** Returning user authorize — account selector + spend scopes + approve/reject. */
export function AuthorizeSpend(props: AuthorizeSpend.Props) {
  const {
    address,
    confirming,
    host,
    label,
    onApprove,
    onReject,
    onSwitchAccount,
    scopes,
    subtitle,
  } = props

  return (
    <Frame>
      <Frame.Header
        icon={<Shield className="size-5" />}
        subtitle={
          subtitle ??
          (host ? (
            <>
              <span className="text-foreground">{host}</span> is requesting to access your account.
            </>
          ) : (
            'An app is requesting to access your account.'
          ))
        }
        title="Authorize App"
      />
      <Frame.Body>
        <button
          className="flex h-[38px] w-full cursor-pointer items-center gap-3 rounded-lg bg-mute px-3 transition-colors hover:bg-mute-hover"
          onClick={onSwitchAccount}
          type="button"
        >
          {address && (
            <Identicon address={address} className="size-6 shrink-0 rounded-full" size={24} />
          )}
          <p className="min-w-0 flex-1 truncate text-left text-label-13">{label}</p>
          <ChevronRight className="size-4 shrink-0 text-foreground-secondary" />
        </button>
        {scopes && scopes.length > 0 && (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {scopes.map((scope, i) => (
              <div key={i} className="flex items-center justify-between px-3.5 py-2 text-label-13">
                <p className="text-foreground-secondary">{scope.label}</p>
                <p className="flex items-center gap-1.5 font-medium">
                  {scope.value}
                  {scope.suffix && (
                    <span className="font-normal text-foreground-secondary"> {scope.suffix}</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        )}
      </Frame.Body>
      <Frame.Footer>
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
    /** Connected wallet address for identicon. */
    address?: `0x${string}` | undefined
    /** Whether approval is in progress. */
    confirming?: boolean | undefined
    /** Host domain requesting the spend authorization. */
    host?: string | undefined
    /** Display label for the account row (email or truncated address). */
    label?: string | undefined
    /** Called when the user clicks "Approve". */
    onApprove?: (() => void) | undefined
    /** Called when the user clicks "Reject". */
    onReject?: (() => void) | undefined
    /** Called when the user clicks the account row to switch. */
    onSwitchAccount?: (() => void) | undefined
    /** Spending scopes to display. */
    scopes?: readonly Scope[] | undefined
    /** Override the default subtitle copy. */
    subtitle?: React.ReactNode | undefined
  }

  type Scope = {
    /** Row label (e.g. "Spend USDC.e"). */
    label: string
    /** Optional suffix (e.g. "/ hour"). */
    suffix?: string | undefined
    /** Row value (e.g. "$100.00"). */
    value: string
  }
}
