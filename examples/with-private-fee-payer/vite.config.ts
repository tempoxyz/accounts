// import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vp'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['o.bun-alewife.ts.net'],
  },

  build: {
    rolldownOptions: {
      output: { format: 'esm', entryFileNames: 'main.js' },
    },
  },
})
