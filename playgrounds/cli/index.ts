#!/usr/bin/env node
/**
 * A CLI that signs in through Tempo ID's device grant, and sends and pays MPP endpoints with an access key.
 *
 * ```sh
 * node index.ts login
 * node index.ts login --limit 100:OUSD --limit 50:EURC.e --scope transfer:OUSD --expiry 7d
 * node index.ts whoami
 * node index.ts fund
 * node index.ts send 0x000000000000000000000000000000000000dEaD 0.01
 * node index.ts pay
 * node index.ts pay --requests 3
 * node index.ts logout
 * ```
 * @module
 */
import { Cli } from 'incur'

await Cli.create('tempo', {
  description: "Signs in to Tempo through Tempo ID's device grant.",
})
  .fs(new URL('./commands/', import.meta.url))
  .serve()
