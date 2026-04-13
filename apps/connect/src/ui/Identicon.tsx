/**
 * Deterministic address gradient identicon using design system colors.
 */

const scales = ['blue', 'red', 'amber', 'green', 'teal', 'purple', 'pink'] as const
const angles = [45, 135, 225, 315] as const

export function Identicon(props: Identicon.Props) {
  const { address, className, size = 64 } = props
  const hash = hashAddress(address)
  const aIdx = hash[0]! % scales.length
  const a = scales[aIdx]!
  const b = scales[(aIdx + 3 + (hash[1]! % 3)) % scales.length]!
  const angle = angles[hash[2]! % angles.length]!
  const id = 'g' + address.slice(2, 10)

  return (
    <svg
      className={className}
      height={size}
      viewBox="0 0 1 1"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient gradientTransform={`rotate(${angle} .5 .5)`} id={id}>
          <stop offset="0%" stopColor={`var(--${a}-7)`} />
          <stop offset="100%" stopColor={`var(--${b}-7)`} />
        </linearGradient>
      </defs>
      <rect fill={`url(#${id})`} height="1" width="1" />
    </svg>
  )
}

export declare namespace Identicon {
  type Props = {
    /** Ethereum address. */
    address: `0x${string}`
    /** Additional CSS classes. */
    className?: string | undefined
    /** Size in pixels. @default 64 */
    size?: number | undefined
  }
}

function hashAddress(address: `0x${string}`): Uint8Array {
  const hex = address.slice(2).toLowerCase()
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}
