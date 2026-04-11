import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vp'

export default defineConfig({
  server: {
    port: 5176,
    allowedHosts: true,
  },
  plugins: [
    cloudflare(),
    tanstackRouter({ routeFilePrefix: undefined, routesDirectory: 'src/routes' }),
    react(),
    tailwindcss(),
  ],
})
