/** Serves and builds the web example with React. @module */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [react()] })
