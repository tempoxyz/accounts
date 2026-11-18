/**
 * Shows the fields of a value as rows of a name and its value, such as the user of a session, or
 * the claims of an ID token. The demos of "Identity" show it as the detail of a step.
 * @module
 */
import './Fields.css'

/**
 * Shows each entry of `entries` as one row. The elements are `span`s, since the detail of a step
 * is one.
 *
 * @example
 * ```tsx
 * import { Fields } from './identity/Fields.tsx'
 *
 * <Fields entries={[['id', session.user.id], ['email', session.user.email]]} />
 * ```
 */
export function Fields(props: Fields.Props) {
  const { entries } = props

  return (
    <span data-identity-fields="">
      {entries.map(([name, value]) => (
        <span data-identity-field="" key={name}>
          <code data-identity-field-name="">{name}</code>
          <span data-identity-field-value="">{value}</span>
        </span>
      ))}
    </span>
  )
}

export declare namespace Fields {
  /** Properties for the Fields component. */
  type Props = {
    /** Name and value of each row, in order. */
    entries: readonly (readonly [name: string, value: string])[]
  }
}
