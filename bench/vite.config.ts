import * as path from 'node:path'
import { defineConfig } from 'vp'

const port = Number(process.env.PORT ?? 5180)

/** SDK source to build against instead of this checkout's, such as main's for the baseline app. */
const src = process.env.ACCOUNTS_SRC

export default defineConfig({
  preview: { port, strictPort: true },
  ...(src
    ? { resolve: { alias: [{ find: /^accounts$/, replacement: path.resolve(src, 'index.ts') }] } }
    : {}),
  server: { port, strictPort: true },
})
