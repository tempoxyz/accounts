/** Shows a link to the declaration of an export in the source of the package on GitHub. @module */
import { Link } from 'vocs'

/**
 * The source files of `src/`, as text, by path. Only the server render reads them, so no browser
 * bundle holds them.
 */
const sources = import.meta.glob<string>(
  ['../../../src/**/*.ts', '!../../../src/**/*.test.ts'],
  { eager: true, import: 'default', query: '?raw' },
)

/** The commit that the build reads `src/` from, which `vite.config.ts` defines. */
const commit: string = import.meta.env.SITE_COMMIT

/** Repository that holds the package, as `owner/name`. */
const repository = 'tempoxyz/accounts'

/**
 * Shows a link to the TSDoc of the declaration of `name` in the file of `path`, as a line range on
 * GitHub. The TSDoc of the declaration is the API reference of the export. The link opens in a new
 * tab.
 *
 * The declaration is the first line of the file that declares `name` as an export or as a member,
 * such as `export function name(`, `name: `, or `async name(`, and that follows the end of a TSDoc
 * comment. A dotted name, such as `session.get`, names a member of each earlier part: each part is
 * the first such declaration after the line of the part before it. The range runs from the first
 * line to the last line of the TSDoc. The page resolves the range at each build, and the link
 * names the commit of the build, so the range and the file always match.
 *
 * @throws {Error} When `src/` holds no file of `path`, or the file no documented declaration of
 * `name`. The build of the page fails, so a moved file or a renamed export leaves no dead link.
 *
 * @example
 * ```mdx
 * import { SourceLink } from '../components/SourceLink.tsx'
 *
 * <SourceLink name="signIn" path="src/plugins/dialog.ts">`dialog.signIn`</SourceLink> opens the dialog.
 * ```
 */
export function SourceLink(props: SourceLink.Props) {
  const { children, name, path } = props

  const source = sources[`../../../${path}`]
  if (source === undefined) throw new Error(`Missing source: ${path}`)

  const lines = source.split('\n')

  /** Returns the index of the line that ends the TSDoc of the declaration at `index`, or `-1`. */
  function end(index: number) {
    // A line comment may sit between the TSDoc and its declaration.
    let above = index - 1
    while (lines[above]?.trim().startsWith('//')) above--
    return lines[above]?.trim().endsWith('*/') ? above : -1
  }

  const line = name.split('.').reduce((start, part) => {
    const declaration = new RegExp(
      String.raw`^\s*(?:export\s+(?:declare\s+)?(?:async\s+)?(?:class|const|function|let|namespace|type)\s+${part}\b|(?:async\s+)?${part}\s*[:(<?])`,
    )
    const index = lines.findIndex(
      (text, index) =>
        index > start && declaration.test(text) && end(index) !== -1,
    )
    if (index === -1)
      throw new Error(`Missing documented declaration of ${name} in ${path}`)
    return index
  }, -1)

  const last = end(line)
  let first = last
  while (first > 0 && !lines[first]?.trim().startsWith('/**')) first--

  // The data attributes give the link the style of a link of Markdown, as Vocs' own `a` does.
  return (
    <Link
      data-v
      data-v-link
      to={`https://github.com/${repository}/blob/${commit}/${path}#L${first + 1}-L${last + 1}`}
    >
      {children}
    </Link>
  )
}

export declare namespace SourceLink {
  /** Properties for the SourceLink component. */
  type Props = {
    /** Text of the link, such as the name of the export in inline code. */
    children: React.ReactNode
    /**
     * Name of the declaration, an identifier such as `signIn`, or a dotted path of members such as
     * `session.get`.
     */
    name: string
    /** Path of the file from the root of the repository, under `src/`, such as `src/plugins/dialog.ts`. */
    path: string
  }
}
