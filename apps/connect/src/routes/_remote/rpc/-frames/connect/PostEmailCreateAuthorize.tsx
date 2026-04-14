// TODO: prototype frame — requires rewrite before wiring to real data/hooks

import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import Check from '~icons/lucide/check'

/** Email verified + authorize spend — create passkey and approve spending scopes. */
export function PostEmailCreateAuthorize(props: PostEmailCreateAuthorize.Props) {
  const { error, host, loading, onCancel, onContinue, scopes } = props

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
              Create a passkey for your account and allow{' '}
              <span className="text-foreground">{host}</span> to spend.
            </>
          }
          title="Email verified"
          variant="success"
        />
        <Frame.Body>
          {scopes && scopes.length > 0 && (
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {scopes.map((scope, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-3.5 py-2 text-label-13"
                >
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
          <div className="flex gap-3">
            <Button className="flex-1" onClick={onCancel} type="button" variant="muted">
              Cancel
            </Button>
            <Button className="flex-1" loading={loading} passkey type="submit" variant="primary">
              Continue
            </Button>
          </div>
          {error && <p className="text-label-13 text-red-9">{error}</p>}
        </Frame.Body>
      </Frame>
    </form>
  )
}

export declare namespace PostEmailCreateAuthorize {
  type Props = {
    /** Error message to display. */
    error?: string | undefined
    /** Host domain requesting authorization. */
    host: string
    /** Whether the create passkey action is in progress. */
    loading?: boolean | undefined
    /** Called when the user clicks "Cancel". */
    onCancel?: (() => void) | undefined
    /** Called when the user clicks "Create passkey". */
    onContinue?: (() => void) | undefined
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
