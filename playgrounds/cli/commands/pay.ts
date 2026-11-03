/** Pays an MPP endpoint with the CLI's access key: one charge, or several requests of a session. @module */
import { Cli, z } from 'incur'
import { Receipt } from 'mppx'
import { tempoId } from '../TempoId.ts'

/** The API playground's URL, whose MPP routes the command pays without a URL. */
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:5176'

export default Cli.command({
  args: z.object({
    url: z
      .string()
      .url()
      .optional()
      .describe(
        "The endpoint, which responds with a 402 challenge. Defaults to the API playground's /mpp/charge, or /mpp/session with --requests, at API_URL",
      ),
  }),
  description: 'Pay an MPP endpoint with your access key',
  options: z.object({
    max: z
      .string()
      .regex(/^\d+(\.\d{1,6})?$/)
      .default('0.1')
      .describe(
        'The most that a charge may cost, in the units of its token. The command refuses a larger charge before it signs',
      ),
    mode: z
      .enum(['pull', 'push'])
      .optional()
      .describe(
        'Who broadcasts a charge: the endpoint (pull, the default) or the CLI (push)',
      ),
    requests: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Pay this many requests through one session, each with a voucher, then close it',
      ),
  }),
  async run(c) {
    const session = await tempoId.session.get()
    if (!session?.key)
      return c.error({
        code: 'SIGNED_OUT',
        message: 'Not signed in. Run `login`.',
      })

    const { requests } = c.options
    const url =
      c.args.url ??
      new URL(requests ? '/mpp/session' : '/mpp/charge', apiUrl).href

    if (!requests) {
      // The access key signs, and a charge above `--max` throws before it does.
      const response = await tempoId
        .mpp({ maxAmount: c.options.max, mode: c.options.mode })
        .fetch(url)
      return {
        body: await body(response),
        receipt: response.headers.has('payment-receipt')
          ? Receipt.fromResponse(response)
          : null,
        status: response.status,
      }
    }

    // The first request opens a channel on the channel reserve, and each one pays with a voucher.
    const manager = tempoId.mpp.session({ maxDeposit: '0.05' })
    const paid = []
    try {
      for (let index = 0; index < requests; index++) {
        const response = await manager.fetch(url)
        paid.push({
          body: await body(response),
          receipt: response.receipt,
          status: response.status,
        })
      }
    } catch (error) {
      // The manager is the only handle on the channel, so a failed request closes it before the error
      // ends the command.
      await manager.close().catch((closeError: unknown) => {
        throw new AggregateError(
          [error, closeError],
          'An MPP request failed, and the close of its channel failed.',
        )
      })
      throw error
    }
    return { closed: (await manager.close()) ?? null, requests: paid }
  },
})

/** Returns the response's body as JSON, or as text when it holds no JSON. */
async function body(response: Response) {
  const text = await response.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}
