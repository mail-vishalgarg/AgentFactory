import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mcpBackendPlugin from './vite-plugin-mcp.js'

export default defineConfig({
  plugins: [
    mcpBackendPlugin(),
    react()
  ],
  server: {
    port: 3000,
    host: true
  }
})
