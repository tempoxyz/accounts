import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'
import { defineConfig } from 'vp'

export default defineConfig({
  plugins: [react(), cloudflare(), mkcert()],
})
