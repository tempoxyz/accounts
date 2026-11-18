/** Shows a card that links an example of `examples/` in the repository. @module */
// The card of an example draws as the card of a page does.
import './PageCard.css'

/** The names of the examples of `examples/`, by the path of each one's `package.json`. */
const examples = import.meta.glob<string>('../../../examples/*/package.json', {
  eager: true,
  import: 'name',
})

/** The icons of `icons/`, as SVG text, by path. */
const icons = import.meta.glob<string>('../../icons/*.svg', {
  eager: true,
  import: 'default',
  query: '?raw',
})

/** Repository that holds the examples, as `owner/name`. */
const repository = 'tempoxyz/accounts'

/**
 * Shows a card that links the example of `examples/<name>` in the repository, inside Vocs' `Cards`.
 * The link opens in a new tab.
 *
 * @throws {Error} When `examples/` holds no example of `name`, or `icons/` no icon of `icon`.
 *
 * @example
 * ```mdx
 * import { Cards } from 'vocs'
 * import { ExampleCard } from '../../../components/ExampleCard.tsx'
 *
 * <Cards>
 *   <ExampleCard
 *     description="Sign-in through a dialog on the page."
 *     icon="browser-window"
 *     name="web"
 *     title="Web"
 *   />
 * </Cards>
 * ```
 */
export function ExampleCard(props: ExampleCard.Props) {
  const { description, icon, name, title } = props

  if (!(`../../../examples/${name}/package.json` in examples))
    throw new Error(`Missing example: ${name}`)
  const svg = icons[`../../icons/${icon}.svg`]
  if (!svg) throw new Error(`Missing icon: ${icon}`)

  return (
    <a
      data-page-card=""
      href={`https://github.com/${repository}/tree/main/examples/${name}`}
      rel="noreferrer"
      target="_blank"
    >
      <span
        data-page-card-icon=""
        // The SVG text comes from a file of `icons/`.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <span data-page-card-title="">{title}</span>
      <span data-page-card-description="">{description}</span>
    </a>
  )
}

export declare namespace ExampleCard {
  /** Properties for the ExampleCard component. */
  type Props = {
    /** One sentence on what the example runs. */
    description: string
    /** Name of an SVG file of `icons/`, without its extension. */
    icon: string
    /** Name of the example, the name of its folder in `examples/`. */
    name: string
    /** Title of the card, such as `CLI` for the example `cli`. */
    title: string
  }
}
