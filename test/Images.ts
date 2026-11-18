/**
 * The pulls of the images that the end-to-end suite's containers run. A CI job starts the pull of
 * each image before the install, and names a directory of lock files in `E2E_PULLS`. Each service
 * waits for its image's pull before it starts its container, since Docker starts a second pull, and
 * extracts the image again, for an image whose pull still runs.
 * @module
 */
import * as Fs from 'node:fs'
import * as Path from 'node:path'

/**
 * Waits until the pull of `image` that the job started ends. The job holds a lock file for each
 * image whose pull runs, in the directory that `E2E_PULLS` names. The file's name is the image's
 * name with `_` in place of each character other than a letter, a digit, `.`, `_`, and `-`. Without
 * `E2E_PULLS`, or without the file, returns at once, and the container's start pulls the image.
 * Returns also after `timeout`, so a pull that hangs fails at the container's start.
 *
 * @example
 * ```ts
 * import * as Images from './Images.js'
 *
 * await Images.pulled({ image: 'ghcr.io/tempoxyz/tempo:latest' })
 * ```
 */
export async function pulled(options: pulled.Options) {
  const { image, timeout = 5 * 60_000 } = options
  const directory = process.env.E2E_PULLS
  if (!directory) return

  const lock = Path.join(directory, image.replace(/[^\w.-]/g, '_'))
  const deadline = Date.now() + timeout
  while (Fs.existsSync(lock) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 500))
}

export declare namespace pulled {
  type Options = {
    /** The image, as the container names it, with its tag. */
    image: string
    /** The longest wait, in milliseconds. Defaults to 5 minutes. */
    timeout?: number | undefined
  }
}
