/** Shows cards as thin rows, one card for each row. @module */
// The rules of a row are beside the rules of the card, which they change.
import './PageCard.css'

/**
 * Shows each `PageCard` or `ExampleCard` of its children as a thin row: the icon, then the title
 * above the description. It takes the place of Vocs' `Cards`, whose grid holds two columns.
 *
 * @example
 * ```mdx
 * import { CardRows } from '../components/CardRows.tsx'
 * import { PageCard } from '../components/PageCard.tsx'
 *
 * <CardRows>
 *   <PageCard
 *     description="Sign users in on the web, on mobile, in a CLI, or on a server."
 *     icon="log-in"
 *     title="Sign in with Tempo ID"
 *     to="/docs/guides/dialog"
 *   />
 * </CardRows>
 * ```
 */
export function CardRows(props: CardRows.Props) {
  const { children } = props

  return <div data-card-rows="">{children}</div>
}

export declare namespace CardRows {
  /** Properties for the CardRows component. */
  type Props = {
    /** The cards, each a `PageCard` or an `ExampleCard`. */
    children: React.ReactNode
  }
}
