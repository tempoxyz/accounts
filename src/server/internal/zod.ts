/**
 * A single Zod issue. Modeled loosely so we can accept issues from both
 * `zod` (classic, `ZodError`) and `zod/mini` (`$ZodError`).
 */
export type Issue = {
  path: readonly PropertyKey[]
  code: string
  message: string
  expected?: string | undefined
  values?: readonly unknown[] | undefined
  errors?: readonly (readonly Issue[])[] | undefined
}

/**
 * Returns true if the given value is a Zod-thrown error. Covers both
 * `zod` (classic) and `zod/mini`, which use different `name` values.
 */
export function isError(value: unknown): value is { name: string; issues: readonly Issue[] } {
  const name = (value as { name?: string } | null)?.name
  return name === 'ZodError' || name === '$ZodError'
}

/**
 * Flattens a Zod issue tree into a list of `{ path, message }` entries with
 * human-readable messages. Union mismatches are folded by collecting the
 * accepted literal values across all branches.
 */
export function flattenIssues(issues: readonly Issue[]): { path: string; message: string }[] {
  const result: { path: string; message: string }[] = []
  for (const issue of issues) {
    if (issue.code === 'invalid_union' && issue.errors?.length) {
      // Collect literal values across all union branches: e.g. ['buy', 'sell'].
      const values: unknown[] = []
      let onlyLiterals = true
      for (const branch of issue.errors)
        for (const sub of branch) {
          if (sub.code === 'invalid_value' && sub.values) values.push(...sub.values)
          else onlyLiterals = false
        }
      if (onlyLiterals && values.length > 0) {
        result.push({
          path: issue.path.map(String).join('.'),
          message: `expected one of: ${values.map((v) => JSON.stringify(v)).join(', ')}`,
        })
        continue
      }
      // Fall back to the shortest branch.
      const best = issue.errors.reduce((a, b) => (a.length <= b.length ? a : b))
      for (const nested of flattenIssues(best))
        result.push({
          path: [...issue.path.map(String), nested.path].filter(Boolean).join('.'),
          message: nested.message,
        })
      continue
    }

    let message = issue.message
    if (issue.code === 'invalid_type' && issue.expected) message = `expected ${issue.expected}`
    else if (issue.code === 'invalid_value' && issue.values?.length)
      message = `expected one of: ${issue.values.map((v) => JSON.stringify(v)).join(', ')}`

    result.push({ path: issue.path.map(String).join('.'), message })
  }
  return result
}
