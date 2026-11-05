import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The dep scan would crawl every index.html, decky/out's built copy too
  optimizeDeps: { entries: ['index.html'] },
})
