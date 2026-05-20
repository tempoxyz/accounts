import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import tunnel from 'vite-plugin-cloudflare-tunnel'
import { defineConfig } from 'vp'

export default defineConfig({
  plugins: [react(), cloudflare(), tunnel()],
  server: {
    cors: {
      origin: '*',
    },
  },
})
