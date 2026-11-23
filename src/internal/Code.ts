/**
 * The emailed sign-in code that an email sign-in sends.
 * @module
 */
import { RequestError } from '../Accounts.js'

/**
 * Returns the 6 digits of `value`, an emailed code, without its other characters. A pasted code can
 * hold spaces, a line break, or the email's full stop, which the sign-in page's own code field drops
 * too. A full-width or Arabic-Indic digit counts as its ASCII digit, since Tempo ID compares ASCII
 * digits.
 *
 * @throws {RequestError} `invalid_request` with the reason `invalid_field`, the field `code`, and
 *   status 0, when `value` holds other than 6 digits. The sign-in sends no request, so a typo
 *   prompts for no passkey and spends no attempt.
 *
 * @example
 * ```ts
 * Code.from(' 468 883\n') // '468883'
 * Code.from('４６８８８３') // '468883'
 * ```
 */
export function from(value: unknown): string {
  const code = String(value)
    // Full-width digits, as a Chinese or Japanese input method types them, and Arabic-Indic and
    // Extended Arabic-Indic digits, as an Arabic, Persian, or Urdu keyboard types them. Each run
    // starts at a multiple of 16, so a digit's value is its code point modulo 16.
    .replace(/[\uff10-\uff19\u0660-\u0669\u06f0-\u06f9]/g, (digit) =>
      String(digit.charCodeAt(0) % 16),
    )
    .replace(/\D/g, '')
  if (code.length === 6) return code
  throw new RequestError({
    code: 'invalid_request',
    field: 'code',
    message: `Invalid \`code\`: it holds ${code.length} digits. Pass the 6 digits of the emailed code.`,
    reason: 'invalid_field',
    status: 0,
  })
}
