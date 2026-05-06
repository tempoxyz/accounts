import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import regen from 'regen-ui/vite'
import icons from 'unplugin-icons/vite'
import { defineConfig } from 'vp'

export default defineConfig({
  server: {
    host: process.env.VITE_HOST ?? 'localhost',
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    cors: true,
    allowedHosts: true,
  },
  plugins: [react(), icons({ compiler: 'jsx', jsx: 'react' }), regen(), cloudflare()],
})
