import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'
import { defineConfig } from 'vp'

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
      hosts: [
        process.env.VITE_HOST ?? 'localhost',
        `testnet.${process.env.VITE_HOST ?? 'localhost'}`,
        'untrusted.localhost',
      ],
    }),
  ],
})
