import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vp'

export default defineConfig({
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
  plugins: [react(), cloudflare()],
})
