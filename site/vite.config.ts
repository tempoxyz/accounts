import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { vocs } from 'vocs/vite'

export default defineConfig({
  server: {
    allowedHosts: true,
    host: process.env.VITE_HOST ?? 'localhost',
    port: Number(process.env.PORT ?? 5176),
    strictPort: true,
  },
  plugins: [vocs(), react()],
})
