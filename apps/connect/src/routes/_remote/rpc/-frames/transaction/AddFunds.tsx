// TODO: prototype frame — requires rewrite before wiring to real data/hooks

import { Button } from '#/ui/Button.js'
import { Frame } from '#/ui/Frame.js'
import { Cuer } from 'cuer'
import ChevronDown from '~icons/lucide/chevron-down'
import CirclePlus from '~icons/lucide/circle-plus'
import Copy from '~icons/lucide/copy'

// TODO: finalize props once onramp flow is wired

/** Add Funds screen — deposit address + QR code for topping up balance. */
export function AddFunds(props: AddFunds.Props) {
  const { address, amount, network, onApplePay, subtitle, title = 'Add Funds', token } = props

  return (
    <Frame>
      <Frame.Header
        icon={<CirclePlus className="size-5" />}
        subtitle={
          subtitle ??
          (amount ? (
            <>
              Deposit <span className="text-foreground">{amount}</span> to continue.
            </>
          ) : (
            'Deposit funds to continue.'
          ))
        }
        title={title}
      />
      <Frame.Body>
        <div className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3.5">
          <div className="flex items-center justify-between">
            <p className="text-label-13 text-foreground-secondary">Deposit address</p>
            {network && (
              <div className="flex items-center gap-1.5 rounded-full bg-blue-2 px-2 py-0.5 text-label-12 font-medium text-blue-9">
                <span className="size-1.5 rounded-full bg-blue-7" />
                {network}
              </div>
            )}
          </div>
          {address && (
            <>
              <div className="flex justify-center py-2">
                <Cuer value={address} size="140px" />
              </div>
              <div className="flex items-center justify-center gap-1.5">
                <p className="font-mono text-label-13 text-foreground-secondary">
                  {address.slice(0, 6)}…{address.slice(-10)}
                </p>
                <button
                  className="cursor-pointer text-foreground-secondary opacity-60 transition-opacity hover:opacity-100"
                  onClick={() => navigator.clipboard.writeText(address)}
                  type="button"
                >
                  <Copy className="size-3" />
                </button>
              </div>
            </>
          )}
        </div>

        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {network && (
            <div className="flex items-center justify-between px-3.5 py-2 text-label-13">
              <p className="text-foreground-secondary">Network</p>
              <p className="flex items-center gap-1.5">
                {network}
                <ChevronDown className="size-3.5 text-foreground-secondary" />
              </p>
            </div>
          )}
          {token && (
            <div className="flex items-center justify-between px-3.5 py-2 text-label-13">
              <p className="text-foreground-secondary">Token</p>
              <p className="flex items-center gap-1.5">
                {token}
                <ChevronDown className="size-3.5 text-foreground-secondary" />
              </p>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-amber-4 bg-amber-1 px-3 py-2 text-label-12 text-amber-9">
          ⚠ Only send {token ?? 'the correct token'} on {network ?? 'the correct network'}. Sending
          other tokens or using a different network may result in permanent loss.
        </div>

        {onApplePay && (
          <>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <p className="text-label-12 text-foreground-secondary">or</p>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Button onClick={onApplePay} variant="invert">
              <ApplePayMark />
            </Button>
          </>
        )}
      </Frame.Body>
    </Frame>
  )
}

function ApplePayMark() {
  return (
    <svg className="h-[18px]" viewBox="0 0 512 210.2" fill="currentColor" aria-label="Apple Pay">
      <path d="M93.6,27.1C87.6,34.2,78,39.8,68.4,39c-1.2-9.6,3.5-19.8,9-26.1c6-7.3,16.5-12.5,25-12.9C103.4,10,99.5,19.8,93.6,27.1 M102.3,40.9c-13.9-0.8-25.8,7.9-32.4,7.9c-6.7,0-16.8-7.5-27.8-7.3c-14.3,0.2-27.6,8.3-34.9,21.2c-15,25.8-3.9,64,10.6,85c7.1,10.4,15.6,21.8,26.8,21.4c10.6-0.4,14.8-6.9,27.6-6.9c12.9,0,16.6,6.9,27.8,6.7c11.6-0.2,18.9-10.4,26-20.8c8.1-11.8,11.4-23.3,11.6-23.9c-0.2-0.2-22.4-8.7-22.6-34.3c-0.2-21.4,17.5-31.6,18.3-32.2C123.3,42.9,107.7,41.3,102.3,40.9 M182.6,11.9v155.9h24.2v-53.3h33.5c30.6,0,52.1-21,52.1-51.4c0-30.4-21.1-51.2-51.3-51.2H182.6z M206.8,32.3h27.9c21,0,33,11.2,33,30.9c0,19.7-12,31-33.1,31h-27.8V32.3z M336.6,169c15.2,0,29.3-7.7,35.7-19.9h0.5v18.7h22.4V90.2c0-22.5-18-37-45.7-37c-25.7,0-44.7,14.7-45.4,34.9h21.8c1.8-9.6,10.7-15.9,22.9-15.9c14.8,0,23.1,6.9,23.1,19.6v8.6l-30.2,1.8c-28.1,1.7-43.3,13.2-43.3,33.2C298.4,155.6,314.1,169,336.6,169z M343.1,150.5c-12.9,0-21.1-6.2-21.1-15.7c0-9.8,7.9-15.5,23-16.4l26.9-1.7v8.8C371.9,140.1,359.5,150.5,343.1,150.5z M425.1,210.2c23.6,0,34.7-9,44.4-36.3L512,54.7h-24.6l-28.5,92.1h-0.5l-28.5-92.1h-25.3l41,113.5l-2.2,6.9c-3.7,11.7-9.7,16.2-20.4,16.2c-1.9,0-5.6-0.2-7.1-0.4v18.7C417.3,210,423.3,210.2,425.1,210.2z" />
    </svg>
  )
}

export declare namespace AddFunds {
  type Props = {
    /** Deposit address. */
    address?: string | undefined
    /** Required deposit amount (e.g. "$50.00"). */
    amount?: string | undefined
    /** Network name (e.g. "Tempo"). */
    network?: string | undefined
    /** Called when Apple Pay button is clicked. */
    onApplePay?: (() => void) | undefined
    /** Override the default subtitle. */
    subtitle?: React.ReactNode | undefined
    /** Override the default title. */
    title?: string | undefined
    /** Token symbol (e.g. "USDC.e"). */
    token?: string | undefined
  }
}
