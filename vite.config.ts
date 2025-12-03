import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/FantasyFootballAnalyzer/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString().slice(11, 19)),
  },
})
