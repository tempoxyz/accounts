import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import tunnel from 'vite-plugin-cloudflare-tunnel'
import { defineConfig } from 'vp'

export default defineConfig({
  plugins: [react(), cloudflare(), tunnel()],
  server: {
    // Use a fixed, less-common port. The cloudflare tunnel plugin's
    // port-conflict fallback leaves `globalState.tunnelUrl` undefined,
    // which breaks the `auth` URL on first load.
    port: 5180,
    strictPort: true,
    cors: {
      origin: '*',
    },
  },
})
