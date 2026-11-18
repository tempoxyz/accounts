/** Shows a card that links a page of the site, and stays disabled until the page exists. @module */
import { Link } from 'vocs'
import './PageCard.css'

/** The icons of `icons/`, as SVG text, by path. */
const icons = import.meta.glob<string>('../../icons/*.svg', {
  eager: true,
  import: 'default',
  query: '?raw',
})

/** The pages of `src/pages/`, by path. The card reads only the paths, and loads no page. */
const pages = import.meta.glob('../pages/**/*.mdx')

/**
 * Shows a card that links the page of `to`, inside Vocs' `Cards`. The card is disabled until
 * `src/pages` holds the page, as its item of the sidebar is. A page thus names the pages that
 * follow it before they exist, and each card links its page once the page exists.
 *
 * @example
 * ```mdx
 * import { Cards } from 'vocs'
 * import { PageCard } from '../../../components/PageCard.tsx'
 *
 * <Cards>
 *   <PageCard
 *     description="Sign a user in, and send a payment."
 *     icon="lightning"
 *     title="Getting started"
 *     to="/"
 *   />
 * </Cards>
 * ```
 */
export function PageCard(props: PageCard.Props) {
  const { description, icon, title, to } = props

  const svg = icons[`../../icons/${icon}.svg`]
  if (!svg) throw new Error(`Missing icon: ${icon}`)

  const content = (
    <>
      <span
        data-page-card-icon=""
        // The SVG text comes from a file of `icons/`.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <span data-page-card-title="">{title}</span>
      <span data-page-card-description="">{description}</span>
    </>
  )

  // The page of `/` is `src/pages/index.mdx`.
  if (`../pages${to === '/' ? '/index' : to}.mdx` in pages)
    return (
      <Link data-page-card="" to={to}>
        {content}
      </Link>
    )
  return (
    <div aria-disabled="true" data-page-card="">
      {content}
    </div>
  )
}

export declare namespace PageCard {
  /** Properties for the PageCard component. */
  type Props = {
    /** One sentence on what the page holds. */
    description: string
    /** Name of an SVG file of `icons/`, without its extension. */
    icon: string
    /** Title of the page. */
    title: string
    /** Path of the page, which is also the path of its MDX file under `src/pages`. */
    to: string
  }
}
