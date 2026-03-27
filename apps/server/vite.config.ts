import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig, loadEnv } from 'vite'
import * as z from 'zod/mini'

const enabledSchema = z.stringbool()

const devFlagsSchema = z.object({
  VITE_DEVTOOLS: z.prefault(enabledSchema, 'false'),
  VITE_FORWARD_CONSOLE: z.prefault(enabledSchema, 'false'),
})

export default defineConfig((config) => {
  const env = loadEnv(config.mode, process.cwd(), '')

  const { data: devFlags, success, error } = devFlagsSchema.safeParse(env)
  if (!success) throw new Error(`Invalid dev flags - ${z.prettifyError(error)}`)

  const devtools = config.mode !== 'production' && devFlags.VITE_DEVTOOLS
  return {
    devtools,
    plugins: [cloudflare()],
    resolve: { tsconfigPaths: true },
    server: {
      port: Number(env.PORT ?? 69_69),
      forwardConsole: devFlags.VITE_FORWARD_CONSOLE,
    },
  }
})
