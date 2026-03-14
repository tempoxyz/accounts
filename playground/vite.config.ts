import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  server: {
    host: process.env.VITE_HOST ?? 'localhost',
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
  },
  plugins: [
    react(),
    cloudflare(),
    mkcert({
      force: true,
      hosts: [process.env.VITE_HOST ?? 'localhost'],
    }),
  ],
})
