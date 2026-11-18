/** Shows whether a step of a walkthrough runs on the server or in the client. @module */
import './StepTag.css'

/** The label of each kind of step. */
const labels = { client: 'Client', server: 'Server' } as const

/**
 * Shows a "Server" or "Client" tag after the heading of a step, on a page whose walkthrough mixes
 * server and client steps. The outline and the anchor of the heading exclude the tag.
 *
 * @example
 * ```mdx
 * import { StepTag } from '../../../components/StepTag.tsx'
 *
 * ### Serve the sign-in routes<StepTag kind="server" />
 * ```
 */
export function StepTag(props: StepTag.Props) {
  const { kind } = props

  // Vocs' outline drops each child with `data-toc-exclude` from the text of a heading.
  return (
    <span data-step-tag={kind} data-toc-exclude>
      {labels[kind]}
    </span>
  )
}

export declare namespace StepTag {
  /** Properties for the StepTag component. */
  type Props = {
    /** Where the code of the step runs. */
    kind: keyof typeof labels
  }
}
