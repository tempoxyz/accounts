import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vp'

export default defineConfig({
  server: {
    allowedHosts: true,
  },
  plugins: [react(), cloudflare()],
})
