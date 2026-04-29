import { validator } from 'hono/validator'
import * as z from 'zod/mini'

import * as Zod from './zod.js'

/**
 * Hono validator middleware adapter for `zod/mini`. Decodes the target value
 * via `z.decode` and short-circuits with a `400` JSON response on schema
 * failure (`{ error: 'Invalid request body', issues }`).
 *
 * Mirrors `@hono/zod-validator` but for `zod/mini` schemas (the SDK uses
 * `core/zod` styled around `z.decode` / `z.encode`).
 */
export function validate<
  const target extends 'header' | 'json' | 'param' | 'query',
  schema extends z.ZodMiniType,
>(target: target, schema: schema) {
  return validator(target, (value, c) => {
    try {
      return z.decode(schema, value) as z.output<schema>
    } catch (error) {
      if (Zod.isError(error))
        return c.json(
          { error: 'Invalid request body', issues: Zod.flattenIssues(error.issues) },
          400,
        )
      throw error
    }
  })
}
