// TODO: prototype frame — requires rewrite before wiring to real data/hooks

import { Frame } from '#/ui/Frame.js'
import { Input } from '#/ui/Input.js'
import ArrowDownRight from '~icons/lucide/arrow-down-right'

const destinations = [
  { bg: 'bg-purple-2', fg: 'text-purple-9', label: 'Phantom', letter: 'P' },
  { bg: 'bg-amber-2', fg: 'text-amber-9', label: 'MetaMask', letter: 'M' },
  { bg: 'bg-blue-2', fg: 'text-blue-9', label: 'Revolut', letter: 'R' },
  { bg: 'bg-green-2', fg: 'text-green-9', label: 'Dolar', letter: 'D' },
] as const

/** Withdraw screen — choose destination wallet or enter address. */
export function Withdraw(props: Withdraw.Props) {
  const { error, onDestination, subtitle } = props

  return (
    <Frame>
      <Frame.Header
        icon={<ArrowDownRight className="size-5" />}
        subtitle={subtitle ?? 'Withdraw funds from your Tempo account.'}
        title="Withdraw"
      />
      <Frame.Body>
        <Input inputMode="decimal" placeholder="$0.00" prefix="$" type="text" />

        <div className="flex flex-col gap-2">
          {destinations.map((dest) => (
            <button
              key={dest.label}
              className="flex h-[38px] cursor-pointer items-center gap-2.5 rounded-lg bg-gray-2 px-3 text-label-13 transition-colors hover:bg-gray-3"
              onClick={() => onDestination?.(dest.label)}
              type="button"
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${dest.bg} ${dest.fg}`}
              >
                {dest.letter}
              </span>
              {dest.label}
            </button>
          ))}
        </div>

        {error && <p className="text-label-13 text-red-9">{error}</p>}
      </Frame.Body>
    </Frame>
  )
}

export declare namespace Withdraw {
  type Props = {
    /** Error message to display. */
    error?: string | undefined
    /** Called when a destination is selected. */
    onDestination?: ((name: string) => void) | undefined
    /** Override the default subtitle. */
    subtitle?: React.ReactNode | undefined
  }
}
