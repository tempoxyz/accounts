/**
 * Serves and builds the siwe example: the React page, and the Worker of its API at the same
 * origin. @module
 */
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [cloudflare(), react()] })
