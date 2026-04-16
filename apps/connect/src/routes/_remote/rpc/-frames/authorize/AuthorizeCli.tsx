// TODO: prototype frame — requires rewrite before wiring to real data/hooks

import { Frame } from '#/ui/Frame.js'
import { Row, Rows } from '#/ui/Rows.js'

/** CLI authorization screen — confirm device code and approve spending scopes. */
export function AuthorizeCli(props: AuthorizeCli.Props) {
  const { code, confirming, host, onApprove, onReject, scopes } = props

  return (
    <Frame>
      <Frame.Header
        subtitle={
          host ? (
            <>
              <span className="text-foreground">{host}</span> is requesting to access your account.
            </>
          ) : (
            'A CLI is requesting to access your account.'
          )
        }
        title="Authorize CLI"
      />
      <Frame.Body>
        <div className="flex flex-col gap-3 rounded-body bg-pane px-4 py-5 text-center">
          <p className="text-label-12 text-foreground-secondary">
            Confirm this code matches your terminal
          </p>
          <p className="font-mono text-heading-32 tracking-[0.3em]">{code}</p>
        </div>
        {scopes && scopes.length > 0 && (
          <Rows>
            {scopes.map((scope, i) => (
              <Row key={i} label={scope.label}>
                <p className="flex items-center gap-1.5 font-medium">
                  {scope.value}
                  {scope.suffix && (
                    <span className="font-normal text-foreground-secondary"> {scope.suffix}</span>
                  )}
                </p>
              </Row>
            ))}
          </Rows>
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

export declare namespace AuthorizeCli {
  type Props = {
    /** Device code to display (e.g. "TRMK-92QF"). */
    code: string
    /** Whether approval is in progress. */
    confirming?: boolean | undefined
    /** Host/app name requesting CLI access. */
    host?: string | undefined
    /** Called when the user clicks "Approve". */
    onApprove?: (() => void) | undefined
    /** Called when the user clicks "Reject". */
    onReject?: (() => void) | undefined
    /** Spending scopes to display. */
    scopes?: readonly Scope[] | undefined
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
