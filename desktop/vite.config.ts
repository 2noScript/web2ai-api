import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5288,
    strictPort: true,
    proxy: {
      "/health": "http://127.0.0.1:8088",
      "/v1": "http://127.0.0.1:8088",
      "/docs": "http://127.0.0.1:8088",
      "/openapi.json": "http://127.0.0.1:8088",
    },
  },
})
