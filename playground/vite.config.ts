import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  plugins: [react(), cloudflare(), mkcert()],
  resolve: {
    alias: {
      '@tempoxyz/accounts': path.resolve(__dirname, '../src'),
    },
  },
})
