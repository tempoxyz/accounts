/** Minimal structural type for zod issues, including union branch errors. */
export type ZodIssue = {
  path: readonly PropertyKey[]
  code: string
  message: string
  expected?: string | undefined
  errors?: readonly (readonly ZodIssue[])[] | undefined
}

/**
 * Flattens nested zod issues into `{ path, message }` pairs. Union branches
 * that each failed on type alone merge into a single `Expected a | b | c`
 * message; otherwise the branch with the fewest issues is reported.
 */
export function flattenIssues(
  issues: readonly ZodIssue[],
): { path: readonly PropertyKey[]; message: string }[] {
  const result: { path: readonly PropertyKey[]; message: string }[] = []
  for (const issue of issues) {
    if (issue.errors?.length) {
      const merged = mergeUnionTypes(issue.errors)
      if (merged) {
        result.push({ path: issue.path, message: merged })
        continue
      }
      const best = issue.errors.reduce((a, b) => (a.length <= b.length ? a : b))
      for (const nested of flattenIssues(best))
        result.push({ path: [...issue.path, ...nested.path], message: nested.message })
    } else {
      let message = issue.message
      if (issue.code === 'invalid_type' && issue.expected) message = `Expected ${issue.expected}`
      else if (issue.code === 'invalid_value') message = 'Invalid value'
      result.push({ path: issue.path, message })
    }
  }
  return result
}

function mergeUnionTypes(branches: readonly (readonly ZodIssue[])[]): string | undefined {
  const expected: string[] = []
  for (const branch of branches) {
    const issue = branch[0]
    if (
      branch.length !== 1 ||
      !issue ||
      issue.code !== 'invalid_type' ||
      !issue.expected ||
      issue.path.length > 0
    )
      return undefined
    if (!expected.includes(issue.expected)) expected.push(issue.expected)
  }
  if (expected.length < 2) return undefined
  return `Expected ${expected.join(' | ')}`
}
