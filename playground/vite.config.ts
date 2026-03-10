import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), cloudflare()],
  resolve: {
    alias: {
      '@tempoxyz/accounts': path.resolve(__dirname, '../src'),
    },
  },
})
