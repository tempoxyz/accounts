import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vp'

export default defineConfig({
  resolve: {
    alias: {
      // TODO: Remove after Wagmi releases support for Viem 2.56.
      // Wagmi <=3.7 imports this removed entrypoint for Zone APIs that are not used here.
      'viem/tempo/zones': 'viem/tempo',
    },
  },
  server: {
    allowedHosts: true,
  },
  plugins: [react(), cloudflare()],
})
