import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
      // OAuth callbacks come back to the frontend URL (port 5173).
      // Proxy /auth/* to the verifier so the callback handler can exchange
      // the code and return the popup-close HTML.
      '/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['@cofhe/sdk'],  // WASM must not be pre-bundled
    include: ['iframe-shared-storage'],  // CJS-only package — pre-bundle to ESM
  },
  build: {
    target: 'esnext',
  },
})
