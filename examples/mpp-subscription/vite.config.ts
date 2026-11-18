/**
 * Serves and builds the mpp-subscription example: the React page, and the merchant's Worker at the
 * same origin.
 * @module
 */
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [cloudflare(), react()] })
