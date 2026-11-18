/**
 * The emailed sign-in code that an email sign-in sends.
 * @module
 */
import { RequestError } from '../Accounts.js'

/**
 * Returns the 6 digits of `value`, an emailed code, without its other characters. A pasted code can
 * hold spaces, a line break, or the email's full stop, which the sign-in page's own code field drops
 * too.
 *
 * @throws {RequestError} `invalid_request` with the reason `invalid_field`, the field `code`, and
 *   status 0, when `value` holds other than 6 digits. The sign-in sends no request, so a typo
 *   prompts for no passkey and spends no attempt.
 *
 * @example
 * ```ts
 * Code.from(' 468 883\n') // '468883'
 * ```
 */
export function from(value: unknown): string {
  const code = String(value).replace(/\D/g, '')
  if (code.length === 6) return code
  throw new RequestError({
    code: 'invalid_request',
    field: 'code',
    message: `Invalid \`code\`: it holds ${code.length} digits. Pass the 6 digits of the emailed code.`,
    reason: 'invalid_field',
    status: 0,
  })
}
