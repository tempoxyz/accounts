import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { tempoModerato } from 'viem/chains'
import { defineConfig } from 'vp'

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/rpc': {
        changeOrigin: true,
        rewrite: () => '',
        target: tempoModerato.rpcUrls.default.http[0],
      },
    },
  },
})
