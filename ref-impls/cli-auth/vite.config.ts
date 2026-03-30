import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig, loadEnv } from 'vite'
import * as z from 'zod/mini'

const enabledSchema = z.stringbool()

const devFlagsSchema = z.object({
  VITE_DEVTOOLS: z.prefault(enabledSchema, 'true'),
  VITE_FORWARD_CONSOLE: z.prefault(enabledSchema, 'true'),
  CLI_AUTH_KV_ID: z.string(),
  ALLOWED_HOSTS: z.string(),
})

export default defineConfig((config) => {
  const env = loadEnv(config.mode, process.cwd(), '')

  const { data: devFlags, success, error } = devFlagsSchema.safeParse(env)
  if (!success) throw new Error(`Invalid dev flags - ${z.prettifyError(error)}`)

  const devtools = config.mode !== 'production' && devFlags.VITE_DEVTOOLS
  return {
    devtools,
    plugins: [cloudflare()],
    resolve: {
      conditions: ['src'],
      tsconfigPaths: true,
    },
    server: {
      port: Number(env.PORT ?? 69_69),
      forwardConsole: devFlags.VITE_FORWARD_CONSOLE,
      allowedHosts: devFlags.ALLOWED_HOSTS?.split(','),
    },
  }
})
