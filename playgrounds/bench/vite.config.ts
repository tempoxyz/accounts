import { defineConfig } from 'vp'

export default defineConfig({
  server: {
    port: Number(process.env.PORT ?? 5180),
    strictPort: true,
  },
})
