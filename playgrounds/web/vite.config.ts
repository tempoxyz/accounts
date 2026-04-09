import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'
import { defineConfig } from 'vp'

const allowedOrigins = [process.env.VITE_WALLET_DIALOG_HOST, process.env.VITE_REF_DIALOG_HOST]
  .filter(Boolean)
  .map((url) => new URL(url!).origin)

export default defineConfig({
  server: {
    host: process.env.VITE_HOST ?? 'localhost',
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    cors: {
      allowedHeaders: ['Content-Type'],
      credentials: true,
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    },
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
