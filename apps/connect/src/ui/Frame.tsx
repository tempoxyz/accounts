import { Button } from '#/ui/Button.js'
import { cx } from 'cva'
import type { ReactNode } from 'react'

/** Card shell for dialog screens (iframe, popup, standalone). */
export function Frame(props: Frame.Props) {
  const { children, className } = props
  return <div className={cx('flex flex-col gap-2', className)}>{children}</div>
}

export namespace Frame {
  export type Props = {
    children: ReactNode
    className?: string | undefined
  }

  /** Header with centered icon, title, and optional subtitle. */
  export function Header(props: Header.Props) {
    const { icon, subtitle, title } = props
    return (
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-2 text-blue-9">
              {icon}
            </div>
          )}
          <h2 className="text-heading-20">{title}</h2>
        </div>
        {subtitle && <p className="text-copy-15 text-foreground-secondary">{subtitle}</p>}
      </div>
    )
  }

  export namespace Header {
    export type Props = {
      /** Icon element rendered in a circular container. */
      icon?: ReactNode | undefined
      /** Secondary text below the title. */
      subtitle?: ReactNode | undefined
      /** Primary heading text. */
      title: ReactNode
    }
  }

  /** Scrollable content area between header and footer. */
  export function Body(props: Body.Props) {
    const { children, className } = props
    return <div className={cx('flex flex-col gap-4 px-4 pb-4', className)}>{children}</div>
  }

  export namespace Body {
    export type Props = {
      children: ReactNode
      className?: string | undefined
    }
  }

  /** Sticky footer area for actions. */
  export function Footer(props: Footer.Props) {
    const { children, className } = props
    return <div className={cx('px-4 pb-4', className)}>{children}</div>
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
      onPrimary,
      onSecondary,
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
          loading={primaryLoading}
          onClick={onPrimary}
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
      /** Handler for the primary (right) button. */
      onPrimary?: (() => void) | undefined
      /** Handler for the secondary (left) button. */
      onSecondary?: (() => void) | undefined
      /** Label for the primary button. */
      primaryLabel?: string | undefined
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
