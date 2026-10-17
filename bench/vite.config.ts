import { defineConfig } from 'vp'

const port = Number(process.env.PORT ?? 5180)

export default defineConfig({
  preview: { port, strictPort: true },
  server: { port, strictPort: true },
})
