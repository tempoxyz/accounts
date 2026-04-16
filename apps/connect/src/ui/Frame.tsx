import { remote } from '#/lib/config.js'
import { Button } from '#/ui/Button.js'
import { cx } from 'cva'
import type { ReactNode } from 'react'
import X from '~icons/lucide/x'

/** Card shell for dialog screens (iframe, popup, standalone). */
export function Frame(props: Frame.Props) {
  const { children, className } = props
  return <div className={cx('flex flex-1 flex-col gap-2 pb-1', className)}>{children}</div>
}

export namespace Frame {
  export type Props = {
    children: ReactNode
    className?: string | undefined
  }

  /** Header with title, optional subtitle, and dismiss button. */
  export function Header(props: Header.Props) {
    const { subtitle, title } = props
    return (
      <div className="flex flex-col gap-3 px-5 pt-4 pb-3">
        <div className="flex items-center">
          <h2 className="flex-1 text-heading-20">{title}</h2>
          <button
            aria-label="Dismiss"
            className="flex size-8 items-center justify-center rounded-full bg-gray-2 text-foreground-secondary transition-colors hover:bg-gray-3 hover:text-foreground"
            onClick={() => remote.rejectAll()}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        {subtitle && <p className="text-copy-15 text-foreground-secondary">{subtitle}</p>}
      </div>
    )
  }

  export namespace Header {
    export type Props = {
      /** Secondary text below the title. */
      subtitle?: ReactNode | undefined
      /** Primary heading text. */
      title: ReactNode
    }
  }

  /** Scrollable content area between header and footer. */
  export function Body(props: Body.Props) {
    const { children, className } = props
    return <div className={cx('flex flex-col gap-4 px-5 pb-4', className)}>{children}</div>
  }

  export namespace Body {
    export type Props = {
      children: ReactNode
      className?: string | undefined
    }
  }

  /** Sticky footer area for actions. Anchors to the bottom when the frame fills the viewport. */
  export function Footer(props: Footer.Props) {
    const { children, className } = props
    return <div className={cx('mt-auto px-5 pb-4', className)}>{children}</div>
  }

  export namespace Footer {
    export type Props = {
      children: ReactNode
      className?: string | undefined
    }
  }

  /** Two-button row for reject/approve style actions. */
  export function ActionButtons(props: ActionButtons.Props) {
    const {
      disabled = false,
      onPrimary,
      onSecondary,
      passkey = false,
      primaryLabel = 'Approve',
      primaryLoading = false,
      primaryVariant = 'primary',
      secondaryLabel = 'Reject',
      secondaryVariant = 'muted',
    } = props
    return (
      <div className="flex gap-3">
        <Button className="flex-1" onClick={onSecondary} size="medium" variant={secondaryVariant}>
          {secondaryLabel}
        </Button>
        <Button
          className="flex-1"
          disabled={disabled}
          loading={primaryLoading}
          onClick={onPrimary}
          passkey={passkey}
          size="medium"
          variant={primaryVariant}
        >
          {primaryLabel}
        </Button>
      </div>
    )
  }

  export namespace ActionButtons {
    export type Props = {
      /** Disable the primary button. */
      disabled?: boolean | undefined
      /** Handler for the primary (right) button. */
      onPrimary?: (() => void) | undefined
      /** Handler for the secondary (left) button. */
      onSecondary?: (() => void) | undefined
      /** Label for the primary button. */
      primaryLabel?: string | undefined
      /** Show a passkey (fingerprint) icon on the primary button. */
      passkey?: boolean | undefined
      /** Show loading state on primary button. */
      primaryLoading?: boolean | undefined
      /** Variant for the primary button. */
      primaryVariant?: 'error' | 'primary' | undefined
      /** Label for the secondary button. */
      secondaryLabel?: string | undefined
      /** Variant for the secondary button. */
      secondaryVariant?: 'muted' | 'secondary' | undefined
    }
  }
}
