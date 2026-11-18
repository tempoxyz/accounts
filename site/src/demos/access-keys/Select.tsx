/** Shows a labelled select, the form control of the demos of "Access keys". @module */
import './Select.css'

/**
 * Shows a select with its label. It passes the value of the selected option to `onChange`.
 *
 * @example
 * ```tsx
 * import { Select } from './access-keys/Select.tsx'
 *
 * <Select
 *   label="Expiry"
 *   onChange={setExpiry}
 *   options={[{ label: '1 hour', value: '1h' }, { label: '1 day', value: '1d' }]}
 *   value={expiry}
 * />
 * ```
 */
export function Select<const value extends string>(props: Select.Props<value>) {
  const { disabled, label, onChange, options, value } = props

  return (
    <label data-access-key-select="">
      <span>{label}</span>
      <select
        disabled={disabled}
        onChange={(event) => {
          const selected = event.currentTarget.value
          const option = options.find((option) => option.value === selected)
          if (option) onChange(option.value)
        }}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export declare namespace Select {
  /** Properties for the Select component. */
  type Props<value extends string> = {
    /** Whether the select takes no change, such as while an action runs. Defaults to `false`. */
    disabled?: boolean | undefined
    /** Label of the select. */
    label: string
    /** Receives the value of the option that the user selects. */
    onChange: (value: value) => void
    /** Options of the select, in order. */
    options: readonly {
      /** Text of the option. */
      label: string
      /** Value of the option. */
      value: value
    }[]
    /** Value of the selected option. */
    value: value
  }
}
